/**
 * Cache des scores de pertinence (§18, item B16).
 *
 * « Le même jeu de données donne la même addition ; les scores de pertinence
 * sont mis en cache et ne sont recalculés que si un texte change. » Sans
 * table, le cache de `platform/llm.ts` ne vit que le temps d'une invocation :
 * chaque nuit repaierait les mêmes couples au modèle. `score_cache` le rend
 * durable, par projet, et la clé est l'empreinte des deux textes comparés
 * (`fingerprintOf` de `platform/llm.ts`) — un texte qui change change
 * l'empreinte, donc le score est recalculé.
 *
 * Lecture/écriture groupées : une requête par lot, jamais une par empreinte.
 */

import type { SqlValue } from '../query';
import {
  chunkList,
  DEFAULT_BATCH_SIZE,
  insertRows,
  onDuplicateUpdate,
  selectAllBatched,
  selectRows,
} from '../query';
import { toDbDateRequired, toNumber, toText } from '../rows';

/** Une entrée du cache : une empreinte, un score, sa justification. */
export interface ScoreCacheEntry {
  fingerprint: string;
  relevance: number;
  rationale: string;
}

/** Ligne `score_cache`, telle que rendue par une lecture. */
interface ScoreCacheRow {
  fingerprint: string;
  relevance: unknown;
  rationale: unknown;
}

const SCORE_COLUMNS = ['fingerprint', 'project_id', 'relevance', 'rationale', 'computed_at'] as const;

/** Lecture : `project_id` sert de filtre, `computed_at` sert à la purge. */
const SCORE_SELECT = 'fingerprint, relevance, rationale';

/**
 * Écrit (ou rafraîchit) les scores d'un projet, en écriture groupée.
 *
 * `computedAt` borne l'âge du cache (horloge explicite, comme dans `core/`) ;
 * absent, c'est l'instant de l'appel.
 */
export async function saveScores(
  projectId: string,
  entries: readonly ScoreCacheEntry[],
  computedAt: string = new Date().toISOString(),
): Promise<void> {
  const fresh = entries.filter((entry) => entry.fingerprint.length > 0);
  if (fresh.length === 0) return;
  const stamp = toDbDateRequired(computedAt);
  await insertRows({
    table: 'score_cache',
    columns: SCORE_COLUMNS,
    rows: fresh,
    toValues: (entry): SqlValue[] => [entry.fingerprint, projectId, entry.relevance, entry.rationale, stamp],
    onDuplicate: onDuplicateUpdate(SCORE_COLUMNS, ['fingerprint', 'project_id']),
  });
}

/**
 * Scores d'une liste d'empreintes, indexés par empreinte.
 *
 * Une empreinte absente du résultat n'a jamais été évaluée : l'appelant la
 * demande au modèle, puis l'enregistre avec `saveScores`.
 */
export async function getScores(
  projectId: string,
  fingerprints: readonly string[],
): Promise<Map<string, ScoreCacheEntry>> {
  const found = new Map<string, ScoreCacheEntry>();
  const unique = [...new Set(fingerprints)].filter((fingerprint) => fingerprint.length > 0);
  for (const group of chunkList(unique, DEFAULT_BATCH_SIZE)) {
    const placeholders = group.map(() => '?').join(', ');
    const rows = await selectRows<ScoreCacheRow>(
      `SELECT ${SCORE_SELECT} FROM score_cache
        WHERE project_id = ? AND fingerprint IN (${placeholders})
        ORDER BY fingerprint`,
      [projectId, ...group],
    );
    for (const row of rows) found.set(row.fingerprint, toEntry(row));
  }
  return found;
}

/** Tout le cache d'un projet : de quoi le précharger en mémoire (§18). */
export async function listScores(projectId: string): Promise<Map<string, ScoreCacheEntry>> {
  const rows = await selectAllBatched<ScoreCacheRow>(
    `SELECT ${SCORE_SELECT} FROM score_cache WHERE project_id = ? ORDER BY fingerprint`,
    [projectId],
  );
  const found = new Map<string, ScoreCacheEntry>();
  for (const row of rows) found.set(row.fingerprint, toEntry(row));
  return found;
}

/** Compte les entrées du cache d'un projet (sonde de volume, §17 : 1 Gio). */
export async function countScores(projectId: string): Promise<number> {
  const rows = await selectRows<{ total: unknown }>(
    'SELECT COUNT(*) AS total FROM score_cache WHERE project_id = ?',
    [projectId],
  );
  return toNumber(rows[0]?.total);
}

/** Ligne SQL → entrée de cache. */
function toEntry(row: ScoreCacheRow): ScoreCacheEntry {
  return {
    fingerprint: row.fingerprint,
    relevance: toNumber(row.relevance),
    rationale: toText(row.rationale),
  };
}
