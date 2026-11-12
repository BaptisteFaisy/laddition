import { insertRows, onDuplicateUpdate, runDdl, runStatement, selectRows } from '../platform/db/query';
import { toDbDateRequired, toIso, toText } from '../platform/db/rows';
import { oncePerExecutor } from '../platform/db/once';

/**
 * « À recalculer » (§15) : le trigger ne calcule rien, il laisse une trace.
 *
 * Une modification de ticket marque ses zones, un lien créé ou supprimé marque
 * les attributions des deux tickets. Le calcul lourd reste nocturne ; ces
 * marques servent à savoir ce qui a bougé depuis le dernier passage et à
 * l'afficher comme « en attente de recalcul ».
 *
 * L'état tient dans une table minuscule, hors du schéma du §16 (qui décrit les
 * résultats, pas la file de travail) : `recompute_flag`, une ligne par cible.
 */

/** Ce qu'une marque désigne : une zone de coût, ou les attributions d'un ticket. */
export type InvalidationKind = 'zone' | 'attribution';

/** Une marque posée par un trigger. */
export interface Invalidation {
  kind: InvalidationKind;
  target: string;
  at: string;
}

const TABLE = 'recompute_flag';
const COLUMNS = ['project_id', 'kind', 'target', 'marked_at'] as const;

const DDL =
  `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
  'project_id VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, ' +
  'target VARCHAR(255) NOT NULL, marked_at DATETIME(3) NOT NULL, ' +
  'PRIMARY KEY (project_id, kind, target)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/** Crée la table de marques une fois par exécuteur (voir `oncePerExecutor`). */
const ensureTable = oncePerExecutor(() => runDdl(DDL));

/** Marque des cibles « à recalculer » ; rejouer la marque ne duplique rien. */
export async function markInvalid(
  projectId: string,
  kind: InvalidationKind,
  targets: string[],
  at: string,
): Promise<void> {
  const unique = [...new Set(targets.filter((target) => target.length > 0))];
  if (unique.length === 0) return;
  await ensureTable();
  await insertRows({
    table: TABLE,
    columns: COLUMNS,
    rows: unique.map((target) => ({ projectId, kind, target, at })),
    toValues: (row) => [row.projectId, row.kind, row.target, toDbDateRequired(row.at)],
    onDuplicate: onDuplicateUpdate(COLUMNS, ['project_id', 'kind', 'target']),
  });
}

/** Marques en attente d'un projet, les plus récentes d'abord. */
export async function listInvalid(projectId: string): Promise<Invalidation[]> {
  await ensureTable();
  const rows = await selectRows<{ kind: unknown; target: unknown; marked_at: unknown }>(
    `SELECT kind, target, marked_at FROM ${TABLE} WHERE project_id = ? ORDER BY marked_at DESC`,
    [projectId],
  );
  return rows.map((row) => ({
    kind: toText(row.kind) === 'attribution' ? 'attribution' : 'zone',
    target: toText(row.target),
    at: toIso(row.marked_at) ?? '',
  }));
}

/**
 * Efface les marques **traitées** par un recalcul (B20).
 *
 * `at` est l'instant où le recalcul a commencé : une modification survenue
 * après (pendant le calcul) garde sa marque et sera reprise au tour suivant.
 * Un effacement sans filtre, lui, perdait cette modification.
 */
export async function clearInvalidBefore(projectId: string, at: string): Promise<void> {
  await ensureTable();
  await runStatement(`DELETE FROM ${TABLE} WHERE project_id = ? AND marked_at <= ?`, [
    projectId,
    toDbDateRequired(at),
  ]);
}

/** Marques nées après `at` : elles attendent encore un recalcul. */
export function marksAfter(marks: Invalidation[], at: string): Invalidation[] {
  return marks.filter((mark) => mark.at.length > 0 && mark.at > at);
}

/** Retire les marques d'une cible disparue (ticket supprimé, B23). */
export async function dropInvalidTarget(projectId: string, target: string): Promise<void> {
  await ensureTable();
  await runStatement(`DELETE FROM ${TABLE} WHERE project_id = ? AND target = ?`, [projectId, target]);
}
