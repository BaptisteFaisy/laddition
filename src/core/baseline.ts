import type { Baseline, IssueFact, ProjectSettings, SizeClass, StatusSpan } from './types';
import { approximateDays, inProgressDays } from './duration';
import { round2, secondsToJp } from './time';
import { zonesForIssue } from './zones';

/**
 * Références de la famille C3 (§9, table `baseline`) : pour chaque couple
 * `type:taille`, la durée médiane observée devient la référence à laquelle on
 * compare un ticket pour décider s'il a été lent.
 *
 * Toutes les fonctions sont pures : pas d'horloge, pas d'I/O, jamais d'exception.
 */

/** En dessous d'un jour saisi, un ticket « inconnu » est petit. */
const SMALL_MAX_DAYS = 1;

/** En dessous de trois jours saisis, il est moyen ; au-delà, il est grand. */
const MEDIUM_MAX_DAYS = 3;

/** Centile de rabotage par défaut (réglage `clipPercentile` : 95). */
const DEFAULT_CLIP_PERCENTILE = 95;

/** Durée retenue pour un ticket, et son origine. */
export interface TicketDuration {
  /** Jours ouvrés passés en statuts actifs. */
  days: number;
  /** Vrai quand l'historique manque et que la durée est approchée (§19). */
  approximated: boolean;
}

/**
 * Classe de taille d'un ticket : celle fournie par Jira quand elle existe,
 * sinon déduite du temps saisi (moins d'un jour → `s`, moins de trois → `m`,
 * au-delà → `l`). Sans taille ni temps saisi, la taille reste `unknown`.
 */
export function sizeClassOf(fact: IssueFact, settings: ProjectSettings): SizeClass {
  if (fact.size !== 'unknown') return fact.size;
  const days = secondsToJp(fact.loggedSeconds, settings.hoursPerDay);
  if (days === null) return 'unknown';
  if (days < SMALL_MAX_DAYS) return 's';
  if (days < MEDIUM_MAX_DAYS) return 'm';
  return 'l';
}

/** Clé de référence d'un couple type de ticket / classe de taille. */
export function baselineKey(issueType: string, size: SizeClass): string {
  return `${issueType}:${size}`;
}

/**
 * Durée d'un ticket en jours ouvrés passés en statuts actifs.
 *
 * Sans séjour « en cours » (historique absent ou vide, §19), on retombe sur la
 * durée création → résolution, marquée comme approximée pour l'affichage.
 */
export function ticketDurationDays(fact: IssueFact, spans: StatusSpan[] | undefined): TicketDuration {
  const list = spans ?? [];
  const hasActiveSpan = list.some((span) => span.category === 'inprogress');
  if (!hasActiveSpan) {
    return { days: approximateDays(fact), approximated: true };
  }
  return { days: inProgressDays(list, fact.resolvedAt ?? undefined), approximated: false };
}

/**
 * Médiane d'une série : valeur centrale, ou moyenne des deux valeurs du milieu
 * quand la série est paire. Une série vide vaut 0, jamais une exception.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  const low = sorted[middle - 1] as number;
  const high = sorted[middle] as number;
  return (low + high) / 2;
}

/**
 * Rabote une série à son centile : toute valeur au-dessus du seuil est ramenée
 * au seuil. Le tableau d'entrée n'est jamais modifié et l'ordre est conservé,
 * pour que le résultat s'applique ticket par ticket.
 *
 * Seuil = valeur de rang `ceil(p / 100 × n)` dans la série triée (rang le plus
 * proche) ; un petit lot n'est donc jamais raboté, faute de recul.
 */
export function clipToPercentile(values: number[], percentile = DEFAULT_CLIP_PERCENTILE): number[] {
  if (values.length === 0) return [];
  const bounded = Math.min(100, Math.max(0, percentile));
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((bounded / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const threshold = sorted[index] as number;
  return values.map((value) => (value > threshold ? threshold : value));
}

/**
 * Références C3, une par couple `type:taille`.
 *
 * Les tickets qui touchent une zone étudiée sont écartés (`excludeZones`) : la
 * référence doit venir d'ailleurs, sinon la lenteur se compare à elle-même.
 * `computedAt` est l'instant injecté du calcul, jamais une horloge implicite.
 */
export function computeBaselines(
  facts: IssueFact[],
  spansByIssue: Map<string, StatusSpan[]>,
  settings: ProjectSettings,
  now: string,
  excludeZones: string[] = [],
): Map<string, Baseline> {
  const groups = new Map<string, { issueType: string; sizeClass: SizeClass; days: number[] }>();
  for (const fact of facts) {
    if (touchesAnyZone(zonesForIssue(fact, settings), excludeZones)) continue;
    const sizeClass = sizeClassOf(fact, settings);
    const key = baselineKey(fact.type, sizeClass);
    const duration = ticketDurationDays(fact, spansByIssue.get(fact.issueId));
    const group = groups.get(key) ?? { issueType: fact.type, sizeClass, days: [] };
    group.days.push(duration.days);
    groups.set(key, group);
  }

  const baselines = new Map<string, Baseline>();
  for (const [key, group] of groups) {
    baselines.set(key, {
      issueType: group.issueType,
      sizeClass: group.sizeClass,
      medianDays: round2(median(group.days)),
      sampleSize: group.days.length,
      computedAt: now,
    });
  }
  return baselines;
}

/** Vrai quand le ticket touche au moins une des zones écartées. */
function touchesAnyZone(zones: string[], excludeZones: string[]): boolean {
  if (excludeZones.length === 0) return false;
  return zones.some((zone) => excludeZones.includes(zone));
}
