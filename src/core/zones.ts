import type { IssueFact, ProjectSettings } from './types';

/** Zone des tickets sans rattachement : taille affichée comme indicateur (§8). */
export const UNCLASSIFIED_ZONE = 'non classé';

/**
 * Zone unique d'un projet sans composants (§19 cas 1).
 *
 * Ce n'est pas un `ZoneMode` du contrat : c'est le repli que l'app peut choisir
 * quand le projet ne décrit aucune zone. Elle s'accompagne toujours d'un
 * avertissement (`ZoneModeSignal.warning`) : regrouper toutes les preuves dans
 * une seule zone est une décision visible, pas un seau muet.
 */
export const PROJECT_ZONE = 'projet';

/** Réglage de repli accepté par `zonesForIssue`. */
export interface ZoneOptions {
  /**
   * Zone à utiliser quand le ticket n'a aucune source de zone. Par défaut
   * `UNCLASSIFIED_ZONE` ; l'app passe `PROJECT_ZONE` quand elle a choisi le mode
   * « zone unique » du §19 cas 1.
   */
  fallbackZone?: string;
}

/**
 * Ce que l'app doit dire au lecteur quand le projet ne décrit aucune zone
 * (§19 cas 1) : le constat, le mode recommandé, et l'avertissement à afficher.
 */
export interface ZoneModeSignal {
  /** Vrai quand aucun ticket du projet ne porte de composant Jira. */
  missingComponents: boolean;
  /** Mode à appliquer : celui des réglages, `label`, ou la zone unique `project`. */
  recommendedMode: ProjectSettings['zoneMode'] | 'project';
  /** Nom de la zone unique proposée quand `recommendedMode` vaut `project`. */
  projectZone: string;
  /** Avertissement à afficher ; vide quand le projet décrit ses zones. */
  warning: string;
}

/**
 * Zones d'un ticket, par ordre de priorité du §8 :
 * 1. composant Jira ; 2. composant Compass ; 3. service affecté (incident) ;
 * 4. étiquette, si le projet a choisi ce mode.
 *
 * Le mode du projet décide de la première source disponible ; à défaut de
 * toute source, le ticket tombe dans `options.fallbackZone`, sinon dans
 * `UNCLASSIFIED_ZONE`.
 */
export function zonesForIssue(
  fact: IssueFact,
  settings: ProjectSettings,
  options?: ZoneOptions,
): string[] {
  const picked = pickByMode(fact, settings);
  const cleaned = picked.map((zone) => zone.trim()).filter((zone) => zone.length > 0);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : [options?.fallbackZone ?? UNCLASSIFIED_ZONE];
}

/**
 * Constat de zone d'un projet entier (§19 cas 1).
 *
 * Trois issues : le projet a des composants (rien à signaler) ; il n'en a pas
 * mais des étiquettes de zone existent (le mode étiquette est recommandé) ; il
 * n'a ni l'un ni l'autre (la zone unique « projet » est recommandée, avec son
 * avertissement).
 */
export function detectZoneMode(facts: IssueFact[], settings: ProjectSettings): ZoneModeSignal {
  if (facts.some((fact) => fact.components.length > 0)) {
    return zoneSignal(false, settings.zoneMode, '');
  }
  if (settings.zoneMode === 'label' || facts.some((fact) => labelZones(fact, settings).length > 0)) {
    return zoneSignal(
      true,
      'label',
      'Projet sans composants Jira : les zones viennent des étiquettes. Vérifiez que chaque ticket porte la sienne.',
    );
  }
  return zoneSignal(
    true,
    'project',
    `Projet sans composants Jira ni étiquettes de zone : toutes les preuves sont regroupées dans la zone unique « ${PROJECT_ZONE} ». Les chiffres restent vrais, le découpage par zone ne dit rien.`,
  );
}

/**
 * Réglage de repli cohérent avec `detectZoneMode` : la zone unique « projet »
 * quand le projet ne décrit aucune zone, rien sinon.
 *
 * L'app doit le passer **partout** (`zonesForIssue` côté preuves et côté
 * tickets stockés) : une zone résolue d'un côté et pas de l'autre casserait le
 * rapprochement preuve ↔ dette.
 */
export function zoneOptionsOf(facts: IssueFact[], settings: ProjectSettings): ZoneOptions {
  const signal = detectZoneMode(facts, settings);
  if (!signal.missingComponents || signal.recommendedMode !== 'project') return {};
  return { fallbackZone: signal.projectZone };
}

/** Signal de zone construit une fois, pour les trois issues. */
function zoneSignal(
  missingComponents: boolean,
  recommendedMode: ZoneModeSignal['recommendedMode'],
  warning: string,
): ZoneModeSignal {
  return { missingComponents, recommendedMode, projectZone: PROJECT_ZONE, warning };
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
