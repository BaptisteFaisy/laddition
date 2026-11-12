/**
 * Instructions du double SQL : ce que la couche de stockage écrit.
 *
 * Quatre formes, celles de `query.ts` et des dépôts : `SELECT` (avec jointure,
 * `ORDER BY`, pagination), `INSERT` (avec `ON DUPLICATE KEY UPDATE`), `UPDATE`
 * et `DELETE`. Toute autre instruction est refusée avec un message clair : le
 * double n'a pas vocation à devenir un moteur SQL complet.
 */

import type { Condition, Cursor, Operand } from './fakeCondition';
import { parseCondition, parseOperand } from './fakeCondition';
import { isKeyword, splitByComma, tokenize, tokenText } from './fakeTokens';
import type { Token } from './fakeTokens';

/** Un élément de projection : `*`, une colonne, un alias, un `COUNT(*)`. */
export interface SelectItem {
  expression: string;
  alias: string | null;
  star: boolean;
  count: boolean;
}

/** Une source : une table et son alias. */
export interface Source {
  table: string;
  alias: string;
}

/** Une jointure. */
export interface JoinClause {
  source: Source;
  left: boolean;
  on: Condition;
}

/** Un élément de `ORDER BY`. */
export interface OrderItem {
  expression: string;
  descending: boolean;
}

/** Un `SELECT` analysé. */
export interface SelectStatement {
  kind: 'select';
  items: SelectItem[];
  from: Source;
  joins: JoinClause[];
  where: Condition | null;
  orderBy: OrderItem[];
  limit: Operand | null;
  offset: Operand | null;
}

/** Une affectation d'un `ON DUPLICATE KEY UPDATE`. */
export interface DuplicateUpdate {
  column: string;
  /** Vrai quand la valeur vient de la ligne insérée (`VALUES(col)`). */
  fromValues: boolean;
  source: Operand | null;
}

/** Un `INSERT` analysé. */
export interface InsertStatement {
  kind: 'insert';
  table: string;
  columns: string[];
  tuples: Operand[][];
  updates: DuplicateUpdate[];
}

/** Une affectation d'un `UPDATE`. */
export interface Assignment {
  column: string;
  value: Operand;
}

/** Un `UPDATE` analysé. */
export interface UpdateStatement {
  kind: 'update';
  table: string;
  assignments: Assignment[];
  where: Condition | null;
  limit: Operand | null;
}

/** Un `DELETE` analysé. */
export interface DeleteStatement {
  kind: 'delete';
  table: string;
  where: Condition | null;
  limit: Operand | null;
}

/** Toute instruction comprise par le double. */
export type Statement = SelectStatement | InsertStatement | UpdateStatement | DeleteStatement;

/** Mots-clés qui ne peuvent pas être un alias de table. */
const RESERVED = ['ON', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ORDER', 'LIMIT', 'GROUP', 'SET', 'VALUES'];

/** Analyse une requête SQL. */
export function parseStatement(sql: string): Statement {
  const cursor: Cursor = { tokens: tokenize(sql), index: 0, params: 0 };
  const first = cursor.tokens[0];
  if (isKeyword(first, 'SELECT')) return parseSelect(cursor);
  if (isKeyword(first, 'INSERT')) return parseInsert(cursor);
  if (isKeyword(first, 'UPDATE')) return parseUpdate(cursor);
  if (isKeyword(first, 'DELETE')) return parseDelete(cursor);
  throw new Error(`double SQL : instruction non supportée « ${tokenText(first)} »`);
}

/** Analyse un `SELECT` (curseur sur `SELECT`). */
export function parseSelect(cursor: Cursor): SelectStatement {
  consume(cursor);
  const items = parseProjection(cursor);
  expectKeyword(cursor, 'FROM');
  const from = parseSource(cursor);
  const joins = parseJoins(cursor);
  const where = parseWhere(cursor);
  const orderBy = parseOrderBy(cursor);
  const limit = parseLimit(cursor);
  const offset = parseOffset(cursor);
  return { kind: 'select', items, from, joins, where, orderBy, limit, offset };
}

/** Analyse un `INSERT` (curseur sur `INSERT`). */
function parseInsert(cursor: Cursor): InsertStatement {
  consume(cursor);
  expectKeyword(cursor, 'INTO');
  const table = tokenText(consume(cursor));
  const columns = parseColumnList(cursor);
  expectKeyword(cursor, 'VALUES');
  const tuples = parseTuples(cursor);
  const updates = parseDuplicateUpdates(cursor);
  return { kind: 'insert', table, columns, tuples, updates };
}

/** Analyse un `UPDATE` (curseur sur `UPDATE`). */
function parseUpdate(cursor: Cursor): UpdateStatement {
  consume(cursor);
  const table = tokenText(consume(cursor));
  expectKeyword(cursor, 'SET');
  const assignments = parseAssignments(cursor);
  const where = parseWhere(cursor);
  const limit = parseLimit(cursor);
  return { kind: 'update', table, assignments, where, limit };
}

/** Analyse un `DELETE` (curseur sur `DELETE`). */
function parseDelete(cursor: Cursor): DeleteStatement {
  consume(cursor);
  expectKeyword(cursor, 'FROM');
  const table = tokenText(consume(cursor));
  const where = parseWhere(cursor);
  const limit = parseLimit(cursor);
  return { kind: 'delete', table, where, limit };
}

/** Projette jusqu'au `FROM` de premier niveau. */
function parseProjection(cursor: Cursor): SelectItem[] {
  const tokens: Token[] = [];
  let depth = 0;
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    if (!token) break;
    if (depth === 0 && isKeyword(token, 'FROM')) break;
    if (token.kind === 'punct' && token.text === '(') depth += 1;
    if (token.kind === 'punct' && token.text === ')') depth -= 1;
    tokens.push(token);
    cursor.index += 1;
  }
  return splitByComma(tokens).map(projectionItem);
}

/** Un élément de projection, avec son alias éventuel. */
function projectionItem(tokens: Token[]): SelectItem {
  const asIndex = tokens.findIndex((token) => isKeyword(token, 'AS'));
  const expression = asIndex < 0 ? tokens : tokens.slice(0, asIndex);
  const alias = asIndex < 0 ? null : tokenText(tokens[asIndex + 1]);
  const text = expression.map((token) => token.text).join(' ');
  return {
    expression: text,
    alias,
    star: expression.length === 1 && expression[0]?.text === '*',
    count: /^count\s*\(\s*\*\s*\)$/i.test(text),
  };
}

/** Une source : `table [alias]`. */
function parseSource(cursor: Cursor): Source {
  const table = tokenText(consume(cursor));
  const following = peek(cursor);
  if (following && following.kind === 'word' && !RESERVED.includes(following.text.toUpperCase())) {
    return { table, alias: tokenText(consume(cursor)) };
  }
  return { table, alias: table };
}

/** Les jointures d'un `SELECT`. */
function parseJoins(cursor: Cursor): JoinClause[] {
  const joins: JoinClause[] = [];
  for (;;) {
    let left = false;
    if (isKeyword(peek(cursor), 'LEFT')) {
      consume(cursor);
      left = true;
    }
    if (!isKeyword(peek(cursor), 'JOIN')) break;
    consume(cursor);
    const source = parseSource(cursor);
    expectKeyword(cursor, 'ON');
    const on = parseCondition(cursor, () => parseSelect(cursor));
    joins.push({ source, left, on });
  }
  return joins;
}

/** La clause `WHERE`, si elle existe. */
function parseWhere(cursor: Cursor): Condition | null {
  if (!isKeyword(peek(cursor), 'WHERE')) return null;
  consume(cursor);
  return parseCondition(cursor, () => parseSelect(cursor));
}

/** La clause `ORDER BY`, si elle existe. */
function parseOrderBy(cursor: Cursor): OrderItem[] {
  if (!isKeyword(peek(cursor), 'ORDER')) return [];
  consume(cursor);
  expectKeyword(cursor, 'BY');
  const tokens: Token[] = [];
  while (cursor.index < cursor.tokens.length && !isKeyword(peek(cursor), 'LIMIT')) {
    tokens.push(consume(cursor) as Token);
  }
  return splitByComma(tokens).map((group) => {
    const last = group[group.length - 1];
    const descending = isKeyword(last, 'DESC');
    const expression = group
      .slice(0, descending || isKeyword(last, 'ASC') ? group.length - 1 : group.length)
      .map((token) => token.text)
      .join(' ');
    return { expression, descending };
  });
}

/** La clause `LIMIT`, si elle existe (valeur ou paramètre lié). */
function parseLimit(cursor: Cursor): Operand | null {
  if (!isKeyword(peek(cursor), 'LIMIT')) return null;
  consume(cursor);
  return parseOperand(cursor, () => parseSelect(cursor));
}

/** La clause `OFFSET`, si elle existe (valeur ou paramètre lié). */
function parseOffset(cursor: Cursor): Operand | null {
  if (!isKeyword(peek(cursor), 'OFFSET')) return null;
  consume(cursor);
  return parseOperand(cursor, () => parseSelect(cursor));
}

/** Une liste de colonnes entre parenthèses. */
function parseColumnList(cursor: Cursor): string[] {
  if (peek(cursor)?.text !== '(') return [];
  consume(cursor);
  const tokens: Token[] = [];
  while (peek(cursor) && peek(cursor)?.text !== ')') tokens.push(consume(cursor) as Token);
  consume(cursor);
  return splitByComma(tokens).map((group) => group.map((token) => token.text).join(''));
}

/** Les n-uplets d'un `VALUES`. */
function parseTuples(cursor: Cursor): Operand[][] {
  const tuples: Operand[][] = [];
  for (;;) {
    expectPunct(cursor, '(');
    const items: Operand[] = [parseOperand(cursor, () => parseSelect(cursor))];
    while (peek(cursor)?.text === ',') {
      consume(cursor);
      items.push(parseOperand(cursor, () => parseSelect(cursor)));
    }
    expectPunct(cursor, ')');
    tuples.push(items);
    if (peek(cursor)?.text !== ',') break;
    consume(cursor);
  }
  return tuples;
}

/** Les affectations d'un `ON DUPLICATE KEY UPDATE`. */
function parseDuplicateUpdates(cursor: Cursor): DuplicateUpdate[] {
  if (!isKeyword(peek(cursor), 'ON')) return [];
  consume(cursor);
  expectKeyword(cursor, 'DUPLICATE');
  expectKeyword(cursor, 'KEY');
  expectKeyword(cursor, 'UPDATE');
  const tokens: Token[] = [];
  while (cursor.index < cursor.tokens.length) tokens.push(consume(cursor) as Token);
  return splitByComma(tokens).map((group) => {
    const column = tokenText(group[0]);
    const fromValues = isKeyword(group[2], 'VALUES');
    return { column, fromValues, source: null };
  });
}

/** Les affectations d'un `SET` (jusqu'au `WHERE`). */
function parseAssignments(cursor: Cursor): Assignment[] {
  const tokens: Token[] = [];
  let depth = 0;
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    if (!token) break;
    if (depth === 0 && (isKeyword(token, 'WHERE') || isKeyword(token, 'LIMIT'))) break;
    if (token.kind === 'punct' && token.text === '(') depth += 1;
    if (token.kind === 'punct' && token.text === ')') depth -= 1;
    tokens.push(token);
    cursor.index += 1;
  }
  return splitByComma(tokens).map((group) => {
    const column = tokenText(group[0]);
    const valueTokens = group.slice(2);
    const valueCursor: Cursor = { tokens: valueTokens, index: 0, params: cursor.params };
    const value = parseOperand(valueCursor, () => parseSelect(valueCursor));
    cursor.params = valueCursor.params;
    return { column, value };
  });
}

/* ----------------------------------------------------------------- jetons */

function peek(cursor: Cursor): Token | undefined {
  return cursor.tokens[cursor.index];
}

function consume(cursor: Cursor): Token | undefined {
  const token = cursor.tokens[cursor.index];
  cursor.index += 1;
  return token;
}

function expectPunct(cursor: Cursor, text: string): void {
  const token = consume(cursor);
  if (!token || token.text !== text) {
    throw new Error(`double SQL : « ${text} » attendu, trouvé « ${tokenText(token)} »`);
  }
}

function expectKeyword(cursor: Cursor, word: string): void {
  if (!isKeyword(peek(cursor), word)) {
    throw new Error(`double SQL : « ${word} » attendu, trouvé « ${tokenText(peek(cursor))} »`);
  }
  consume(cursor);
}
