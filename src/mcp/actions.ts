/**
 * Les huit actions du §13, exposées à Rovo et à `rovo:mcp`.
 *
 * Toutes lisent des **résultats enregistrés** (tables `debt_bill`, `evidence`,
 * `attribution`, `zone_week`, `repayment`) et ne recalculent aucun coût : la
 * méthode a déjà tourné la nuit (§15). Sept actions sont en lecture seule, une
 * (`confirm-evidence`) écrit le rapprochement confirmé ou rejeté (§7.4, §10).
 *
 * Les trois actions ajoutées à l'audit ont leur propre fichier, pour rester sous
 * la limite de taille : `debtCase.ts` (`get-debt-case`), `zoneEvidence.ts`
 * (`list-zone-evidence`), `projectList.ts` (`list-projects`).
 *
 * Aucune action ne jette : chacune rend `{ ok, data }` (voir `result.ts`).
 */

import type {
  DeadDebt,
  DebtBill,
  Evidence,
  PhantomDebt,
  ProjectSettings,
  RankedDebt,
  Repayment,
  ZoneCost,
} from '../core/types';
import { findDeadDebt } from '../core/dead';
import { findPhantomDebt } from '../core/phantom';
import { rankDebts } from '../core/ranking';
import { round2 } from '../core/time';
import {
  getIssueFactByKey,
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
  listRepayments,
} from '../platform/db/index';
import { confirmMatch as decideConfirm, rejectMatch as decideReject } from '../jobs/decisions';
import { projectKeyOf, resolveProject } from './project';
import {
  billOf,
  evidenceFor,
  evidenceOfBill,
  isZoneCovered,
  locateDebt,
  nowIso,
  topEvidenceOf,
  unknownZoneError,
  zoneCostsOf,
} from './reads';
import { maskEvidence } from './masking';
import type { ActionEnvelope, AppliedNumber, JsonPayload } from './result';
import { optionalNumber, optionalText, requireBoolean, requireText, run } from './result';

/** Nombre de dettes rendues par défaut, et plafond de l'action de classement. */
export const DEFAULT_RANKING_LIMIT = 10;
export const MAX_RANKING_LIMIT = 50;

/* ------------------------------------------------------ get-debt-ranking */

/** Classement des dettes, fourchettes et retour compris (DT-07). */
export interface DebtRankingData {
  projectKey: string;
  windowDays: number;
  total: number;
  /** Nombre de dettes réellement rendues. */
  limit: number;
  /** Écho de la limite : demandée, appliquée, bornée (item E72). */
  limitApplied: AppliedNumber;
  debts: RankedDebt[];
}

/** GET `get-debt-ranking` : les dettes les plus coûteuses, de la plus chère à la moins chère. */
export async function getDebtRanking(payload: JsonPayload): Promise<ActionEnvelope<DebtRankingData>> {
  return run(async () => {
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const limit = optionalNumber(payload, 'limit', DEFAULT_RANKING_LIMIT, MAX_RANKING_LIMIT);
    const [bills, debts] = await Promise.all([
      listBills(project.projectId),
      listDebtIssues(project.projectId),
    ]);
    const ranking = rankDebts(bills, debts);
    return {
      projectKey: project.projectKey,
      windowDays: project.settings.windowDays,
      total: ranking.length,
      limit: limit.applied,
      limitApplied: limit,
      debts: ranking.slice(0, limit.applied),
    };
  });
}

/* --------------------------------------------------------- get-debt-bill */

/** Addition détaillée d'une dette, avec les preuves qui la composent (§9). */
export interface DebtBillData {
  debt: { key: string; summary: string; zone: string };
  bill: DebtBill;
  /** Preuves de l'addition ; celles hors des droits du lecteur sont masquées (§18). */
  evidence: Evidence[];
  /** Preuves comptées mais masquées pour ce lecteur, jamais leur contenu (§18). */
  hiddenCount: number;
}

/** GET `get-debt-bill` : l'addition d'un ticket de dette et ses preuves. */
export async function getDebtBill(payload: JsonPayload): Promise<ActionEnvelope<DebtBillData>> {
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const located = await locateDebt(issueKey);
    const bill = await billOf(located.project.projectId, issueKey);
    const masked = maskEvidence(await evidenceOfBill(located.project.projectId, bill));
    return {
      debt: { key: bill.key, summary: located.debt.summary, zone: located.debt.zones[0] ?? 'non classé' },
      bill,
      evidence: masked.evidence,
      hiddenCount: masked.hiddenCount,
    };
  });
}

/* -------------------------------------------------------- get-zone-costs */

/** Tendance d'une zone : moyennes des deux moitiés de la fenêtre (§13). */
export interface ZoneTrend {
  firstHalfJp: number;
  secondHalfJp: number;
  direction: 'up' | 'down' | 'flat';
}

/** Coût d'une zone par famille et son évolution sur la fenêtre. */
export interface ZoneCostData {
  projectKey: string;
  windowDays: number;
  zone: ZoneCost;
  trend: ZoneTrend;
  /** Vrai quand la zone n'a aucun ticket de dette : c'est une dette fantôme (§7.2). */
  coveredByDebt: boolean;
}

/** GET `get-zone-costs` : ce que coûte une zone, et ce qui s'y casse le plus souvent. */
export async function getZoneCosts(payload: JsonPayload): Promise<ActionEnvelope<ZoneCostData>> {
  return run(async () => {
    const zone = requireText(payload, 'zone');
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const costs = await zoneCostsOf(project);
    const cost = costs.find((item) => item.zone === zone);
    // Item E67 : une zone inconnue rend la liste des zones mesurées — l'appelant
    // corrige son paramètre au lieu de deviner un nom.
    if (!cost) throw unknownZoneError(zone, costs, project.settings.windowDays);
    return {
      projectKey: project.projectKey,
      windowDays: project.settings.windowDays,
      zone: cost,
      trend: trendOf(cost.weeklyJp),
      coveredByDebt: await isZoneCovered(project.projectId, zone),
    };
  });
}

/** Compare la moyenne des semaines récentes à celle des semaines anciennes. */
function trendOf(weeklyJp: number[]): ZoneTrend {
  if (weeklyJp.length === 0) return { firstHalfJp: 0, secondHalfJp: 0, direction: 'flat' };
  const middle = Math.ceil(weeklyJp.length / 2);
  const firstHalfJp = round2(average(weeklyJp.slice(0, middle)));
  const secondHalfJp = round2(average(weeklyJp.slice(middle)));
  return { firstHalfJp, secondHalfJp, direction: directionOf(firstHalfJp, secondHalfJp) };
}

/** Moyenne d'une série vide : 0, jamais `NaN`. */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / values.length;
}

/** Sens de la tendance, avec une marge de 10 % pour ne pas crier au bruit. */
function directionOf(firstHalfJp: number, secondHalfJp: number): ZoneTrend['direction'] {
  const reference = Math.max(firstHalfJp, 0.01);
  if (secondHalfJp > reference * 1.1) return 'up';
  if (secondHalfJp < reference * 0.9) return 'down';
  return 'flat';
}

/* ----------------------------------------------------- list-phantom-debt */

/** Zones coûteuses sans ticket de dette (DT-08, §7.2). */
export interface PhantomDebtData {
  projectKey: string;
  thresholdJp: number;
  zones: PhantomDebt[];
}

/** GET `list-phantom-debt` : le coût sans ticket. */
export async function listPhantomDebt(payload: JsonPayload): Promise<ActionEnvelope<PhantomDebtData>> {
  return run(async () => {
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const [costs, debts, evidence] = await Promise.all([
      zoneCostsOf(project),
      listDebtIssues(project.projectId),
      listEvidence(project.projectId),
    ]);
    return {
      projectKey: project.projectKey,
      thresholdJp: project.settings.phantomThresholdJp,
      zones: findPhantomDebt(costs, debts, evidence, project.settings),
    };
  });
}

/* -------------------------------------------------------- list-dead-debt */

/** Tickets de dette sans preuve depuis `deadDays` (DT-09, §7.3). */
export interface DeadDebtData {
  projectKey: string;
  deadDays: number;
  debts: DeadDebt[];
}

/** GET `list-dead-debt` : les dettes que plus rien n'alimente. */
export async function listDeadDebt(payload: JsonPayload): Promise<ActionEnvelope<DeadDebtData>> {
  return run(async () => {
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const [debts, evidence, attributions] = await Promise.all([
      listDebtIssues(project.projectId),
      listEvidence(project.projectId),
      listAttributions(project.projectId),
    ]);
    return {
      projectKey: project.projectKey,
      deadDays: project.settings.deadDays,
      debts: findDeadDebt(debts, evidence, attributions, project.settings, nowIso()),
    };
  });
}

/* -------------------------------------------------- get-repayment-report */

/** Bulletin de remboursement d'une dette close, avec ses limites (§11). */
export interface RepaymentData {
  projectKey: string;
  repayment: Repayment;
  /** Rappel constant : une comparaison avant/après ne prouve pas la causalité. */
  causalWarning: string;
}

/** GET `get-repayment-report` : ce qu'a rapporté le remboursement d'une dette. */
export async function getRepaymentReport(payload: JsonPayload): Promise<ActionEnvelope<RepaymentData>> {
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const located = await locateProjectOfIssue(issueKey);
    const repayments = await listRepayments(located.projectId);
    const repayment = repayments.find((item) => item.key === issueKey);
    if (!repayment) {
      throw new Error(
        `aucun bulletin de remboursement pour « ${issueKey} » : le bulletin est publié ` +
          'après la clôture de la dette, une fois les deux périodes observées',
      );
    }
    return {
      projectKey: located.projectKey,
      repayment,
      causalWarning: 'comparaison avant/après, sans preuve de causalité',
    };
  });
}

/** Projet qui héberge un ticket : la clé enregistrée prime sur le préfixe. */
async function locateProjectOfIssue(issueKey: string): Promise<{ projectId: string; projectKey: string }> {
  const fact = await getIssueFactByKey(issueKey);
  if (fact) return { projectId: fact.projectId, projectKey: fact.projectKey };
  const project = await resolveProject(projectKeyOf(issueKey));
  return { projectId: project.projectId, projectKey: project.projectKey };
}

/* --------------------------------------------------- draft-debt-ticket */

/** Brouillon de ticket de dette rédigé depuis les preuves d'une zone (§7.2). */
export interface DraftTicketData {
  zone: string;
  summary: string;
  description: string;
  totalJp: number;
  /** Preuves citées, les plus coûteuses d'abord. */
  evidenceIds: string[];
}

/** GET `draft-debt-ticket` : le texte prêt à relire, jamais un ticket créé. */
export async function draftDebtTicket(payload: JsonPayload): Promise<ActionEnvelope<DraftTicketData>> {
  return run(async () => {
    const zone = requireText(payload, 'zone');
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const [costs, evidence] = await Promise.all([zoneCostsOf(project), listEvidence(project.projectId)]);
    const cost = costs.find((item) => item.zone === zone);
    if (!cost) throw unknownZoneError(zone, costs, project.settings.windowDays);
    const cited = topEvidenceOf(zone, evidence);
    return {
      zone,
      summary: `Rembourser la dette de la zone « ${zone} »`,
      description: describeDraft(zone, cost, cited, project.settings),
      totalJp: cost.totalJp,
      evidenceIds: cited.map((item) => item.id),
    };
  });
}

/**
 * Description d'un brouillon : les chiffres d'abord, la méthode ensuite, et
 * une phrase qui rappelle que le brouillon se relit avant d'être créé.
 */
function describeDraft(zone: string, cost: ZoneCost, cited: Evidence[], settings: ProjectSettings): string {
  const lines = [
    `La zone « ${zone} » a coûté ${cost.totalJp} jours-personne sur ${settings.windowDays} jours ` +
      'et aucun ticket de dette ne la couvre.',
    `Ventilation : incidents ${cost.byFamily.C1} j-p, bugs ${cost.byFamily.C2} j-p, ` +
      `lenteur ${cost.byFamily.C3} j-p, retouches ${cost.byFamily.C4} j-p.`,
    '',
    'Preuves principales :',
    ...cited.map((item) => `- ${item.sourceKey} (${item.family}) : ${item.costJp} j-p — ${item.detail.formula}`),
    '',
    `Méthode : familles C1 à C4 du §9, fenêtre de ${settings.windowDays} jours, ` +
      `coefficient d'occupation ${settings.occupationCoefficient}, référence C3 sur ${settings.minBaselineSample} tickets minimum.`,
    'Brouillon rédigé depuis les preuves : à relire et corriger avant création.',
  ];
  return lines.join('\n');
}

/* ----------------------------------------------------- confirm-evidence */

/** Résultat d'une confirmation ou d'un rejet de rapprochement (§7.4). */
export interface ConfirmEvidenceData {
  evidenceId: string;
  debtIssueId: string;
  confirmed: boolean;
  /** Base retenue : `confirmed` pour une confirmation, `rejected` pour un rejet. */
  basis: 'confirmed' | 'rejected';
  /** Nombre de parts réécrites (0 pour un rejet, qui n'écrit qu'un refus). */
  updated: number;
  /** Auteur enregistré de la décision : jamais un nom fourni par l'appelant. */
  decidedBy: string;
}

/**
 * Auteur d'une décision passée par outil MCP (item E71).
 *
 * Un appel d'outil n'a **aucun contexte utilisateur** : le payload vient du
 * modèle, donc un champ `by` libre permettait à n'importe quel appelant
 * d'attribuer la décision à un tiers. Ce champ n'est plus lu ; la décision est
 * enregistrée sous l'identité de l'outil, non usurpable, et le journal des
 * décisions distingue ainsi un clic humain (`accountId`) d'un appel d'outil.
 */
export const MCP_ACTOR = 'rovo-mcp';

/**
 * UPDATE `confirm-evidence` : la décision de rapprochement est enregistrée (§7.4).
 *
 * **Asymétrie assumée (item E70).** Cet outil figure dans `rovo:mcp` mais pas
 * dans la liste d'actions de l'agent « L'addition » : le §10 réserve la
 * confirmation à un humain, et c'est l'écran (un clic, avec le `accountId` du
 * compte) qui la produit. L'outil reste exposé aux **agents de code et aux
 * automatisations pilotées par un humain** — un ticket, un script d'exploitation
 * — qui agissent sur demande explicite ; l'agent conversationnel, lui, ne
 * confirme jamais seul : il explique la proposition et renvoie l'utilisateur à
 * l'écran (c'est écrit dans son prompt, `agent.ts`).
 *
 * Une confirmation remplace les parts existantes du couple par une attribution
 * `confirmed` à 100 % — elle entre donc dans la fourchette basse (§10). Un rejet
 * enregistre le refus : le rapprochement n'est plus proposé. Dans les deux cas
 * l'addition est recalculée par le module partagé `jobs/decisions.ts`, le même
 * que l'écran : une décision survit au recalcul nocturne.
 */
export async function confirmEvidence(payload: JsonPayload): Promise<ActionEnvelope<ConfirmEvidenceData>> {
  return run(async () => {
    const evidenceKey = requireText(payload, 'evidenceKey');
    const debtKey = requireText(payload, 'debtKey');
    const confirmed = requireBoolean(payload, 'confirmed');
    const located = await locateDebt(debtKey);
    const evidence = await evidenceFor(evidenceKey, located.project.projectId);
    const projectId = located.project.projectId;
    const outcome = confirmed
      ? await decideConfirm(projectId, evidence.id, located.debt.issueId, MCP_ACTOR)
      : await decideReject(projectId, evidence.id, located.debt.issueId, MCP_ACTOR);
    return {
      evidenceId: outcome.evidenceId,
      debtIssueId: outcome.debtIssueId,
      confirmed,
      basis: confirmed ? 'confirmed' : 'rejected',
      updated: outcome.bills,
      decidedBy: MCP_ACTOR,
    };
  });
}

/* ------------------------------------------------- lectures internes */
