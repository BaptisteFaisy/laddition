/**
 * Retour sur investissement et délai de retour d'une dette (§11).
 *
 * Ce module répond à une seule question : « si on rembourse ce ticket de dette,
 * combien de temps évite-t-on sur deux trimestres, et en combien de jours le
 * travail est-il remboursé ? » Il ne lit rien et ne jette jamais : tout ce qui
 * n'est pas chiffrable ressort à `null`, jamais à `NaN` ni à l'infini.
 *
 * Le facteur de persistance (`persistenceFactor`, 0,7 par défaut) traduit le
 * fait qu'un gain de dette ne tient jamais entièrement : on ne projette que
 * 70 % du coût observé, sur deux trimestres (§11).
 */

import type { ProjectSettings } from './types.ts';
import { round2 } from './time.ts';

/** Ce que rend le calcul de retour ; chaque champ manquant vaut `null`. */
export interface PaybackResult {
  /** Coût évitable sur deux trimestres, en j-p. */
  avoidableJp: number | null;
  /** Retour bas : coût évitable / remboursement. */
  roiLow: number | null;
  /** Retour haut : coût évitable calculé sur l'addition haute / remboursement. */
  roiHigh: number | null;
  /** Délai de retour, en jours calendaires. */
  paybackDays: number | null;
}

/** Nombre de trimestres sur lesquels le coût évitable est projeté (§11). */
export const PAYBACK_QUARTERS = 2;

/** Jours dans une semaine calendaire : sert à ramener la fenêtre en semaines. */
const DAYS_PER_WEEK = 7;

/**
 * Retour d'un ticket de dette (§11).
 *
 * - `avoidableJp = billLowJp × 2 × persistenceFactor` (deux trimestres).
 * - `roiLow = avoidableJp / repaymentJp`, `roiHigh` idem sur l'addition haute.
 * - `paybackDays = repaymentJp / coût hebdomadaire moyen × 7`, avec
 *   `coût hebdomadaire moyen = billLowJp / (windowDays / 7)`.
 *
 * Sans remboursement chiffré, le coût évitable est calculé quand même (il ne
 * dépend que de l'addition) et les trois autres champs valent `null` :
 * l'écran affiche alors « remboursement non chiffré ».
 */
export function payback(
  billLowJp: number,
  billHighJp: number,
  repaymentJp: number | null,
  settings: ProjectSettings,
): PaybackResult {
  const persistence = persistenceOf(settings);
  const low = positiveOrNull(billLowJp);
  const high = positiveOrNull(billHighJp);
  const repayment = positiveOrNull(repaymentJp);

  const avoidableJp = low === null ? null : round2(low * PAYBACK_QUARTERS * persistence);
  const avoidableHigh = high === null ? null : high * PAYBACK_QUARTERS * persistence;

  return {
    avoidableJp,
    roiLow: ratio(avoidableJp, repayment),
    roiHigh: ratio(avoidableHigh, repayment),
    paybackDays: paybackDaysFor(low, repayment, settings.windowDays),
  };
}

/** Facteur de persistance borné à [0, 1] ; un réglage absurde ne casse rien. */
function persistenceOf(settings: ProjectSettings): number {
  const value = settings.persistenceFactor;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

/** Nombre fini et strictement positif, sinon `null` : pas de division par zéro. */
function positiveOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Quotient arrondi au centième, `null` dès qu'un des deux termes manque. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  return round2(numerator / denominator);
}

/**
 * Délai de retour en jours : le remboursement divisé par le coût hebdomadaire
 * moyen de la zone, ramené en jours. `null` sans addition basse ou sans
 * remboursement chiffré — jamais une division par zéro.
 */
function paybackDaysFor(
  lowJp: number | null,
  repaymentJp: number | null,
  windowDays: number,
): number | null {
  if (lowJp === null || repaymentJp === null) return null;
  const window = positiveOrNull(windowDays);
  if (window === null) return null;
  const weeklyJp = lowJp / (window / DAYS_PER_WEEK);
  if (!Number.isFinite(weeklyJp) || weeklyJp <= 0) return null;
  return round2((repaymentJp / weeklyJp) * DAYS_PER_WEEK);
}
