import type { ZoneCost } from '../core/types';
import { round2, weekKey } from '../core/time';

/**
 * Replis d'affichage : coût par équipe et par trimestre.
 *
 * L'UI n'additionne rien (`ui/api.ts`) : ces deux totaux sont donc calculés ici,
 * à la lecture, depuis l'instantané `zone_week` déjà enregistré. Jamais par
 * personne : la maille la plus fine reste l'équipe (§18).
 */

/** Coût d'une équipe sur la fenêtre. */
export interface TeamCost {
  team: string;
  costJp: number;
}

/** Coût d'un trimestre civil. */
export interface QuarterCost {
  quarter: string;
  costJp: number;
}

/** Libellé d'équipe quand ni le graphe ni les réglages ne la donnent. */
export const UNKNOWN_TEAM = 'équipe non renseignée';

/** Coût par équipe, décroissant puis alphabétique : ordre stable à l'écran. */
export function costByTeam(zones: ZoneCost[]): TeamCost[] {
  const totals = new Map<string, number>();
  for (const zone of zones) {
    const team = zone.team ?? UNKNOWN_TEAM;
    totals.set(team, round2((totals.get(team) ?? 0) + zone.totalJp));
  }
  return [...totals.entries()]
    .map(([team, costJp]) => ({ team, costJp }))
    .sort((a, b) => (b.costJp !== a.costJp ? b.costJp - a.costJp : a.team.localeCompare(b.team, 'fr')));
}

/**
 * Coût par trimestre civil, du plus ancien au plus récent.
 *
 * `weeks` et la série de chaque zone sont alignées par `listZoneWeeks` : même
 * index, même semaine. Une semaine ISO compte dans le trimestre de son lundi.
 */
export function costByQuarter(zones: ZoneCost[], weeks: string[]): QuarterCost[] {
  const totals = new Map<string, number>();
  for (const zone of zones) {
    weeks.forEach((week, index) => {
      const cost = zone.weeklyJp[index] ?? 0;
      if (cost === 0) return;
      const quarter = quarterOf(week);
      totals.set(quarter, round2((totals.get(quarter) ?? 0) + cost));
    });
  }
  return [...totals.entries()]
    .map(([quarter, costJp]) => ({ quarter, costJp }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** `2026-11-03` → `2026-T4`. Toute semaine d'un trimestre y est ramenée. */
export function quarterOf(week: string): string {
  const iso = weekKey(week);
  const month = Number(iso.slice(5, 7));
  if (!Number.isFinite(month) || month < 1) return iso.slice(0, 4);
  return `${iso.slice(0, 4)}-T${Math.ceil(month / 3)}`;
}
