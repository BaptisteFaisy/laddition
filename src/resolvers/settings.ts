import type { Request } from '@forge/resolver';
import type { ProjectSettings } from '../core/types';
import { makeSettings, mergeSettings } from '../core/settings';
import { getSettings as readSettings } from '../platform/db/index';
import { projectIdOf, requireSettings } from '../jobs/projects';
import { saveProjectSettings } from '../jobs/settings';
import type { Failure } from '../jobs/support';
import { guard, isRecord, payloadOf, requireString } from '../jobs/support';

/**
 * Écran 6 : réglages du projet.
 *
 * Le formulaire envoie l'objet complet ; on le fusionne avec les réglages
 * enregistrés, qui sont eux-mêmes bornés (`core/settings.ts`). Un réglage
 * absurde ne peut donc pas casser un calcul : il est ramené dans ses bornes
 * avant d'être écrit, et l'écran reçoit la valeur réellement retenue.
 */

/** Enregistre les réglages et rend ceux qui ont été retenus. */
export async function saveSettings(request: Request<unknown>): Promise<ProjectSettings | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const patch = payload['settings'];
    if (!isRecord(patch)) throw new Error('champ « settings » manquant ou mal formé');
    const base = await baseOf(patch);
    const merged = mergeSettings(base, patch as Partial<ProjectSettings>);
    if (merged.projectId !== base.projectId) throw new Error('le projet d\'un réglage ne se change pas');
    // B27 : la marque « à recalculer » est posée par `jobs/settings.ts`.
    await saveProjectSettings(merged);
    return merged;
  });
}

/**
 * Réglages de départ de la fusion : ceux en base, sinon ceux du payload
 * (premier enregistrement), sinon les défauts du projet.
 */
async function baseOf(patch: Record<string, unknown>): Promise<ProjectSettings> {
  const projectId = requireString(patch, 'projectId');
  const stored = await readSettings(projectId);
  if (stored) return stored;
  return makeSettings(projectId, requireString(patch, 'projectKey'));
}

/** Réglages courants, pour les écrans qui n'ont besoin que de les lire. */
export async function currentSettings(request: Request<unknown>): Promise<ProjectSettings | Failure> {
  return guard(async () => requireSettings(await projectIdOf(payloadOf(request))));
}
