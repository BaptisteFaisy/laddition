import type { ProjectSettings } from '../core/types';
import { getSettings, saveSettings } from '../platform/db/index';
import { markInvalid } from './invalidation';
import { nowIso } from './support';

/**
 * Enregistrer des réglages, et marquer le projet à recalculer (B27).
 *
 * Un changement de règle de dette ne change pas seulement l'écran des réglages :
 * il change **quels tickets sont des dettes**, donc toutes les attributions, les
 * additions et le classement. Un changement de mode de zone déplace chaque
 * ticket. Sans marque, les écrans affichent des chiffres calculés avec les
 * anciennes règles jusqu'à la nuit suivante, sans rien dire.
 *
 * TODO(integration) : l'écran des réglages (`src/resolvers/settings.ts`) appelle
 * encore `saveSettings` du dépôt directement ; il doit appeler
 * `saveProjectSettings` d'ici pour que la marque soit posée.
 */

/** Cible « projet entier » : tout est à recalculer, pas une seule zone. */
export const PROJECT_SCOPE = '*';

/** Ce qu'un enregistrement de réglages touche, injectable. */
export interface SettingsPorts {
  read(projectId: string): Promise<ProjectSettings | null>;
  write(settings: ProjectSettings): Promise<void>;
  mark(projectId: string, at: string): Promise<void>;
}

/** Le câblage réel : le dépôt des réglages et la table des marques. */
export const defaultSettingsPorts: SettingsPorts = {
  read: (projectId) => getSettings(projectId),
  write: (settings) => saveSettings(settings),
  mark: async (projectId, at) => {
    await markInvalid(projectId, 'attribution', [PROJECT_SCOPE], at);
    await markInvalid(projectId, 'zone', [PROJECT_SCOPE], at);
  },
};

/**
 * Empreinte des réglages qui **entrent dans le calcul**.
 *
 * Ce qui n'y figure pas ne change aucun chiffre : le taux en euros (affichage),
 * la correspondance zone → équipe (étiquette), le jeu d'exemple (bandeau).
 */
export function recalcFingerprint(settings: ProjectSettings): string {
  return [
    settings.debtRule.kind,
    settings.debtRule.value,
    settings.zoneMode,
    settings.zoneLabelField ?? '',
    settings.hoursPerDay,
    settings.daysPerWeek,
    settings.windowDays,
    settings.deadDays,
    settings.occupationCoefficient,
    settings.persistenceFactor,
    settings.minBaselineSample,
    settings.clipPercentile,
    settings.maxIncidentPeople,
    settings.postMortemBonusJp,
    settings.relevanceFloor,
    settings.phantomThresholdJp,
    settings.storyPointField ?? '',
    [...settings.jsmProjectKeys].sort().join(','),
    teamFingerprint(settings.teamByZone),
  ].join('|');
}

/** Empreinte stable de la correspondance zone → équipe (l'ordre des clés ne compte pas). */
function teamFingerprint(teamByZone: Record<string, string>): string {
  return Object.keys(teamByZone)
    .sort()
    .map((zone) => `${zone}=${teamByZone[zone]}`)
    .join(',');
}

/** Vrai quand ces réglages changent un chiffre : le projet est à recalculer. */
export function settingsAffectRecalc(
  previous: ProjectSettings | null,
  next: ProjectSettings,
): boolean {
  if (!previous) return true;
  return recalcFingerprint(previous) !== recalcFingerprint(next);
}

/**
 * Enregistre les réglages d'un projet et marque le projet à recalculer quand le
 * calcul en dépend. Rend les réglages réellement écrits.
 */
export async function saveProjectSettings(
  settings: ProjectSettings,
  ports: SettingsPorts = defaultSettingsPorts,
): Promise<ProjectSettings> {
  const previous = await ports.read(settings.projectId);
  await ports.write(settings);
  if (settingsAffectRecalc(previous, settings)) await ports.mark(settings.projectId, nowIso());
  return settings;
}
