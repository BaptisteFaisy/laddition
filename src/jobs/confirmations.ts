import { sql } from '@forge/sql';
import type { Confirmation } from '../core/attribution.ts';
import { insertRows, onDuplicateUpdate, runStatement, selectRows } from '../platform/db/query.ts';
import { toDbDateRequired, toText } from '../platform/db/rows.ts';

/**
 * Rapprochements confirmés par un humain (§10, règle 2).
 *
 * Une confirmation est une **décision**, pas un résultat de calcul : elle doit
 * survivre au recalcul nocturne, qui remplace toutes les attributions. Elle a
 * donc sa propre table, minuscule, hors du schéma du §16 — comme les rejets,
 * qui ont la leur (`rejection`) parce qu'ils servent aussi au calcul.
 */

const TABLE = 'confirmation';
const COLUMNS = ['evidence_id', 'debt_issue_id', 'project_id', 'confirmed_by', 'confirmed_at'] as const;

const DDL =
  `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
  'evidence_id VARCHAR(255) NOT NULL, debt_issue_id VARCHAR(64) NOT NULL, ' +
  'project_id VARCHAR(64) NOT NULL, confirmed_by VARCHAR(128) NOT NULL, ' +
  'confirmed_at DATETIME(3) NOT NULL, PRIMARY KEY (evidence_id, debt_issue_id)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

let tableReady: Promise<void> | null = null;

/** Crée la table des confirmations une seule fois par instance. */
function ensureTable(): Promise<void> {
  tableReady ??= sql
    .executeDDL(DDL)
    .then(() => undefined)
    .catch((error: unknown) => {
      tableReady = null;
      throw error;
    });
  return tableReady;
}

/** Enregistre une confirmation ; rejouer la même décision ne duplique rien. */
export async function addConfirmation(
  projectId: string,
  confirmation: Confirmation & { by: string; at: string },
): Promise<void> {
  await ensureTable();
  await insertRows({
    table: TABLE,
    columns: COLUMNS,
    rows: [confirmation],
    toValues: (item) => [
      item.evidenceId,
      item.debtIssueId,
      projectId,
      item.by,
      toDbDateRequired(item.at),
    ],
    onDuplicate: onDuplicateUpdate(COLUMNS, ['evidence_id', 'debt_issue_id']),
  });
}

/** Confirmations d'un projet, relues par le calcul nocturne. */
export async function listConfirmations(projectId: string): Promise<Confirmation[]> {
  await ensureTable();
  const rows = await selectRows<{ evidence_id: unknown; debt_issue_id: unknown }>(
    `SELECT evidence_id, debt_issue_id FROM ${TABLE} WHERE project_id = ?`,
    [projectId],
  );
  return rows.map((row) => ({
    evidenceId: toText(row.evidence_id),
    debtIssueId: toText(row.debt_issue_id),
  }));
}

/** Retire une confirmation (le rapprochement redevient une proposition). */
export async function removeConfirmation(projectId: string, evidenceId: string, debtIssueId: string): Promise<void> {
  await ensureTable();
  await runStatement(
    `DELETE FROM ${TABLE} WHERE project_id = ? AND evidence_id = ? AND debt_issue_id = ?`,
    [projectId, evidenceId, debtIssueId],
  );
}
