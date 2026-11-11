/**
 * Les huit actions du §13, exposées à Rovo et à `rovo:mcp`.
 *
 * Toutes lisent des **résultats enregistrés** (tables `debt_bill`, `evidence`,
 * `attribution`, `zone_week`, `repayment`) et ne recalculent aucun coût : la
 * méthode a déjà tourné la nuit (§15). Sept actions sont en lecture seule, une
 * (`confirm-evidence`) écrit le rapprochement confirmé ou rejeté (§7.4, §10).
 *
 * Aucune action ne jette : chacune rend `{ ok, data }` (voir `result.ts`).
 */

import type {
  Attribution,
  DeadDebt,
  DebtBill,
  Evidence,
  IssueFact,
  PhantomDebt,
  ProjectSettings,
  RankedDebt,
  Repayment,
  ZoneCost,
} from '../core/types.ts';
import { findDeadDebt } from '../core/dead.ts';
import { findPhantomDebt } from '../core/phantom.ts';
import { rankDebts } from '../core/ranking.ts';
import { makeSettings } from '../core/settings.ts';
import { addDays, round2, weeksBetween } from '../core/time.ts';
import {
  getSettings,
  insertRejection,
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
  listRepayments,
  listZoneWeeks,
  replaceAttributions,
} from '../platform/db/index.ts';
import { projectIdByKey } from '../jobs/projects.ts';
import type { ActionEnvelope, JsonPayload } from './result.ts';
import { optionalNumber, optionalText, requireBoolean, requireText, run } from './result.ts';

/** Nombre de dettes rendues par défaut, et plafond de l'action de classement. */
export const DEFAULT_RANKING_LIMIT = 10;
const MAX_RANKING_LIMIT = 50;

/** Instant de référence des actions : l'horloge du runtime, jamais le domaine. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Projet résolu depuis la clé reçue par l'agent (`PAY`). */
interface ProjectContext {
  projectId: string;
  projectKey: string;
  settings: ProjectSettings;
}

/** Résout un projet et ses réglages ; jette un motif clair s'il est inconnu. */
async function projectOf(projectKey: string): Promise<ProjectContext> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » inconnu : lancer l'initialisation de L'addition`);
  const settings = (await getSettings(projectId)) ?? makeSettings(projectId, projectKey);
  return { projectId, projectKey, settings };
}

/* ------------------------------------------------------ get-debt-ranking */

/** Classement des dettes, fourchettes et retour compris (DT-07). */
export interface DebtRankingData {
  projectKey: string;
  windowDays: number;
  total: number;
  debts: RankedDebt[];
}

/** GET `get-debt-ranking` : les dettes les plus coûteuses, de la plus chère à la moins chère. */
export async function getDebtRanking(payload: JsonPayload): Promise<ActionEnvelope<DebtRankingData>> {
  return run(async () => {
    const project = await projectOf(requireText(payload, 'projectKey'));
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
      debts: ranking.slice(0, limit),
    };
  });
}

/* --------------------------------------------------------- get-debt-bill */

/** Addition détaillée d'une dette, avec les preuves qui la composent (§9). */
export interface DebtBillData {
  debt: { key: string; summary: string; zone: string };
  bill: DebtBill;
  evidence: Evidence[];
  /** Part des preuves masquées pour ce lecteur, jamais leur contenu (§18). */
  hiddenCount: number;
}

/** GET `get-debt-bill` : l'addition d'un ticket de dette et ses preuves. */
export async function getDebtBill(payload: JsonPayload): Promise<ActionEnvelope<DebtBillData>> {
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const located = await locateDebt(issueKey);
    const bill = await billOf(located.project.projectId, issueKey);
    const evidence = await evidenceOfBill(located.project.projectId, bill);
    return {
      debt: { key: bill.key, summary: located.debt.summary, zone: located.debt.zones[0] ?? 'non classé' },
      bill,
      evidence,
      hiddenCount: bill.hiddenCount,
    };
  });
}

/** Ticket de dette et son projet, retrouvés depuis sa clé. */
interface LocatedDebt {
  project: ProjectContext;
  debt: IssueFact;
}

/** Retrouve la dette et son projet ; jette un motif clair si elle est absente. */
async function locateDebt(issueKey: string): Promise<LocatedDebt> {
  const project = await projectOf(projectKeyOf(issueKey));
  const debts = await listDebtIssues(project.projectId);
  const debt = debts.find((item) => item.key === issueKey);
  if (!debt) throw new Error(`« ${issueKey} » n'est pas un ticket de dette connu du projet ${project.projectKey}`);
  return { project, debt };
}

/** Addition enregistrée d'un ticket, par sa clé. */
async function billOf(projectId: string, issueKey: string): Promise<DebtBill> {
  const bills = await listBills(projectId);
  const bill = bills.find((item) => item.key === issueKey);
  if (!bill) throw new Error(`aucune addition calculée pour « ${issueKey} » : relancer le calcul nocturne`);
  return bill;
}

/** Preuves d'une addition, dans l'ordre de coût décroissant de `evidenceIds`. */
async function evidenceOfBill(projectId: string, bill: DebtBill): Promise<Evidence[]> {
  const all = await listEvidence(projectId);
  const byId = new Map(all.map((item) => [item.id, item]));
  const ordered: Evidence[] = [];
  for (const id of bill.evidenceIds) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
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
    const project = await projectOf(requireText(payload, 'projectKey'));
    const zone = requireText(payload, 'zone');
    const costs = await zoneCostsOf(project);
    const cost = costs.find((item) => item.zone === zone);
    if (!cost) throw new Error(`zone « ${zone} » inconnue sur la fenêtre de ${project.settings.windowDays} jours`);
    return {
      projectKey: project.projectKey,
      windowDays: project.settings.windowDays,
      zone: cost,
      trend: trendOf(cost.weeklyJp),
      coveredByDebt: await isZoneCovered(project.projectId, zone),
    };
  });
}

/** Coûts de toutes les zones sur la fenêtre d'analyse du projet. */
async function zoneCostsOf(project: ProjectContext): Promise<ZoneCost[]> {
  const now = nowIso();
  const weeks = weeksBetween(addDays(now, -project.settings.windowDays), now);
  return listZoneWeeks(project.projectId, weeks);
}

/** Vrai quand au moins un ticket de dette est rattaché à la zone. */
async function isZoneCovered(projectId: string, zone: string): Promise<boolean> {
  const debts = await listDebtIssues(projectId);
  return debts.some((debt) => debt.zones.includes(zone));
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
    const project = await projectOf(requireText(payload, 'projectKey'));
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
    const project = await projectOf(requireText(payload, 'projectKey'));
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
    const project = await projectOf(projectKeyOf(issueKey));
    const repayments = await listRepayments(project.projectId);
    const repayment = repayments.find((item) => item.key === issueKey);
    if (!repayment) throw new Error(`aucun bulletin de remboursement pour « ${issueKey} »`);
    return {
      projectKey: project.projectKey,
      repayment,
      causalWarning: 'comparaison avant/après, sans preuve de causalité',
    };
  });
}

/** Préfixe d'une clé de ticket (`PAY-77` → `PAY`). */
function projectKeyOf(issueKey: string): string {
  const prefix = issueKey.split('-')[0] ?? '';
  if (prefix.length === 0) throw new Error(`clé de ticket illisible : « ${issueKey} »`);
  return prefix;
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
    const project = await projectOf(requireText(payload, 'projectKey'));
    const zone = requireText(payload, 'zone');
    const [costs, evidence] = await Promise.all([
      zoneCostsOf(project),
      listEvidence(project.projectId),
    ]);
    const cost = costs.find((item) => item.zone === zone);
    if (!cost) throw new Error(`zone « ${zone} » inconnue sur la fenêtre d'analyse`);
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

/** Les cinq preuves les plus coûteuses d'une zone, visibles pour ce lecteur (§18). */
function topEvidenceOf(zone: string, evidence: Evidence[]): Evidence[] {
  return evidence
    .filter((item) => item.zone === zone && item.visible !== false && item.family !== 'C5')
    .slice()
    .sort((a, b) => b.costJp - a.costJp || a.id.localeCompare(b.id))
    .slice(0, 5);
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
}

/**
 * UPDATE `confirm-evidence` : l'humain confirme ou rejette un rapprochement.
 *
 * Une confirmation remplace les parts existantes du couple par une attribution
 * `confirmed` à 100 % — elle entre donc dans la fourchette basse (§10). Un rejet
 * enregistre le refus : le rapprochement n'est plus proposé. Dans les deux cas
 * l'addition est recalculée la nuit suivante, pas ici : l'action ne calcule rien.
 */
export async function confirmEvidence(payload: JsonPayload): Promise<ActionEnvelope<ConfirmEvidenceData>> {
  return run(async () => {
    const evidenceKey = requireText(payload, 'evidenceKey');
    const debtKey = requireText(payload, 'debtKey');
    const confirmed = requireBoolean(payload, 'confirmed');
    const located = await locateDebt(debtKey);
    const evidence = await evidenceFor(evidenceKey, located.project.projectId);
    if (confirmed) {
      const updated = await confirmMatch(located, evidence, optionalText(payload, 'by'));
      return { evidenceId: evidence.id, debtIssueId: located.debt.issueId, confirmed, basis: 'confirmed', updated };
    }
    await insertRejection({
      evidenceId: evidence.id,
      debtIssueId: located.debt.issueId,
      rejectedBy: optionalText(payload, 'by') ?? 'rovo',
      at: nowIso(),
    });
    return { evidenceId: evidence.id, debtIssueId: located.debt.issueId, confirmed, basis: 'rejected', updated: 0 };
  });
}

/** Preuve visée par sa clé : identifiant de preuve d'abord, clé de source ensuite. */
async function evidenceFor(evidenceKey: string, projectId: string): Promise<Evidence> {
  const all = await listEvidence(projectId);
  const found = all.find((item) => item.id === evidenceKey) ?? all.find((item) => item.sourceKey === evidenceKey);
  if (!found) throw new Error(`preuve « ${evidenceKey} » inconnue du projet`);
  return found;
}

/**
 * Écrit la confirmation : les parts du couple preuve / dette sont remplacées par
 * une attribution `confirmed` pleine, les autres sont conservées telles quelles.
 */
async function confirmMatch(located: LocatedDebt, evidence: Evidence, by: string | null): Promise<number> {
  const existing = await listAttributions(located.project.projectId);
  const kept = existing.filter(
    (item) => !(item.evidenceId === evidence.id && item.debtIssueId === located.debt.issueId),
  );
  const confirmed: Attribution = {
    evidenceId: evidence.id,
    debtIssueId: located.debt.issueId,
    share: 1,
    basis: 'confirmed',
    relevance: 1,
    rationale: by ? `Rapprochement confirmé par ${by}` : 'Rapprochement confirmé par un humain',
  };
  await replaceAttributions(located.project.projectId, [...kept, confirmed]);
  return kept.length + 1;
}
