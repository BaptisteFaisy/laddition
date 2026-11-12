import type { Request } from '@forge/resolver';
import type {
  BootstrapProgress,
  DataQuality,
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
import { computeQuality } from '../core/quality';
import { rankDebts } from '../core/ranking';
import { makeSettings } from '../core/settings';
import { addDays, weeksBetween } from '../core/time';
import {
  bootstrapProgress as readProgress,
  getBill,
  getIssueFact,
  getSettings as readSettings,
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
  listRepayments,
  listZoneWeeks,
} from '../platform/db/index';
import type { Failure } from '../jobs/support';
import { guard, nowIso, optionalString, payloadOf, requireString } from '../jobs/support';
import type { QuarterCost, TeamCost } from './aggregate';
import { costByQuarter, costByTeam } from './aggregate';
import { projectIdOf, requireSettings } from '../jobs/projects';
import { loadState } from './state';

/**
 * Résolveurs de lecture : l'écran affiche, il ne calcule pas (§15).
 *
 * Les preuves, les additions et l'instantané viennent de la base, tels que la
 * nuit les a écrits. Ce qui est replié ici — classement, dette fantôme, dette
 * morte, qualité, coût par équipe et par trimestre — sort de fonctions pures,
 * sans formule recalculée et sans appel réseau. Chaque résolveur valide son
 * payload et rend `{ ok: false, error }` plutôt que de jeter.
 */

/** Modèle de lecture d'un projet : la page projet et le gadget lisent celui-ci. */
export interface ProjectPageData {
  settings: ProjectSettings;
  ranking: RankedDebt[];
  zones: ZoneCost[];
  quality: DataQuality;
  costByTeam: TeamCost[];
  costByQuarter: QuarterCost[];
}

/** Coûts d'une zone, ou de toutes (onglet Zones). */
export interface ZoneCostsView {
  zones: ZoneCost[];
  weeks: string[];
}

/** Écran 1 : classement, zones, qualité — tout ce que la page projet affiche. */
export async function getProjectPage(request: Request<unknown>): Promise<ProjectPageData | Failure> {
  return guard(async () => {
    const state = await loadState(await projectIdOf(payloadOf(request)), nowIso());
    return {
      settings: state.settings,
      ranking: state.ranking,
      zones: state.zoneCosts,
      quality: computeQuality(state.facts, state.evidence, state.settings),
      costByTeam: costByTeam(state.zoneCosts),
      costByQuarter: costByQuarter(state.zoneCosts, state.weeks),
    };
  });
}

/** Onglet Zones : coûts par zone et par famille, avec la tendance. */
export async function getZoneCosts(request: Request<unknown>): Promise<ZoneCostsView | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const state = await loadState(await projectIdOf(payload), nowIso());
    const zone = optionalString(payload, 'zone');
    const zones = zone ? state.zoneCosts.filter((cost) => cost.zone === zone) : state.zoneCosts;
    return { zones, weeks: state.weeks };
  });
}

/**
 * Item 38/40 — lectures réduites des écrans secondaires.
 *
 * Seule la page projet a besoin de l'état complet (`loadState`, sept
 * lectures) ; l'onglet Fantôme, l'onglet Mort et le gadget n'en consomment
 * qu'une partie. Ils vont ici directement au dépôt, pour quatre tables
 * seulement — mêmes replis purs, mêmes chiffres rendus.
 */

/** Réglages du projet, puis les semaines ISO de sa fenêtre d'analyse. */
async function settingsAndWeeks(
  projectId: string,
  now: string,
): Promise<{ settings: ProjectSettings; weeks: string[] }> {
  const settings = await requireSettings(projectId);
  return { settings, weeks: weeksBetween(addDays(now, -settings.windowDays), now) };
}

/** DT-08 : zones coûteuses sans aucun ticket de dette (zone_week + dettes + preuves). */
export async function listPhantomDebt(request: Request<unknown>): Promise<PhantomDebt[] | Failure> {
  return guard(async () => {
    const projectId = await projectIdOf(payloadOf(request));
    const { settings, weeks } = await settingsAndWeeks(projectId, nowIso());
    const [debts, evidence, zoneCosts] = await Promise.all([
      listDebtIssues(projectId),
      listEvidence(projectId),
      listZoneWeeks(projectId, weeks),
    ]);
    return findPhantomDebt(zoneCosts, debts, evidence, settings);
  });
}

/** DT-09 : tickets de dette sans preuve depuis trop longtemps (dettes + preuves + parts). */
export async function listDeadDebt(request: Request<unknown>): Promise<DeadDebt[] | Failure> {
  return guard(async () => {
    const now = nowIso();
    const projectId = await projectIdOf(payloadOf(request));
    const [settings, debts, evidence, attributions] = await Promise.all([
      requireSettings(projectId),
      listDebtIssues(projectId),
      listEvidence(projectId),
      listAttributions(projectId),
    ]);
    return findDeadDebt(debts, evidence, attributions, settings, now);
  });
}

/** §11 : bulletins avant/après des dettes closes, limites comprises. */
export async function getRepaymentReport(request: Request<unknown>): Promise<Repayment[] | Failure> {
  return guard(async () => listRepayments(await projectIdOf(payloadOf(request))));
}

/** Écran 6 : réglages du projet, valeurs par défaut avant la première visite. */
export async function getSettings(request: Request<unknown>): Promise<ProjectSettings | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const projectId = await projectIdOf(payload);
    const stored = await readSettings(projectId);
    return stored ?? makeSettings(projectId, optionalString(payload, 'projectKey') ?? projectId);
  });
}

/** DT-12 : avancement de l'initialisation, pour la barre de progression. */
export async function bootstrapProgress(
  request: Request<unknown>,
): Promise<BootstrapProgress | null | Failure> {
  return guard(async () => readProgress(await projectIdOf(payloadOf(request))));
}

/** §14 : qualité des données, affichée dans l'onglet Méthode. */
export async function getDataQuality(request: Request<unknown>): Promise<DataQuality | Failure> {
  return guard(async () => {
    const state = await loadState(await projectIdOf(payloadOf(request)), nowIso());
    return computeQuality(state.facts, state.evidence, state.settings);
  });
}

/** Preuves d'une addition, dans l'ordre décroissant de coût fixé par le calcul. */
export async function evidenceOfBill(projectId: string, evidenceIds: string[]): Promise<Evidence[]> {
  const byId = new Map((await listEvidence(projectId)).map((item) => [item.id, item]));
  return evidenceIds.map((id) => byId.get(id)).filter((item): item is Evidence => item !== undefined);
}

/** Ce que le champ « Coût de la dette » affiche : trois lignes (item D39). */
export interface IssueCost {
  lowJp: number;
  highJp: number;
  /** Fenêtre d'analyse du projet, en jours : c'est elle qui borne le coût. */
  days: number;
  /** Vrai quand une famille de l'addition manque de références (§9, C3). */
  insufficient: boolean;
  demoData: boolean;
}

/** Ce que le gadget affiche : le haut du classement et les deux replis (D40). */
export interface GadgetData {
  debts: RankedDebt[];
  costByTeam: TeamCost[];
  costByQuarter: QuarterCost[];
  demoData: boolean;
}

/** Nombre de dettes affichées par le gadget (miroir de `ui/gadget-data.ts`). */
export const GADGET_TOP_DEBTS = 5;

/** Écran 4 (DT-11) : le coût d'un ticket, sans charger l'état du projet. */
export async function getIssueCost(request: Request<unknown>): Promise<IssueCost | Failure> {
  return guard(async () => {
    const issueId = requireString(payloadOf(request), 'issueId');
    const fact = await getIssueFact(issueId);
    if (!fact) throw new Error(`ticket ${issueId} inconnu : lancer l'initialisation`);
    const settings = (await readSettings(fact.projectId)) ?? makeSettings(fact.projectId, fact.projectKey);
    const bill = await getBill(issueId);
    return {
      lowJp: bill?.lowJp ?? 0,
      highJp: bill?.highJp ?? 0,
      days: settings.windowDays,
      insufficient: bill ? isInsufficient(bill) : false,
      demoData: settings.demoData,
    };
  });
}

/** Écran 5 : les trois lignes du gadget (item 40 : top 5 + dettes + zone_week). */
export async function getGadgetData(request: Request<unknown>): Promise<GadgetData | Failure> {
  return guard(async () => {
    const projectId = await projectIdOf(payloadOf(request));
    const { settings, weeks } = await settingsAndWeeks(projectId, nowIso());
    const [debts, bills, zoneCosts] = await Promise.all([
      listDebtIssues(projectId),
      listBills(projectId),
      listZoneWeeks(projectId, weeks),
    ]);
    return {
      debts: rankDebts(bills, debts).slice(0, GADGET_TOP_DEBTS),
      costByTeam: costByTeam(zoneCosts),
      costByQuarter: costByQuarter(zoneCosts, weeks),
      demoData: settings.demoData,
    };
  });
}

/** Une famille de l'addition est-elle déclarée « données insuffisantes » ? */
function isInsufficient(bill: DebtBill): boolean {
  return Object.values(bill.byFamily).some((family) => family.insufficient);
}
