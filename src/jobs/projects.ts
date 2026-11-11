import type { ProjectSettings } from '../core/types.ts';
import { getSettings } from '../platform/db/index.ts';
import { selectRows } from '../platform/db/query.ts';
import { toText } from '../platform/db/rows.ts';
import { optionalString, requireString } from './support.ts';

/**
 * Retrouver un projet à partir de ce que l'écran ou l'événement connaît :
 * un identifiant, une clé de projet, ou la clé d'un ticket.
 *
 * TODO(integration) : ces deux lectures appartiennent à
 * `platform/db/repos/project.ts` (listProjectIds, projectIdByKey). Elles
 * restent ici, en une requête chacune, tant que le dépôt ne les expose pas.
 */

/** Identifiants de tous les projets réglés : la liste que parcourt la nuit. */
export async function listProjectIds(): Promise<string[]> {
  const rows = await selectRows<{ project_id: unknown }>(
    'SELECT project_id FROM settings ORDER BY project_id',
  );
  return rows.map((row) => toText(row.project_id)).filter((id) => id.length > 0);
}

/** Projet d'une clé de projet (`PAY`), ou `null` s'il n'a jamais été réglé. */
export async function projectIdByKey(projectKey: string): Promise<string | null> {
  const rows = await selectRows<{ project_id: unknown }>(
    'SELECT project_id FROM settings WHERE project_key = ? LIMIT 1',
    [projectKey],
  );
  const row = rows[0];
  return row ? toText(row.project_id) : null;
}

/** Projet visé par un payload d'écran : identifiant direct, sinon clé de projet. */
export async function projectIdOf(payload: Record<string, unknown>): Promise<string> {
  const direct = optionalString(payload, 'projectId');
  if (direct) return direct;
  const key = requireString(payload, 'projectKey');
  const found = await projectIdByKey(key);
  if (!found) throw new Error(`projet « ${key} » inconnu : ouvrir l'écran Réglages`);
  return found;
}

/** Réglages d'un projet ; jette si le projet n'a jamais été configuré. */
export async function requireSettings(projectId: string): Promise<ProjectSettings> {
  const settings = await getSettings(projectId);
  if (!settings) throw new Error(`projet « ${projectId} » sans réglages : ouvrir l'écran Réglages`);
  return settings;
}
