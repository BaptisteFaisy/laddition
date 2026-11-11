import type { Evidence, Family, ZoneCost } from '../core/types.ts';
import { BILLED_FAMILIES } from '../core/types.ts';
import type { ZoneWeek } from '../core/repayment.ts';
import type { ZoneWeekInput } from '../platform/db/index.ts';
import { round2, weekKey } from '../core/time.ts';

/**
 * Repli des preuves en cases zone × semaine (table `zone_week`, §16).
 *
 * La lecture et l'agrégation vivent dans `platform/db/repos/bills.ts`
 * (`listZoneWeeks`) : ici, seulement l'écriture, c'est-à-dire le passage des
 * preuves à l'instantané hebdomadaire que le calcul nocturne enregistre.
 */

/** Toutes les familles à zéro. Rend un objet neuf : jamais un objet partagé. */
export function emptyFamilies(): Record<Family, number> {
  return { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 };
}

/** Vrai quand la famille entre dans l'addition : C5 est un délai, pas un effort. */
function isBilled(family: Family): boolean {
  return BILLED_FAMILIES.includes(family);
}

/**
 * Coûts hebdomadaires par zone, prêts pour `upsertZoneWeek`.
 *
 * C5 est écartée : c'est un retard, jamais de l'effort (§9). Une preuve masquée
 * est comptée quand même — le masquage est une affaire de lecture (§18), pas de
 * calcul. `teamByZone` vient des réglages quand le graphe ne donne pas l'équipe.
 */
export function weeklyZoneCosts(
  evidence: Evidence[],
  projectId: string,
  teamByZone: Record<string, string> = {},
): ZoneWeekInput[] {
  const rows = new Map<string, ZoneWeekInput>();
  for (const item of evidence) {
    if (!isBilled(item.family)) continue;
    const week = weekKey(item.occurredAt);
    const id = `${item.zone}|${week}`;
    const row = rows.get(id) ?? {
      projectId,
      zone: item.zone,
      week,
      costJp: 0,
      byFamily: emptyFamilies(),
      team: teamByZone[item.zone],
    };
    row.costJp = round2(row.costJp + item.costJp);
    row.byFamily[item.family] = round2(row.byFamily[item.family] + item.costJp);
    rows.set(id, row);
  }
  return [...rows.values()].sort(compareRows);
}

/** Ordre stable : zone alphabétique, puis semaine croissante. */
function compareRows(a: ZoneWeekInput, b: ZoneWeekInput): number {
  const byZone = a.zone.localeCompare(b.zone, 'fr');
  return byZone !== 0 ? byZone : a.week.localeCompare(b.week);
}

/**
 * Série hebdomadaire d'une zone, alignée sur `weeks` (semaines ISO triées).
 * C'est la forme qu'attend `buildRepayment` pour un bulletin avant/après.
 */
export function zoneWeekly(cost: ZoneCost | undefined, weeks: string[]): ZoneWeek[] {
  const series = cost?.weeklyJp ?? [];
  return weeks.map((week, index) => ({ week, costJp: series[index] ?? 0 }));
}
