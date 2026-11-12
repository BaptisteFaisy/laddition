import type {
  Attribution,
  Baseline,
  CostContext,
  DataQuality,
  DebtBill,
  Evidence,
  IssueFact,
  IssueLink,
  ProjectSettings,
  RankedDebt,
  RelevanceScore,
  Rejection,
  StatusSpan,
} from '../core/types';
import type { Confirmation } from '../core/attribution';
import { attributeEvidence } from '../core/attribution';
import { computeBaselines } from '../core/baseline';
import { buildBill } from '../core/bill';
import { collectEvidence } from '../core/families/index';
import { computeQuality } from '../core/quality';
import { rankDebts } from '../core/ranking';
import { contextVelocity } from '../core/units';
import type { ZoneWeekInput } from '../platform/db/index';
import { weeklyZoneCosts } from './zoneCosts';

/**
 * Orchestration pure du calcul nocturne (§15).
 *
 * preuves → attributions → additions → classement → instantané hebdomadaire.
 * Aucune I/O, aucune horloge : tout entre par `RecomputeInput`, tout sort par
 * `RecomputeResult`. Les points d'entrée (`scheduled.ts`) lisent, appellent,
 * puis enregistrent — c'est ce qui rend la chaîne rejouable et testable.
 */

/** Tout ce dont le calcul a besoin, déjà lu en base ou chez Jira. */
export interface RecomputeInput {
  projectId: string;
  settings: ProjectSettings;
  facts: IssueFact[];
  /**
   * Faits d'autres projets qui alimentent les preuves du projet calculé :
   * les incidents JSM de `settings.jsmProjectKeys` (A9). Ils produisent des
   * preuves (C1) mais ne servent ni de référence C3 ni de mesure de qualité :
   * ce ne sont pas des tickets du projet.
   */
  extraFacts?: IssueFact[];
  links: IssueLink[];
  spansByIssue: Map<string, StatusSpan[]>;
  /** Scores du modèle ; vide si le modèle n'a pas été appelé. */
  scores: RelevanceScore[];
  rejections: Rejection[];
  confirmations: Confirmation[];
  now: string;
}

/** Premier étage du calcul : ce qu'il faut aussi pour demander des scores. */
export interface Prepared {
  ctx: CostContext;
  evidence: Evidence[];
  debts: IssueFact[];
}

/** Tout ce que la nuit enregistre, sauf ce qui se déduit à la lecture. */
export interface RecomputeResult {
  evidence: Evidence[];
  attributions: Attribution[];
  bills: DebtBill[];
  ranking: RankedDebt[];
  zoneWeeks: ZoneWeekInput[];
  baselines: Baseline[];
  quality: DataQuality;
}

/** Références C3, preuves, et tickets de dette : le socle commun. */
export function prepare(input: RecomputeInput): Prepared {
  const baselines = computeBaselines(input.facts, input.spansByIssue, input.settings, input.now);
  const ctx: CostContext = {
    settings: input.settings,
    now: input.now,
    baselines,
    spansByIssue: input.spansByIssue,
    /** Rythme du projet (DT-15) : convertit les points d'une dette en jours (§11). */
    velocityPointsPerWeek: contextVelocity(input.facts, input.settings),
  };
  return {
    ctx,
    evidence: collectEvidence(evidenceFacts(input), ctx, input.links),
    debts: debtsOf(input.facts),
  };
}

/**
 * Faits qui produisent des preuves : ceux du projet, plus les faits d'autres
 * projets qui l'alimentent (incidents JSM, A9). Les références C3 et la
 * qualité des données, elles, restent mesurées sur les seuls tickets du projet.
 */
export function evidenceFacts(input: RecomputeInput): IssueFact[] {
  const extra = input.extraFacts ?? [];
  return extra.length === 0 ? input.facts : [...input.facts, ...extra];
}

/** Chaîne complète, en un appel : prépare puis termine (usage des tests). */
export function recomputeAll(input: RecomputeInput): RecomputeResult {
  return finish(input, prepare(input));
}

/**
 * Fin de chaîne : attributions → additions → classement → instantané.
 * Reçoit un socle déjà préparé, pour ne pas recalculer les preuves deux fois
 * quand l'appelant a dû les lire avant (c'est le cas du calcul nocturne, qui
 * demande des scores au modèle à partir des preuves).
 */
export function finish(
  input: RecomputeInput,
  prepared: Prepared,
  scoresTruncated = false,
): RecomputeResult {
  const attributions = attributeEvidence(
    prepared.evidence,
    prepared.debts,
    input.scores,
    input.rejections,
    input.settings,
    input.links,
    input.confirmations,
  );
  const bills = prepared.debts.map((debt) =>
    buildBill(debt, prepared.evidence, attributions, prepared.ctx),
  );
  return {
    evidence: prepared.evidence,
    attributions,
    bills,
    ranking: rankDebts(bills, prepared.debts),
    zoneWeeks: weeklyZoneCosts(prepared.evidence, input.projectId, input.settings.teamByZone),
    baselines: [...prepared.ctx.baselines.values()],
    quality: computeQuality(input.facts, prepared.evidence, input.settings, scoresTruncated),
  };
}

/** Les tickets désignés par la règle du projet (DT-01). */
export function debtsOf(facts: IssueFact[]): IssueFact[] {
  return facts.filter((fact) => fact.isDebt);
}

/** Valeurs à écrire dans le champ « Coût de la dette » (DT-11). */
export interface DebtFieldValues {
  keys: string[];
  values: Map<string, number>;
}

/**
 * Coût à publier sur chaque ticket de dette : la fourchette **basse**.
 *
 * Le champ est un tri et un filtre JQL, pas une démonstration : il porte le
 * chiffre que la méthode assume partout (liens et confirmations seulement).
 * La fourchette haute et les hypothèses restent dans l'addition, à l'écran.
 */
export function debtFieldValues(bills: DebtBill[]): DebtFieldValues {
  const values = new Map<string, number>();
  for (const bill of bills) values.set(bill.key, bill.lowJp);
  return { keys: [...values.keys()], values };
}
