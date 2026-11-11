/**
 * Utilitaires de temps et d'unités, partagés par tout le domaine.
 * Aucun module ne doit réimplémenter ces conversions (règle « zéro duplication »).
 */

/** Millisecondes dans une journée. */
export const DAY_MS = 86_400_000;

/** Une semaine compte 5 jours ouvrés par défaut. */
export const DEFAULT_DAYS_PER_WEEK = 5;

/** Une journée de travail vaut 7 heures par défaut. */
export const DEFAULT_HOURS_PER_DAY = 7;

/** Analyse une date ISO ; rend `null` au lieu de jeter. */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Différence en millisecondes, ou 0 si l'une des dates est illisible. */
export function diffMs(from: string | null, to: string | null): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return 0;
  return Math.max(0, b.getTime() - a.getTime());
}

/** Différence en jours calendaires (fractionnaire). */
export function diffDays(from: string | null, to: string | null): number {
  return diffMs(from, to) / DAY_MS;
}

/** Jours ouvrés entre deux dates, bornes exclues à droite (lundi-vendredi). */
export function businessDaysBetween(from: string | null, to: string | null): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b || b <= a) return 0;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor < b) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** Recule ou avance d'un nombre de jours, en ISO. */
export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  if (!d) return iso;
  return new Date(d.getTime() + days * DAY_MS).toISOString();
}

/** Lundi 00:00 UTC de la semaine ISO contenant la date donnée, en ISO. */
export function isoWeekStart(iso: string): string {
  const d = parseIso(iso);
  if (!d) return iso;
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday.toISOString();
}

/** Clé de semaine stable, `AAAA-MM-JJ` du lundi. */
export function weekKey(iso: string): string {
  return isoWeekStart(iso).slice(0, 10);
}

/** Liste des clés de semaine entre deux dates, bornes incluses. */
export function weeksBetween(fromIso: string, toIso: string): string[] {
  const keys: string[] = [];
  let cursor = isoWeekStart(fromIso);
  const end = isoWeekStart(toIso);
  let guard = 0;
  while (cursor <= end && guard < 600) {
    keys.push(cursor.slice(0, 10));
    cursor = addDays(cursor, 7);
    guard += 1;
  }
  return keys;
}

/** Recouvrement en jours ouvrés d'un intervalle avec une fenêtre. */
export function businessOverlapDays(
  startIso: string,
  endIso: string | null,
  windowStartIso: string,
  windowEndIso: string,
): number {
  const start = startIso > windowStartIso ? startIso : windowStartIso;
  const endRaw = endIso ?? windowEndIso;
  const end = endRaw < windowEndIso ? endRaw : windowEndIso;
  return businessDaysBetween(start, end);
}

/** Ramène une valeur dans un intervalle fermé. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Arrondit à deux décimales, sans bruit de virgule flottante. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Secondes de temps saisi converties en jours-personne. */
export function secondsToJp(seconds: number | null, hoursPerDay: number): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return seconds / 3600 / hoursPerDay;
}

/** Jours ouvrés convertis en jours-personne avec le coefficient d'occupation. */
export function daysToJp(days: number, coefficient = 1): number {
  return Math.max(0, days) * coefficient;
}
