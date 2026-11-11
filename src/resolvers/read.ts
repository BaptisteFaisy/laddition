import type { Request } from '@forge/resolver';
import type {
  BootstrapProgress,
  DataQuality,
  DeadDebt,
  Evidence,
  PhantomDebt,
  ProjectSettings,
  RankedDebt,
  Repayment,
  ZoneCost,
} from '../core/types.ts';
import { findDeadDebt } from '../core/dead.ts';
import { findPhantomDebt } from '../core/phantom.ts';
import { computeQuality } from '../core/quality.ts';
import { makeSettings } from '../core/settings.ts';
import {
  bootstrapProgress as readProgress,
  getSettings as readSettings,
  listEvidence,
  listRepayments,
} from '../platform/db/index.ts';
import type { Failure } from '../jobs/support.ts';
import { guard, nowIso, optionalString, payloadOf } from '../jobs/support.ts';
import type { QuarterCost, TeamCost } from './aggregate.ts';
import { costByQuarter, costByTeam } from './aggregate.ts';
import { projectIdOf } from '../jobs/projects.ts';
import { loadState } from './state.ts';

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

/** DT-08 : zones coûteuses sans aucun ticket de dette. */
export async function listPhantomDebt(request: Request<unknown>): Promise<PhantomDebt[] | Failure> {
  return guard(async () => {
    const state = await loadState(await projectIdOf(payloadOf(request)), nowIso());
    return findPhantomDebt(state.zoneCosts, state.debts, state.evidence, state.settings);
  });
}

/** DT-09 : tickets de dette sans preuve depuis trop longtemps. */
export async function listDeadDebt(request: Request<unknown>): Promise<DeadDebt[] | Failure> {
  return guard(async () => {
    const now = nowIso();
    const state = await loadState(await projectIdOf(payloadOf(request)), now);
    return findDeadDebt(state.debts, state.evidence, state.attributions, state.settings, now);
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
