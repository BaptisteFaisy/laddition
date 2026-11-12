/**
 * Qualité des données (§14, onglet Méthode).
 *
 * L'app doit dire à quel point elle peut être crue : combien de tickets sans
 * zone, quelles familles ne sont pas chiffrables, quelle part du coût vient
 * d'un temps réellement saisi plutôt que d'une formule. Ces chiffres sont
 * affichés à côté des additions, jamais en note de bas de page.
 *
 * Deux règles de lecture :
 * - les **parts** sont des pourcentages du coût (0-100), arrondis au centième ;
 * - les **comptes** portent sur des tickets, pas sur des preuves : un ticket
 *   sans historique produit une preuve par zone, il ne compte qu'une fois.
 */

import type { CostMethod, DataQuality, Evidence, Family, IssueFact, ProjectSettings } from './types';
import { BILLED_FAMILIES } from './types';
import { round2 } from './time';
import { isUnclassified, zonesForIssue } from './zones';

/** Part du coût portée par chaque méthode de calcul, en pourcentage. */
export type MethodShares = Record<CostMethod, number>;

/** Les trois méthodes du contrat, dans l'ordre d'affichage. */
const METHODS: readonly CostMethod[] = ['logged', 'computed', 'approximated'];

/**
 * Photographie de la qualité des données d'un projet.
 *
 * `methodShares` répond au §19 cas 7 : une équipe qui saisit du temps sur
 * certains tickets seulement voit la part de chaque méthode, pas seulement la
 * part du temps saisi.
 */
export function computeQuality(
  facts: IssueFact[],
  evidence: Evidence[],
  settings: ProjectSettings,
): DataQuality {
  const issuesWithoutZone = facts.filter((fact) =>
    isUnclassified(zonesForIssue(fact, settings)),
  ).length;
  const shares = methodShares(evidence);
  return {
    issuesTotal: facts.length,
    issuesWithoutZone,
    unclassifiedShare: percent(issuesWithoutZone, facts.length),
    insufficientFamilies: insufficientFamilies(evidence),
    loggedShare: shares.logged,
    approximatedIssues: approximatedTickets(evidence),
    methodShares: shares,
  };
}

/** Pourcentage arrondi ; 0 quand le total est nul (rien à mesurer). */
function percent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return round2((part / whole) * 100);
}

/**
 * Tickets dont l'historique de statuts manque : les preuves `approximated`,
 * comptées **une fois par ticket source** (le contrat parle de tickets, et un
 * ticket multi-zones produit plusieurs preuves).
 */
function approximatedTickets(evidence: Evidence[]): number {
  const tickets = new Set<string>();
  for (const item of evidence) {
    if (item.method !== 'approximated') continue;
    tickets.add(item.sourceIssueId);
  }
  return tickets.size;
}

/**
 * Part du coût portée par chaque méthode, en pourcentage (§19 cas 7).
 *
 * Seules les familles facturées comptent : C5 est un délai, pas un coût, et la
 * faire entrer au dénominateur fausserait les trois parts.
 */
export function methodShares(evidence: Evidence[]): MethodShares {
  const costs: Record<CostMethod, number> = { logged: 0, computed: 0, approximated: 0 };
  let total = 0;
  for (const item of evidence) {
    if (!BILLED_FAMILIES.includes(item.family)) continue;
    if (!Number.isFinite(item.costJp)) continue;
    total += item.costJp;
    costs[item.method] += item.costJp;
  }
  const shares = {} as MethodShares;
  for (const method of METHODS) shares[method] = percent(costs[method], total);
  return shares;
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
