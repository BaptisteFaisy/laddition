import type { IssueFact, ProjectSettings } from './types';

/** Zone des tickets sans rattachement : taille affichée comme indicateur (§8). */
export const UNCLASSIFIED_ZONE = 'non classé';

/**
 * Zones d'un ticket, par ordre de priorité du §8 :
 * 1. composant Jira ; 2. composant Compass ; 3. service affecté (incident) ;
 * 4. étiquette, si le projet a choisi ce mode.
 *
 * Le mode du projet décide de la première source disponible ; à défaut de
 * toute source, le ticket tombe dans `UNCLASSIFIED_ZONE`.
 */
export function zonesForIssue(fact: IssueFact, settings: ProjectSettings): string[] {
  const picked = pickByMode(fact, settings);
  const cleaned = picked.map((zone) => zone.trim()).filter((zone) => zone.length > 0);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : [UNCLASSIFIED_ZONE];
}

/** Sélection selon le mode de zone, avec repli en cascade sur les autres sources. */
function pickByMode(fact: IssueFact, settings: ProjectSettings): string[] {
  switch (settings.zoneMode) {
    case 'component':
      return firstNonEmpty(fact.components, fact.zones, fact.affectedServices, labelZones(fact, settings));
    case 'compass':
      return firstNonEmpty(fact.zones, fact.components, fact.affectedServices, labelZones(fact, settings));
    case 'service':
      return firstNonEmpty(fact.affectedServices, fact.components, fact.zones, labelZones(fact, settings));
    case 'label':
      return firstNonEmpty(labelZones(fact, settings), fact.components, fact.zones, fact.affectedServices);
    default:
      return firstNonEmpty(fact.components, fact.zones, fact.affectedServices);
  }
}

/** Première liste non vide de la cascade. */
function firstNonEmpty(...candidates: string[][]): string[] {
  for (const candidate of candidates) {
    if (candidate.length > 0) return candidate;
  }
  return [];
}

/** Étiquettes utilisables comme zones : préfixe `zone:` ou étiquette brute. */
function labelZones(fact: IssueFact, settings: ProjectSettings): string[] {
  const prefix = settings.zoneLabelField ? `${settings.zoneLabelField}:` : 'zone:';
  const fromPrefix = fact.labels
    .filter((label) => label.startsWith(prefix))
    .map((label) => label.slice(prefix.length));
  if (fromPrefix.length > 0) return fromPrefix;
  return settings.zoneMode === 'label' ? fact.labels.slice() : [];
}

/**
 * Un ticket rattaché à plusieurs zones partage son coût à parts égales (§8).
 * La somme des parts vaut exactement le coût, au centième près.
 */
export function splitAcrossZones(costJp: number, zones: string[]): Array<{ zone: string; costJp: number }> {
  if (zones.length === 0) return [{ zone: UNCLASSIFIED_ZONE, costJp }];
  if (zones.length === 1) return [{ zone: zones[0] as string, costJp }];
  const share = costJp / zones.length;
  return zones.map((zone) => ({ zone, costJp: share }));
}

/** Vrai quand le ticket n'a aucun rattachement réel. */
export function isUnclassified(zones: string[]): boolean {
  return zones.length === 0 || (zones.length === 1 && zones[0] === UNCLASSIFIED_ZONE);
}

/** Part des tickets sans zone, en pourcentage arrondi. */
export function unclassifiedShare(facts: IssueFact[], settings: ProjectSettings): number {
  if (facts.length === 0) return 0;
  const without = facts.filter((fact) => isUnclassified(zonesForIssue(fact, settings))).length;
  return Math.round((without / facts.length) * 10000) / 100;
}
