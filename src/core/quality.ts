/**
 * Qualité des données (§14, onglet Méthode).
 *
 * L'app doit dire à quel point elle peut être crue : combien de tickets sans
 * zone, quelles familles ne sont pas chiffrables, quelle part du coût vient
 * d'un temps réellement saisi plutôt que d'une formule. Ces chiffres sont
 * affichés à côté des additions, jamais en note de bas de page.
 */

import type { DataQuality, Evidence, Family, IssueFact, ProjectSettings } from './types';
import { BILLED_FAMILIES } from './types';
import { round2 } from './time';
import { isUnclassified, zonesForIssue } from './zones';

/**
 * Photographie de la qualité des données d'un projet.
 *
 * Les parts sont des pourcentages arrondis au centième (0-100), pas des
 * fractions : ils s'affichent tels quels dans l'onglet Méthode.
 */
export function computeQuality(
  facts: IssueFact[],
  evidence: Evidence[],
  settings: ProjectSettings,
): DataQuality {
  const issuesWithoutZone = facts.filter((fact) =>
    isUnclassified(zonesForIssue(fact, settings)),
  ).length;
  return {
    issuesTotal: facts.length,
    issuesWithoutZone,
    unclassifiedShare: percent(issuesWithoutZone, facts.length),
    insufficientFamilies: insufficientFamilies(evidence),
    loggedShare: loggedShare(evidence),
    approximatedIssues: evidence.filter((item) => item.method === 'approximated').length,
  };
}

/** Pourcentage arrondi ; 0 quand le total est nul (rien à mesurer). */
function percent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return round2((part / whole) * 100);
}

/**
 * Couples zone × famille déclarés « données insuffisantes » (C3 sous le
 * minimum de références, §9). Dédupliqués et triés : la liste est un constat,
 * pas un journal — une famille insuffisante l'est une fois par zone.
 */
function insufficientFamilies(evidence: Evidence[]): Array<{ zone: string; family: Family }> {
  const seen = new Set<string>();
  const pairs: Array<{ zone: string; family: Family }> = [];
  for (const item of evidence) {
    if (!item.insufficient) continue;
    const signature = `${item.zone}\u0000${item.family}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    pairs.push({ zone: item.zone, family: item.family });
  }
  return pairs.sort((a, b) => a.zone.localeCompare(b.zone) || a.family.localeCompare(b.family));
}

/**
 * Part du coût portée par un temps saisi (`logged`), en pourcentage.
 * Seules les familles facturées comptent : C5 est un délai, pas un coût, et
 * la faire entrer au dénominateur gonflerait artificiellement la part calculée.
 */
function loggedShare(evidence: Evidence[]): number {
  let total = 0;
  let logged = 0;
  for (const item of evidence) {
    if (!BILLED_FAMILIES.includes(item.family)) continue;
    if (!Number.isFinite(item.costJp)) continue;
    total += item.costJp;
    if (item.method === 'logged') logged += item.costJp;
  }
  return percent(logged, total);
}
