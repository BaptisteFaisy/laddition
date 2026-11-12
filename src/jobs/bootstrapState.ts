import { createHash } from 'node:crypto';
import { insertRows, onDuplicateUpdate, runDdl, runStatement, selectRows } from '../platform/db/query';
import { toBool, toDbDateRequired, toIso, toNumber, toTextOrNull } from '../platform/db/rows';

/**
 * État des lots d'initialisation (B25, B26).
 *
 * La progression ne peut pas s'additionner de lot en lot : un message rejoué
 * (Forge rejoue un lot en erreur, §24) compterait deux fois les mêmes tickets.
 * Chaque lot a donc sa ligne — ce qu'il a enregistré, combien de fois il a été
 * joué, s'il a déjà poussé le suivant — et la progression du projet est la
 * **somme** de ces lignes : la rejouer donne le même total.
 *
 * Table minuscule, hors du schéma du §16 (qui décrit les résultats, pas la
 * mécanique de reprise) — comme `recompute_flag` et `confirmation`.
 */

const TABLE = 'bootstrap_batch';

const COLUMNS = [
  'project_id',
  'page_token',
  'done',
  'failed',
  'attempts',
  'ingested',
  'pushed',
  'finished',
  'error',
  'updated_at',
] as const;

const DDL =
  `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
  'project_id VARCHAR(64) NOT NULL, page_token VARCHAR(64) NOT NULL, ' +
  'done INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0, ' +
  'attempts INT NOT NULL DEFAULT 1, ingested TINYINT(1) NOT NULL DEFAULT 0, ' +
  'pushed TINYINT(1) NOT NULL DEFAULT 0, finished TINYINT(1) NOT NULL DEFAULT 0, ' +
  'error VARCHAR(512) NULL, ' +
  'updated_at DATETIME(3) NOT NULL, PRIMARY KEY (project_id, page_token)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/**
 * Empreinte du jeton de page : la clé primaire reste courte quelle que soit la
 * longueur du jeton de Jira, et deux fois le même jeton donne la même ligne
 * (c'est ce qui rend le lot rejouable sans double compte).
 */
function tokenKey(pageToken: string): string {
  return createHash('sha256').update(pageToken).digest('hex');
}

let tableReady: Promise<void> | null = null;

/** Crée la table des lots une seule fois par instance. */
function ensureTable(): Promise<void> {
  tableReady ??= runDdl(DDL).catch((error: unknown) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

/** Ce qu'un lot a fait, et combien de fois il a été joué. */
export interface BatchState {
  projectId: string;
  pageToken: string;
  done: number;
  failed: number;
  attempts: number;
  /** Les tickets du lot ont déjà été enregistrés. */
  ingested: boolean;
  /** Le lot suivant a déjà été mis en file. */
  pushed: boolean;
  /** Le lot était le dernier de la chaîne. */
  finished: boolean;
  error: string | null;
  updatedAt: string;
}

/** Totaux d'un projet : la somme de ses lots, jamais une accumulation. */
export interface BatchTotals {
  done: number;
  failed: number;
  batches: number;
  /** Dernière erreur rencontrée, `null` tant que tout va (B26). */
  error: string | null;
  /** Plus grand nombre de rejeux d'un lot (B26). */
  attempts: number;
}

/** Lit l'état d'un lot, ou `null` s'il n'a jamais été joué. */
export async function readBatch(projectId: string, pageToken: string): Promise<BatchState | null> {
  await ensureTable();
  const rows = await selectRows<BatchRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${TABLE} WHERE project_id = ? AND page_token = ? LIMIT 1`,
    [projectId, tokenKey(pageToken)],
  );
  const row = rows[0];
  return row ? toBatchState(row, projectId, pageToken) : null;
}

/** Enregistre l'état d'un lot ; rejouer le même lot ne duplique rien. */
export async function writeBatch(state: BatchState): Promise<void> {
  await ensureTable();
  await insertRows({
    table: TABLE,
    columns: COLUMNS,
    rows: [state],
    toValues: (item) => [
      item.projectId,
      tokenKey(item.pageToken),
      item.done,
      item.failed,
      item.attempts,
      item.ingested ? 1 : 0,
      item.pushed ? 1 : 0,
      item.finished ? 1 : 0,
      item.error,
      toDbDateRequired(item.updatedAt),
    ],
    onDuplicate: onDuplicateUpdate(COLUMNS, ['project_id', 'page_token']),
  });
}

/** Somme des lots d'un projet : la progression, rejouable sans double compte. */
export async function sumBatches(projectId: string): Promise<BatchTotals> {
  await ensureTable();
  const rows = await selectRows<SumRow>(
    `SELECT COALESCE(SUM(done), 0) AS done, COALESCE(SUM(failed), 0) AS failed,
            COUNT(*) AS batches, COALESCE(MAX(attempts), 0) AS attempts
       FROM ${TABLE} WHERE project_id = ?`,
    [projectId],
  );
  const totals = rows[0];
  return {
    done: toNumber(totals?.done),
    failed: toNumber(totals?.failed),
    batches: toNumber(totals?.batches),
    attempts: toNumber(totals?.attempts),
    error: await lastError(projectId),
  };
}

/** Dernière erreur d'un lot du projet (B26 : pas de rejeu muet). */
async function lastError(projectId: string): Promise<string | null> {
  const rows = await selectRows<{ error: unknown }>(
    `SELECT error FROM ${TABLE} WHERE project_id = ? AND error IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [projectId],
  );
  return rows[0] ? toTextOrNull(rows[0].error) : null;
}

/** Oublie l'état des lots d'un projet : une nouvelle initialisation repart à zéro. */
export async function resetBatches(projectId: string): Promise<void> {
  await ensureTable();
  await runStatement(`DELETE FROM ${TABLE} WHERE project_id = ?`, [projectId]);
}

/** Ligne `bootstrap_batch`, telle que rendue par une lecture. */
interface BatchRow {
  done: unknown;
  failed: unknown;
  attempts: unknown;
  ingested: unknown;
  pushed: unknown;
  finished: unknown;
  error: unknown;
  updated_at: unknown;
}

/** Ligne d'agrégat, telle que rendue par une lecture. */
interface SumRow {
  done: unknown;
  failed: unknown;
  batches: unknown;
  attempts: unknown;
}

const SELECT_COLUMNS = 'done, failed, attempts, ingested, pushed, finished, error, updated_at';

/** Ligne SQL → état de lot. */
function toBatchState(row: BatchRow, projectId: string, pageToken: string): BatchState {
  return {
    projectId,
    pageToken,
    done: toNumber(row.done),
    failed: toNumber(row.failed),
    attempts: toNumber(row.attempts, 1),
    ingested: toBool(row.ingested),
    pushed: toBool(row.pushed),
    finished: toBool(row.finished),
    error: toTextOrNull(row.error),
    updatedAt: toIso(row.updated_at) ?? '',
  };
}
