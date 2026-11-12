/**
 * Conversions d'unités (DT-15, DT-20) : points → jours, heures → j-p, j-p →
 * euros, vélocité observée.
 *
 * Toutes les conversions sont pures et ne jettent jamais : une entrée
 * inutilisable rend `null` (valeur non chiffrable) ou `0`, jamais `NaN`.
 *
 * Chaîne DT-15 : `contextVelocity` mesure le rythme de l'équipe, l'app
 * l'injecte dans `CostContext.velocityPointsPerWeek`, et `buildBill` s'en sert
 * pour convertir les points d'une dette en jours quand l'estimation en
 * jours-personne manque (§11). Sans vélocité, le remboursement reste « non
 * chiffré ».
 */

import type { IssueFact, ProjectSettings } from './types';
import { round2 } from './time';

/**
 * Un ticket fermé compte pour un point simulé (DT-15).
 *
 * Les projets suivis n'ont pas tous d'estimation en points : faute de mieux, un
 * ticket fermé vaut un point. Cette convention est affichée dans l'onglet
 * Méthode et rend la vélocité comparable d'un projet à l'autre — c'est une
 * approximation assumée, pas une mesure.
 */
export const POINTS_PER_CLOSED_ISSUE = 1;

/** Jours calendaires dans une semaine. */
const DAYS_PER_CALENDAR_WEEK = 7;

/**
 * Points → jours ouvrés, au rythme de la vélocité du projet.
 * Rend `null` quand la vélocité est nulle (ou illisible) : sans rythme, aucun
 * nombre de jours n'a de sens.
 */
export function pointsToDays(
  points: number,
  velocityPointsPerWeek: number,
  daysPerWeek: number,
): number | null {
  if (!Number.isFinite(points) || !Number.isFinite(velocityPointsPerWeek) || !Number.isFinite(daysPerWeek)) {
    return null;
  }
  if (velocityPointsPerWeek <= 0 || daysPerWeek <= 0) return null;
  const weeks = Math.max(0, points) / velocityPointsPerWeek;
  return round2(weeks * daysPerWeek);
}

/** Heures saisies → jours-personne, avec la journée de travail du projet (§9). */
export function hoursToJp(hours: number, hoursPerDay: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(hoursPerDay) || hoursPerDay <= 0) return 0;
  return round2(Math.max(0, hours) / hoursPerDay);
}

/**
 * Jours-personne → euros, au taux journalier du projet (DT-20).
 * Rend `null` quand aucun taux n'est renseigné : on n'invente pas un prix.
 */
export function jpToEuros(jp: number, dayRateEur: number | undefined): number | null {
  if (dayRateEur === undefined || !Number.isFinite(dayRateEur) || dayRateEur <= 0) return null;
  if (!Number.isFinite(jp)) return null;
  return round2(Math.max(0, jp) * dayRateEur);
}

/**
 * Vélocité observée sur une fenêtre, en points par semaine.
 *
 * Les points sont simulés (`POINTS_PER_CLOSED_ISSUE`) ; le diviseur reste la
 * semaine calendaire (7 jours) pour rester comparable au graphique de vélocité
 * de Jira. `daysPerWeek` ne sert qu'à valider le calendrier du projet : un
 * calendrier absurde rend une vélocité nulle plutôt qu'un infini.
 */
export function velocityFromClosedIssues(
  facts: IssueFact[],
  windowDays: number,
  daysPerWeek: number,
): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return 0;
  if (!Number.isFinite(daysPerWeek) || daysPerWeek <= 0) return 0;
  const closed = new Set<string>();
  for (const fact of facts) {
    if (fact.resolvedAt === null && fact.closedAt === null) continue;
    closed.add(fact.issueId || fact.key);
  }
  const points = closed.size * POINTS_PER_CLOSED_ISSUE;
  const weeks = windowDays / DAYS_PER_CALENDAR_WEEK;
  return round2(points / weeks);
}

/**
 * Vélocité à injecter dans `CostContext.velocityPointsPerWeek` (§11).
 *
 * C'est la seule source du rythme utilisé pour convertir les points d'une dette
 * en jours. `null` quand rien n'est mesurable : le remboursement des dettes
 * estimées en points reste alors « non chiffré », il ne vaut jamais 0.
 */
export function contextVelocity(facts: IssueFact[], settings: ProjectSettings): number | null {
  const velocity = velocityFromClosedIssues(facts, settings.windowDays, settings.daysPerWeek);
  return velocity > 0 ? velocity : null;
}
