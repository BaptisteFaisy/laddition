/**
 * Exécution des `SELECT` du double SQL.
 *
 * Ordre d'exécution, celui de MySQL : sources et jointures → `WHERE` →
 * `ORDER BY` → `LIMIT` → projection. Les jointures sont des produits
 * cartésiens filtrés : le double n'a pas à être rapide, seulement fidèle.
 */

import type { EvalContext, Operand, RowReader } from './fakeCondition';
import { compareValues, evaluate, parseOperand, resolve } from './fakeCondition';
import type { SelectItem, SelectStatement } from './fakeStatements';
import { tokenize } from './fakeTokens';
import type { FakeStore } from './fakeStore';
import type { CombinedRow, FakeRow } from './fakeTypes';

/** Exécute un `SELECT` et rend ses lignes. */
export function executeSelect(
  store: FakeStore,
  statement: SelectStatement,
  params: readonly unknown[],
): FakeRow[] {
  const combined = joinSources(store, statement, params);
  const where = statement.where;
  const filtered = where
    ? combined.filter((row) => evaluate(where, evalContext(store, row, params)))
    : combined;
  const ordered = orderRows(store, filtered, statement, params);
  const window = applyWindow(ordered, statement.limit, statement.offset, params);
  return project(store, window, statement.items, params);
}

/** Valeurs de la première colonne d'un `SELECT` (sous-requête d'un `IN`). */
export function firstColumn(store: FakeStore, statement: SelectStatement, params: readonly unknown[]): unknown[] {
  const rows = executeSelect(store, statement, params);
  return rows.map((row) => Object.values(row)[0] ?? null);
}

/** Contexte d'évaluation d'une ligne combinée. */
export function evalContext(
  store: FakeStore,
  row: CombinedRow,
  params: readonly unknown[],
): EvalContext {
  return {
    row: combinedReader(row),
    params,
    subquery: (sub) => firstColumn(store, sub, params),
  };
}

/** Lecteur de colonne d'une ligne combinée (nom qualifié ou non). */
export function combinedReader(row: CombinedRow): RowReader {
  return {
    value(name: string): unknown {
      const dot = name.indexOf('.');
      if (dot > 0) {
        const alias = name.slice(0, dot);
        const column = name.slice(dot + 1);
        const source = row.sources.find((item) => item.alias === alias);
        return source ? source.row[column] ?? null : null;
      }
      for (const source of row.sources) {
        if (Object.prototype.hasOwnProperty.call(source.row, name)) return source.row[name] ?? null;
      }
      return null;
    },
  };
}

/** Une source seule, vue comme une ligne combinée. */
export function singleRow(table: string, row: FakeRow): CombinedRow {
  return { sources: [{ alias: table, row }] };
}

/* ----------------------------------------------------------------- sources */

/** Lignes de la source `FROM`, puis jointures successives. */
function joinSources(store: FakeStore, statement: SelectStatement, params: readonly unknown[]): CombinedRow[] {
  let rows: CombinedRow[] = sourceRows(store, statement.from).map((row) => ({
    sources: [{ alias: statement.from.alias, row }],
  }));
  for (const join of statement.joins) {
    const right = sourceRows(store, join.source);
    const joined: CombinedRow[] = [];
    for (const left of rows) {
      let matched = false;
      for (const rightRow of right) {
        const combined: CombinedRow = { sources: [...left.sources, { alias: join.source.alias, row: rightRow }] };
        if (evaluate(join.on, evalContext(store, combined, params))) {
          joined.push(combined);
          matched = true;
        }
      }
      if (!matched && join.left) {
        joined.push({
          sources: [...left.sources, { alias: join.source.alias, row: emptySource(store, join.source.table) }],
        });
      }
    }
    rows = joined;
  }
  return rows;
}

/** Lignes d'une table, ou celles de `information_schema.tables`. */
function sourceRows(store: FakeStore, source: { table: string }): FakeRow[] {
  if (/^information_schema\.tables$/i.test(source.table)) {
    return [...store.tables.keys()].map((name) => ({ table_name: name, table_schema: 'forge' }));
  }
  return store.require(source.table).rows;
}

/** Ligne vide : le côté droit manquant d'un `LEFT JOIN`. */
function emptySource(store: FakeStore, table: string): FakeRow {
  if (/^information_schema\./i.test(table)) return { table_name: null, table_schema: null };
  return store.emptyRow(store.require(table));
}

/* ------------------------------------------------------- tri et pagination */

/** Trie les lignes selon `ORDER BY` (tri stable, comme MySQL sans index). */
function orderRows(
  store: FakeStore,
  rows: CombinedRow[],
  statement: SelectStatement,
  params: readonly unknown[],
): CombinedRow[] {
  if (statement.orderBy.length === 0) return rows;
  const operands = statement.orderBy.map((item) => operandOf(item.expression));
  return [...rows].sort((left, right) => {
    for (let index = 0; index < statement.orderBy.length; index += 1) {
      const item = statement.orderBy[index];
      const operand = operands[index];
      if (!item || !operand) continue;
      const order = compareValues(
        resolve(operand, evalContext(store, left, params)),
        resolve(operand, evalContext(store, right, params)),
      );
      if (order !== null && order !== 0) return item.descending ? -order : order;
    }
    return 0;
  });
}

/** Applique `LIMIT` et `OFFSET` (valeurs ou paramètres liés). */
function applyWindow(
  rows: CombinedRow[],
  limit: Operand | null,
  offset: Operand | null,
  params: readonly unknown[],
): CombinedRow[] {
  const start = limitOf(offset, params) ?? 0;
  const bound = limitOf(limit, params);
  const shifted = start > 0 ? rows.slice(start) : rows;
  return bound === null ? shifted : shifted.slice(0, bound);
}

/** Valeur d'un `LIMIT` ; `null` s'il n'y en a pas. */
export function limitOf(limit: Operand | null, params: readonly unknown[]): number | null {
  if (!limit) return null;
  const value = Number(resolve(limit, { row: { value: () => null }, params }));
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

/* -------------------------------------------------------------- projection */

/** Projette les lignes sur les colonnes demandées. */
function project(
  store: FakeStore,
  rows: CombinedRow[],
  items: SelectItem[],
  params: readonly unknown[],
): FakeRow[] {
  const counted = items.find((item) => item.count);
  if (counted) return [{ [outputKey(counted)]: rows.length }];
  return rows.map((row) => projectRow(store, row, items, params));
}

/** Une ligne projetée. */
function projectRow(
  store: FakeStore,
  row: CombinedRow,
  items: SelectItem[],
  params: readonly unknown[],
): FakeRow {
  const output: FakeRow = {};
  for (const item of items) {
    if (item.star) {
      for (const source of row.sources) Object.assign(output, source.row);
      continue;
    }
    output[outputKey(item)] = resolve(operandOf(item.expression), evalContext(store, row, params));
  }
  return output;
}

/** Nom de la colonne rendue : l'alias, sinon le nom sans préfixe de table. */
function outputKey(item: SelectItem): string {
  if (item.alias) return item.alias;
  const dot = item.expression.lastIndexOf('.');
  return dot >= 0 ? item.expression.slice(dot + 1) : item.expression;
}

/** Analyse (et met en cache) le texte d'une expression simple. */
const operandCache = new Map<string, Operand>();

function operandOf(expression: string): Operand {
  const cached = operandCache.get(expression);
  if (cached) return cached;
  const cursor = { tokens: tokenize(expression), index: 0, params: 0 };
  const operand = parseOperand(cursor, () => {
    throw new Error(`double SQL : sous-requête non supportée dans « ${expression} »`);
  });
  operandCache.set(expression, operand);
  return operand;
}
