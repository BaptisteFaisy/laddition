import type { CostContext, Evidence, IssueFact, IssueLink } from '../types.ts';
import { c1Incidents } from './c1.ts';
import { c2Bugs } from './c2.ts';
import { c3Slowness } from './c3.ts';
import { c4Rework } from './c4.ts';
import { c5Delay } from './c5.ts';

/** Familles qui entrent dans l'addition (C5 est un délai, jamais de l'effort). */
export const BILLED = ['C1', 'C2', 'C3', 'C4'] as const;

/**
 * Calcule toutes les preuves d'un projet (§9).
 *
 * L'ordre est stable : familles dans l'ordre C1→C5, puis par zone, puis par
 * identifiant de preuve. Deux exécutions sur le même jeu de données rendent
 * exactement la même liste (§18 « Stabilité »).
 */
export function collectEvidence(
  facts: IssueFact[],
  ctx: CostContext,
  links: IssueLink[] = [],
): Evidence[] {
  const all: Evidence[] = [
    ...c1Incidents(facts, ctx),
    ...c2Bugs(facts, ctx),
    ...c3Slowness(facts, ctx),
    ...c4Rework(facts, ctx),
    ...c5Delay(facts, ctx, links),
  ];
  return sortEvidence(dedupeEvidence(all));
}

/** Deux familles ne doivent jamais produire la même preuve. */
function dedupeEvidence(items: Evidence[]): Evidence[] {
  const byId = new Map<string, Evidence>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

/** Tri déterministe : famille, zone, identifiant. */
function sortEvidence(items: Evidence[]): Evidence[] {
  return items.slice().sort((a, b) => {
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
    return a.id.localeCompare(b.id);
  });
}

/** Ne garde que les preuves qui entrent dans une addition. */
export function billedEvidence(items: Evidence[]): Evidence[] {
  return items.filter((item) => item.family !== 'C5');
}

/** Somme des coûts d'une liste de preuves, arrondie au centième. */
export function totalCost(items: Evidence[]): number {
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.costJp) ? item.costJp : 0), 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}
