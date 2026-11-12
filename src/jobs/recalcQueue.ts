import { Queue } from '@forge/events';
import type { Deadline } from './deadline';
import { createDeadline, DEFAULT_BUDGET_MS } from './deadline';
import { recalcProject } from './recalc';
import type { ProjectRecalc } from './recalc';
import { messageOf } from './support';

/**
 * File des travaux lourds : **un message par projet** (C34).
 *
 * La nuit ne calcule plus tous les projets en série dans un seul
 * `scheduledTrigger` à 900 s : elle met un message en file par projet, et le
 * consommateur existant les traite un par un, chacun avec sa propre limite de
 * 900 s. Un projet lent ne bloque plus les autres, et un échec ne rejoue que le
 * projet concerné.
 *
 * La file est celle de l'initialisation (`laddition-bootstrap`, déjà déclarée au
 * manifeste) : le consommateur aiguille sur le champ `kind` du message, donc
 * aucun module de manifeste n'est à ajouter.
 */

/** File de messages de l'app : initialisation par lots et recalcul par projet. */
export const APP_QUEUE = 'laddition-bootstrap';

/** Discriminant d'un message de recalcul. */
export const RECALC_KIND = 'recalc';

/** Corps d'un message de recalcul. */
export interface RecalcPayload {
  kind: typeof RECALC_KIND;
  projectId: string;
}

/** Pousse un message dans la file de l'app. */
export async function pushQueueMessage(body: Record<string, unknown>): Promise<void> {
  const queue = new Queue<Record<string, unknown>>({ key: APP_QUEUE });
  await queue.push({ body });
}

/** Met un projet en file pour recalcul (C34). */
export async function enqueueRecalc(projectId: string): Promise<void> {
  await pushQueueMessage({ kind: RECALC_KIND, projectId });
}

/** Vrai quand un corps de message demande un recalcul de projet. */
export function isRecalcPayload(body: Record<string, unknown>): boolean {
  return body['kind'] === RECALC_KIND && typeof body['projectId'] === 'string';
}

/**
 * Traite un message de recalcul : un projet, sous garde de durée.
 *
 * La garde rend la main proprement avant la limite Forge : le projet restera
 * marqué « à recalculer » et sera repris la nuit suivante, plutôt que d'être
 * tué en plein milieu sans bilan.
 */
export async function runRecalcMessage(
  projectId: string,
  now: string,
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<ProjectRecalc> {
  const deadline: Deadline = createDeadline(budgetMs);
  try {
    return await recalcProject(projectId, now, { deadline, enqueue: enqueueRecalc });
  } catch (error) {
    return { projectId, evidence: 0, bills: 0, fieldUpdated: 0, error: messageOf(error) };
  }
}
