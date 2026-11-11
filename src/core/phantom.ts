/**
 * Dette fantôme (DT-08, §7.2).
 *
 * Une zone qui coûte cher sans qu'aucun ticket de dette ne lui soit rattaché
 * est le signe d'une dette non déclarée : le coût est là, le ticket manque.
 * On ne propose donc pas un remboursement, mais un brouillon de ticket.
 *
 * Le seuil porte sur `ZoneCost.totalJp`, qui est déjà l'addition des familles
 * facturées (§9 : C5, un délai, n'y entre pas). Les preuves citées, elles,
 * sont les faits les plus coûteux de la zone, telles qu'elles ont été mesurées.
 */

import type { Evidence, Family, IssueFact, PhantomDebt, ProjectSettings, ZoneCost } from './types';
import { round2 } from './time';
import { zonesForIssue } from './zones';

/** Nombre de preuves citées pour justifier le brouillon. */
export const PHANTOM_TOP_EVIDENCE = 5;

/**
 * Zones coûteuses qu'aucun ticket de dette ne couvre.
 *
 * Tri de sortie : coût décroissant, puis nom de zone alphabétique — l'ordre
 * est stable pour que deux exécutions rendent la même liste.
 */
export function findPhantomDebt(
  zoneCosts: ZoneCost[],
  debts: IssueFact[],
  evidence: Evidence[],
  settings: ProjectSettings,
): PhantomDebt[] {
  const covered = zonesCoveredByDebt(debts, settings);
  const phantoms: PhantomDebt[] = [];
  for (const cost of zoneCosts) {
    if (!isCandidate(cost, covered, settings)) continue;
    phantoms.push({
      zone: cost.zone,
      totalJp: round2(cost.totalJp),
      byFamily: roundFamilies(cost.byFamily),
      topEvidenceIds: topEvidenceIds(cost.zone, evidence),
    });
  }
  return phantoms.sort(comparePhantoms);
}

/** Zones portées par au moins un ticket de dette désigné par la règle. */
function zonesCoveredByDebt(debts: IssueFact[], settings: ProjectSettings): Set<string> {
  const covered = new Set<string>();
  for (const debt of debts) {
    if (!debt.isDebt) continue;
    for (const zone of zonesForIssue(debt, settings)) covered.add(zone);
  }
  return covered;
}

/** Coût suffisant, et aucun ticket de dette sur la zone. */
function isCandidate(cost: ZoneCost, covered: Set<string>, settings: ProjectSettings): boolean {
  if (!Number.isFinite(cost.totalJp)) return false;
  if (cost.totalJp < settings.phantomThresholdJp) return false;
  return !covered.has(cost.zone);
}

/**
 * Les preuves les plus coûteuses de la zone, du plus lourd au plus léger.
 * Les preuves explicitement masquées pour ce lecteur sont écartées (§18) :
 * on ne cite pas l'identifiant de ce qu'il n'a pas le droit d'ouvrir.
 */
function topEvidenceIds(zone: string, evidence: Evidence[]): string[] {
  return evidence
    .filter((item) => item.zone === zone && item.visible !== false)
    .slice()
    .sort((a, b) => b.costJp - a.costJp || a.id.localeCompare(b.id))
    .slice(0, PHANTOM_TOP_EVIDENCE)
    .map((item) => item.id);
}

/** Ventilation par famille, arrondie au centième. */
function roundFamilies(byFamily: Record<Family, number>): Record<Family, number> {
  return {
    C1: round2(byFamily.C1),
    C2: round2(byFamily.C2),
    C3: round2(byFamily.C3),
    C4: round2(byFamily.C4),
    C5: round2(byFamily.C5),
  };
}

/** Coût décroissant, puis zone alphabétique. */
function comparePhantoms(a: PhantomDebt, b: PhantomDebt): number {
  if (b.totalJp !== a.totalJp) return b.totalJp - a.totalJp;
  return a.zone.localeCompare(b.zone);
}
