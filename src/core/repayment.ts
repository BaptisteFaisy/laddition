/**
 * Bulletin de remboursement (§11, §7.5).
 *
 * Compare le coût hebdomadaire d'une zone avant le travail de remboursement et
 * après la clôture de la dette. C'est une **observation**, jamais une preuve de
 * causalité : chaque bulletin transporte ses limites (`caveats`) et l'écran les
 * affiche avec les chiffres.
 *
 * Module pur : aucune horloge implicite, le « maintenant » est un paramètre.
 */

import type { IssueFact, Repayment } from './types';
import { addDays, parseIso, round2, weekKey } from './time';
import { UNCLASSIFIED_ZONE } from './zones';

/** Nombre de semaines comparées de part et d'autre du travail. */
export const REPAYMENT_WEEKS = 8;

/** En dessous de ce recul, le bulletin affiche « recul insuffisant ». */
export const MIN_WEEKS_AFTER = 4;

/** Limite constante : une comparaison avant/après ne démontre rien. */
export const CAVEAT_COMPARISON = 'comparaison avant/après, sans preuve de causalité';

/** Limite constante : la zone a pu changer pour d'autres raisons. */
export const CAVEAT_OTHER_CHANGES = 'autres changements survenus dans la zone';

/** Limite affichée quand les semaines d'après sont trop peu nombreuses. */
export const CAVEAT_INSUFFICIENT_RECUL = 'recul insuffisant';

/** Préfixe de la limite qui donne la taille de l'échantillon. */
const SAMPLE_CAVEAT_PREFIX = 'échantillon de ';

/** Coût hebdomadaire de la zone, une entrée par semaine ISO (`AAAA-MM-JJ`). */
export interface ZoneWeek {
  week: string;
  costJp: number;
}

/** Moyenne observée sur une fenêtre : taux et nombre de semaines vues. */
interface WeekSlice {
  rate: number;
  weeks: number;
}

/** « échantillon de N semaines » : N = total des semaines réellement observées. */
export function sampleCaveat(weeks: number): string {
  const safe = Number.isFinite(weeks) ? Math.max(0, Math.round(weeks)) : 0;
  return `${SAMPLE_CAVEAT_PREFIX}${safe} ${safe > 1 ? 'semaines' : 'semaine'}`;
}

/** Limites affichées avec un bulletin avant/après. */
export function repaymentCaveats(weeksBefore: number, weeksAfter: number): string[] {
  const caveats = [CAVEAT_COMPARISON, CAVEAT_OTHER_CHANGES, sampleCaveat(weeksBefore + weeksAfter)];
  if (weeksAfter < MIN_WEEKS_AFTER) caveats.push(CAVEAT_INSUFFICIENT_RECUL);
  return caveats;
}

/**
 * Construit le bulletin d'une dette close.
 *
 * - `beforeRate` : moyenne du coût de la zone sur les `REPAYMENT_WEEKS` semaines
 *   **strictement avant** la semaine de `workStartAt` ;
 * - `afterRate` : moyenne sur les `REPAYMENT_WEEKS` semaines **strictement
 *   après** la semaine de `closedAt` ;
 * - `weeksBefore` / `weeksAfter` : semaines réellement présentes dans les
 *   données (la moyenne ne porte que sur celles-là, d'où un compte < 8 possible).
 *
 * Le bulletin naît non publié : le job nocturne renseigne `publishedAt`.
 */
export function buildRepayment(
  debt: IssueFact,
  zoneWeekly: ZoneWeek[],
  closedAt: string,
  workStartAt: string,
): Repayment {
  const index = indexWeekly(zoneWeekly);
  const before = averageOver(index, windowKeys(workStartAt, -1, REPAYMENT_WEEKS));
  const after = averageOver(index, windowKeys(closedAt, 1, REPAYMENT_WEEKS));
  return {
    debtIssueId: debt.issueId,
    key: debt.key,
    zone: primaryZone(debt),
    closedAt,
    beforeRate: before.rate,
    afterRate: after.rate,
    weeksBefore: before.weeks,
    weeksAfter: after.weeks,
    caveats: repaymentCaveats(before.weeks, after.weeks),
    publishedAt: null,
  };
}

/**
 * Vrai quand un bulletin publié ne décrit plus l'état de la dette :
 * elle a été rouverte (`resolvedAt` nul), ou close de nouveau après la
 * publication. Un bulletin jamais publié n'est jamais périmé.
 */
export function isRepaymentStale(debt: IssueFact, published: Repayment | null, now: string): boolean {
  if (!published) return false;
  const publishedAt = parseIso(published.publishedAt);
  const nowDate = parseIso(now);
  // Publication absente, illisible ou encore à venir : rien à périmer.
  if (!publishedAt || !nowDate || publishedAt.getTime() > nowDate.getTime()) return false;
  // Rouverte : la dette n'a plus de date de résolution, le bulletin est faux.
  if (debt.resolvedAt === null) return true;
  const resolved = parseIso(debt.resolvedAt);
  return resolved !== null && resolved.getTime() > publishedAt.getTime();
}

/**
 * Fusionne les bulletins d'un même mois et d'une même zone (§11) : plusieurs
 * dettes closes ensemble donnent **un** bulletin commun, pour ne pas noyer le
 * lecteur sous des comparaisons quasi identiques.
 *
 * Les taux sont des moyennes pondérées par les semaines observées, la zone est
 * conservée, la clé et l'identifiant retenus sont ceux de la première clé
 * alphabétique, et les limites sont recalculées puis complétées des limites
 * propres aux bulletins fusionnés (sans doublon).
 */
export function mergeMonthlyRepayments(items: Repayment[]): Repayment[] {
  const groups = new Map<string, Repayment[]>();
  for (const item of items) {
    const groupKey = `${item.zone}\u0000${monthOf(item.closedAt)}`;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(item);
    else groups.set(groupKey, [item]);
  }
  const merged: Repayment[] = [];
  for (const bucket of groups.values()) {
    merged.push(bucket.length === 1 ? (bucket[0] as Repayment) : mergeBucket(bucket));
  }
  return merged.sort(compareRepayments);
}

/** Bulletin commun d'un groupe (au moins deux bulletins). */
function mergeBucket(bucket: Repayment[]): Repayment {
  const representative = bucket.reduce((first, item) => (item.key < first.key ? item : first));
  const weeksBefore = sumWeeks(bucket, 'weeksBefore');
  const weeksAfter = sumWeeks(bucket, 'weeksAfter');
  return {
    debtIssueId: representative.debtIssueId,
    key: representative.key,
    zone: representative.zone,
    closedAt: representative.closedAt,
    beforeRate: weightedRate(bucket, (item) => item.beforeRate, (item) => item.weeksBefore),
    afterRate: weightedRate(bucket, (item) => item.afterRate, (item) => item.weeksAfter),
    weeksBefore,
    weeksAfter,
    caveats: mergeCaveats(bucket, weeksBefore, weeksAfter),
    publishedAt: mergedPublishedAt(bucket),
  };
}

/** Somme d'un champ « nombre de semaines » du groupe. */
function sumWeeks(bucket: Repayment[], field: 'weeksBefore' | 'weeksAfter'): number {
  let total = 0;
  for (const item of bucket) {
    const value = item[field];
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

/**
 * Moyenne pondérée par les semaines ; à défaut de poids, moyenne simple des
 * valeurs lisibles, et 0 si rien n'est exploitable.
 */
function weightedRate(
  bucket: Repayment[],
  pick: (item: Repayment) => number,
  weight: (item: Repayment) => number,
): number {
  let sum = 0;
  let totalWeight = 0;
  for (const item of bucket) {
    const value = pick(item);
    const itemWeight = weight(item);
    if (!Number.isFinite(value) || !Number.isFinite(itemWeight) || itemWeight <= 0) continue;
    sum += value * itemWeight;
    totalWeight += itemWeight;
  }
  if (totalWeight > 0) return round2(sum / totalWeight);
  const values = bucket.map(pick).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return round2(values.reduce((total, value) => total + value, 0) / values.length);
}

/** Limites recalculées pour le groupe, puis complétées des limites propres. */
function mergeCaveats(bucket: Repayment[], weeksBefore: number, weeksAfter: number): string[] {
  const caveats = repaymentCaveats(weeksBefore, weeksAfter);
  for (const item of bucket) {
    for (const caveat of item.caveats) {
      if (isRecomputedCaveat(caveat) || caveats.includes(caveat)) continue;
      caveats.push(caveat);
    }
  }
  return caveats;
}

/** Limite que la fusion recalcule elle-même : inutile de la recopier. */
function isRecomputedCaveat(caveat: string): boolean {
  return (
    caveat === CAVEAT_COMPARISON ||
    caveat === CAVEAT_OTHER_CHANGES ||
    caveat === CAVEAT_INSUFFICIENT_RECUL ||
    caveat.startsWith(SAMPLE_CAVEAT_PREFIX)
  );
}

/** Date de publication du groupe : conservée seulement si tous la partagent. */
function mergedPublishedAt(bucket: Repayment[]): string | null {
  const first = bucket[0]?.publishedAt ?? null;
  if (first === null) return null;
  const shared = bucket.every((item) => item.publishedAt === first);
  return shared ? first : null;
}

/** Mois de clôture, `AAAA-MM`. */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Ordre stable de sortie : zone, mois, clé. */
function compareRepayments(a: Repayment, b: Repayment): number {
  const byZone = a.zone.localeCompare(b.zone);
  if (byZone !== 0) return byZone;
  const byMonth = monthOf(a.closedAt).localeCompare(monthOf(b.closedAt));
  if (byMonth !== 0) return byMonth;
  return a.key.localeCompare(b.key);
}

/** Zone du bulletin : première zone réelle du ticket, sinon « non classé ». */
function primaryZone(debt: IssueFact): string {
  for (const zone of debt.zones) {
    const trimmed = zone.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return UNCLASSIFIED_ZONE;
}

/** Index semaine → coût ; deux entrées sur la même semaine s'additionnent. */
function indexWeekly(zoneWeekly: ZoneWeek[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const entry of zoneWeekly) {
    const key = weekKey(entry.week);
    const cost = Number.isFinite(entry.costJp) ? entry.costJp : 0;
    index.set(key, (index.get(key) ?? 0) + cost);
  }
  return index;
}

/** Clés des `count` semaines strictement avant (`-1`) ou après (`1`) l'ancre. */
function windowKeys(anchorIso: string, direction: -1 | 1, count: number): string[] {
  const anchor = weekKey(anchorIso);
  const keys: string[] = [];
  for (let step = 1; step <= count; step += 1) {
    keys.push(weekKey(addDays(anchor, direction * 7 * step)));
  }
  return keys;
}

/** Moyenne des semaines de la fenêtre réellement présentes dans l'index. */
function averageOver(index: Map<string, number>, keys: string[]): WeekSlice {
  let sum = 0;
  let weeks = 0;
  for (const key of keys) {
    const cost = index.get(key);
    if (cost === undefined) continue;
    sum += cost;
    weeks += 1;
  }
  return { rate: weeks > 0 ? round2(sum / weeks) : 0, weeks };
}
