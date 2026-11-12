/**
 * Exécution des écritures du double SQL : `INSERT`, `UPDATE`, `DELETE`.
 *
 * Fidélité voulue, dans la limite du double :
 * - `INSERT … ON DUPLICATE KEY UPDATE` met à jour la ligne de même clé
 *   primaire, sinon insère (et sans clause de mise à jour, une clé dupliquée
 *   est une erreur, comme dans MySQL) ;
 * - `DELETE … LIMIT n` et `UPDATE … LIMIT n` bornent le nombre de lignes,
 *   ce que la purge (C37) utilise pour rester sous les 5 s par requête ;
 * - une sous-requête dans un `IN` est exécutée sur le magasin courant.
 */

import type { Operand } from './fakeCondition';
import { evaluate, resolve } from './fakeCondition';
import type { DeleteStatement, InsertStatement, UpdateStatement } from './fakeStatements';
import type { FakeStore, FakeTable } from './fakeStore';
import type { FakeRow } from './fakeTypes';
import { evalContext, limitOf, singleRow } from './fakeSelect';

/** Insère (ou met à jour) les n-uplets d'un `INSERT`. */
export function executeInsert(
  store: FakeStore,
  statement: InsertStatement,
  params: readonly unknown[],
): number {
  const table = store.require(statement.table);
  for (const tuple of statement.tuples) {
    const row = buildRow(store, table, statement.columns, tuple, params);
    upsertRow(store, table, row, statement.updates, params);
  }
  return statement.tuples.length;
}

/** Met à jour les lignes qui satisfont la condition. */
export function executeUpdate(
  store: FakeStore,
  statement: UpdateStatement,
  params: readonly unknown[],
): number {
  const table = store.require(statement.table);
  const bound = limitOf(statement.limit, params);
  let affected = 0;
  for (const row of table.rows) {
    if (bound !== null && affected >= bound) break;
    if (statement.where && !matches(store, table, row, statement.where, params)) continue;
    for (const assignment of statement.assignments) {
      row[assignment.column] = resolveOperand(store, table, row, assignment.value, params);
    }
    affected += 1;
  }
  return affected;
}

/** Efface les lignes qui satisfont la condition. */
export function executeDelete(
  store: FakeStore,
  statement: DeleteStatement,
  params: readonly unknown[],
): number {
  const table = store.require(statement.table);
  const bound = limitOf(statement.limit, params);
  const kept: FakeRow[] = [];
  let affected = 0;
  for (const row of table.rows) {
    const wanted = !statement.where || matches(store, table, row, statement.where, params);
    if (wanted && (bound === null || affected < bound)) {
      affected += 1;
      continue;
    }
    kept.push(row);
  }
  table.rows = kept;
  return affected;
}

/** Vrai si la ligne satisfait la condition. */
function matches(
  store: FakeStore,
  table: FakeTable,
  row: FakeRow,
  condition: NonNullable<UpdateStatement['where']>,
  params: readonly unknown[],
): boolean {
  return evaluate(condition, evalContext(store, singleRow(table.name, row), params));
}

/** Construit une ligne complète : toutes les colonnes, celles absentes à `null`. */
function buildRow(
  store: FakeStore,
  table: FakeTable,
  columns: readonly string[],
  tuple: readonly Operand[],
  params: readonly unknown[],
): FakeRow {
  const row: FakeRow = {};
  for (const column of table.columns) row[column] = null;
  columns.forEach((column, index) => {
    const operand = tuple[index];
    row[column] = operand ? resolveOperand(store, table, row, operand, params) : null;
  });
  return row;
}

/** Insère la ligne, ou met à jour celle de même clé primaire. */
function upsertRow(
  store: FakeStore,
  table: FakeTable,
  row: FakeRow,
  updates: readonly { column: string; fromValues: boolean; source: Operand | null }[],
  params: readonly unknown[],
): void {
  const key = table.primaryKey.map((column) => row[column]);
  const existing = store.findByKey(table, key);
  if (!existing) {
    table.rows.push(row);
    return;
  }
  if (updates.length === 0) {
    throw new Error(`double SQL : clé dupliquée dans « ${table.name} »`);
  }
  for (const update of updates) {
    existing[update.column] = update.source
      ? resolveOperand(store, table, row, update.source, params)
      : row[update.column] ?? null;
  }
}

/** Valeur d'un opérande dans le contexte d'une ligne. */
function resolveOperand(
  store: FakeStore,
  table: FakeTable,
  row: FakeRow,
  operand: Operand,
  params: readonly unknown[],
): unknown {
  return resolve(operand, evalContext(store, singleRow(table.name, row), params));
}
