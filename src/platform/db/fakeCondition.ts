/**
 * Conditions du double SQL : ce qu'une clause `WHERE` peut dire.
 *
 * Le double n'implémente pas SQL : il implémente *le SQL que la couche de
 * stockage écrit*. Les conditions couvrent donc exactement les formes
 * utilisées par les dépôts : comparaisons, `IS [NOT] NULL`, `IN`, `AND`, `OR`,
 * `NOT`, `COALESCE(...)`, `DATABASE()` et une sous-requête dans un `IN`.
 *
 * L'évaluation respecte les règles de MySQL : une comparaison avec `NULL`
 * est fausse (jamais « vraie par défaut »), et `COALESCE` renvoie la première
 * valeur non nulle.
 */

import type { SelectStatement } from './fakeStatements';
import type { Token } from './fakeTokens';
import { isKeyword } from './fakeTokens';

/** Un opérande : une colonne, une valeur, un paramètre lié, un appel. */
export type Operand =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; index: number }
  | { kind: 'call'; name: string; args: Operand[] }
  | { kind: 'star' }
  | { kind: 'subquery'; statement: SelectStatement };

/** Opérateurs de comparaison gérés par le double. */
export type CompareOperator = '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=' | 'like';

/** Une condition : arbre booléen, évalué ligne par ligne. */
export type Condition =
  | { kind: 'always' }
  | { kind: 'and'; left: Condition; right: Condition }
  | { kind: 'or'; left: Condition; right: Condition }
  | { kind: 'not'; inner: Condition }
  | { kind: 'compare'; operator: CompareOperator; left: Operand; right: Operand }
  | { kind: 'isNull'; operand: Operand; negated: boolean }
  | { kind: 'in'; operand: Operand; values: Operand[]; negated: boolean };

/** Curseur de lecture sur les jetons, avec le compteur de paramètres liés. */
export interface Cursor {
  tokens: Token[];
  index: number;
  params: number;
}

/** Lecture d'une valeur dans une ligne (colonne qualifiée ou non). */
export interface RowReader {
  value(name: string): unknown;
}

/** De quoi évaluer une condition : la ligne, les paramètres, les sous-requêtes. */
export interface EvalContext {
  row: RowReader;
  params: readonly unknown[];
  subquery?: (statement: SelectStatement) => unknown[];
}

/** Analyse une sous-requête : injectée pour éviter un cycle d'import. */
export type SubQueryParser = () => SelectStatement;

/* ---------------------------------------------------------------- parsing */

/** Lit une condition complète (ou la première d'une suite). */
export function parseCondition(cursor: Cursor, parseSubQuery: SubQueryParser): Condition {
  let left = parseAnd(cursor, parseSubQuery);
  while (isKeyword(peek(cursor), 'OR')) {
    consume(cursor);
    const right = parseAnd(cursor, parseSubQuery);
    left = { kind: 'or', left, right };
  }
  return left;
}

/** Lit une suite de conditions reliées par `AND`. */
function parseAnd(cursor: Cursor, parseSubQuery: SubQueryParser): Condition {
  let left = parseNot(cursor, parseSubQuery);
  while (isKeyword(peek(cursor), 'AND')) {
    consume(cursor);
    const right = parseNot(cursor, parseSubQuery);
    left = { kind: 'and', left, right };
  }
  return left;
}

/** Lit une négation. */
function parseNot(cursor: Cursor, parseSubQuery: SubQueryParser): Condition {
  if (isKeyword(peek(cursor), 'NOT')) {
    consume(cursor);
    return { kind: 'not', inner: parseNot(cursor, parseSubQuery) };
  }
  return parsePrimary(cursor, parseSubQuery);
}

/** Lit une condition entre parenthèses, ou une comparaison simple. */
function parsePrimary(cursor: Cursor, parseSubQuery: SubQueryParser): Condition {
  const token = peek(cursor);
  if (!token) throw new Error('double SQL : condition inachevée');
  if (token.kind === 'punct' && token.text === '(') {
    consume(cursor);
    const inner = parseCondition(cursor, parseSubQuery);
    expectPunct(cursor, ')');
    return inner;
  }
  return parseComparison(cursor, parseOperand(cursor, parseSubQuery), parseSubQuery);
}

/** Lit la comparaison qui suit un opérande. */
function parseComparison(
  cursor: Cursor,
  operand: Operand,
  parseSubQuery: SubQueryParser,
): Condition {
  const token = peek(cursor);
  if (isKeyword(token, 'IS')) {
    consume(cursor);
    const negated = isKeyword(peek(cursor), 'NOT');
    if (negated) consume(cursor);
    if (!isKeyword(peek(cursor), 'NULL')) throw new Error('double SQL : IS NULL attendu');
    consume(cursor);
    return { kind: 'isNull', operand, negated };
  }
  if (isKeyword(token, 'IN')) {
    consume(cursor);
    return { kind: 'in', operand, values: parseInValues(cursor, parseSubQuery), negated: false };
  }
  if (isKeyword(token, 'NOT')) {
    consume(cursor);
    if (isKeyword(peek(cursor), 'IN')) {
      consume(cursor);
      return { kind: 'in', operand, values: parseInValues(cursor, parseSubQuery), negated: true };
    }
    if (isKeyword(peek(cursor), 'LIKE')) {
      consume(cursor);
      return { kind: 'compare', operator: 'like', left: operand, right: parseOperand(cursor, parseSubQuery) };
    }
    throw new Error('double SQL : NOT suivi de IN ou LIKE attendu');
  }
  if (isKeyword(token, 'LIKE')) {
    consume(cursor);
    return { kind: 'compare', operator: 'like', left: operand, right: parseOperand(cursor, parseSubQuery) };
  }
  const operator = comparisonOperator(token);
  if (!operator) return { kind: 'always' };
  consume(cursor);
  return { kind: 'compare', operator, left: operand, right: parseOperand(cursor, parseSubQuery) };
}

/** Lit la liste d'un `IN` : des opérandes, ou une sous-requête. */
function parseInValues(cursor: Cursor, parseSubQuery: SubQueryParser): Operand[] {
  expectPunct(cursor, '(');
  if (isKeyword(peek(cursor), 'SELECT')) {
    const statement = parseSubQuery();
    expectPunct(cursor, ')');
    return [{ kind: 'subquery', statement }];
  }
  const values: Operand[] = [parseOperand(cursor, parseSubQuery)];
  while (peek(cursor)?.kind === 'punct' && peek(cursor)?.text === ',') {
    consume(cursor);
    values.push(parseOperand(cursor, parseSubQuery));
  }
  expectPunct(cursor, ')');
  return values;
}

/** Lit un opérande : colonne, littéral, paramètre lié ou appel de fonction. */
export function parseOperand(cursor: Cursor, parseSubQuery: SubQueryParser): Operand {
  const token = consume(cursor);
  if (!token) throw new Error('double SQL : opérande manquant');
  if (token.kind === 'param') {
    const index = cursor.params;
    cursor.params += 1;
    return { kind: 'param', index };
  }
  if (token.kind === 'number') return { kind: 'literal', value: token.value };
  if (token.kind === 'text') return { kind: 'literal', value: token.value };
  if (token.kind !== 'word') throw new Error(`double SQL : opérande inattendu « ${token.text} »`);
  const upper = token.text.toUpperCase();
  if (upper === 'NULL') return { kind: 'literal', value: null };
  if (upper === 'TRUE') return { kind: 'literal', value: true };
  if (upper === 'FALSE') return { kind: 'literal', value: false };
  const following = peek(cursor);
  if (following?.kind === 'punct' && following.text === '(') {
    consume(cursor);
    const args = parseCallArguments(cursor, parseSubQuery);
    expectPunct(cursor, ')');
    return { kind: 'call', name: upper, args };
  }
  return { kind: 'column', name: token.text };
}

/** Lit les arguments d'un appel de fonction. */
function parseCallArguments(cursor: Cursor, parseSubQuery: SubQueryParser): Operand[] {
  if (peek(cursor)?.kind === 'punct' && peek(cursor)?.text === ')') return [];
  if (peek(cursor)?.kind === 'punct' && peek(cursor)?.text === '*') {
    consume(cursor);
    return [{ kind: 'star' }];
  }
  const args: Operand[] = [parseOperand(cursor, parseSubQuery)];
  while (peek(cursor)?.kind === 'punct' && peek(cursor)?.text === ',') {
    consume(cursor);
    args.push(parseOperand(cursor, parseSubQuery));
  }
  return args;
}

/** Opérateur de comparaison d'un jeton, s'il en est un. */
function comparisonOperator(token: Token | undefined): CompareOperator | null {
  if (!token || token.kind !== 'punct') return null;
  if (token.text === '=' || token.text === '!=' || token.text === '<>') return token.text;
  if (token.text === '<' || token.text === '<=' || token.text === '>' || token.text === '>=') return token.text;
  return null;
}

/* ------------------------------------------------------------- évaluation */

/** Vrai si la ligne satisfait la condition. */
export function evaluate(condition: Condition, context: EvalContext): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'and':
      return evaluate(condition.left, context) && evaluate(condition.right, context);
    case 'or':
      return evaluate(condition.left, context) || evaluate(condition.right, context);
    case 'not':
      return !evaluate(condition.inner, context);
    case 'compare':
      return compare(
        condition.operator,
        resolve(condition.left, context),
        resolve(condition.right, context),
      );
    case 'isNull': {
      const value = resolve(condition.operand, context);
      const missing = value === null || value === undefined;
      return condition.negated ? !missing : missing;
    }
    case 'in': {
      const value = resolve(condition.operand, context);
      if (value === null || value === undefined) return false;
      const candidates = condition.values.flatMap((item) => {
        const resolved = resolve(item, context);
        return item.kind === 'subquery' && Array.isArray(resolved) ? resolved : [resolved];
      });
      const found = candidates.some((candidate) => sameValue(value, candidate));
      return condition.negated ? !found : found;
    }
  }
}

/** Valeur d'un opérande. */
export function resolve(operand: Operand, context: EvalContext): unknown {
  switch (operand.kind) {
    case 'column':
      return context.row.value(operand.name);
    case 'literal':
      return operand.value;
    case 'param':
      return context.params[operand.index];
    case 'call':
      return callValue(operand, context);
    case 'subquery':
      return context.subquery ? context.subquery(operand.statement) : [];
    case 'star':
      return null;
  }
}

/** Valeur d'un appel de fonction : `COALESCE`, `DATABASE`. */
function callValue(operand: { name: string; args: Operand[] }, context: EvalContext): unknown {
  if (operand.name === 'DATABASE') return 'forge';
  if (operand.name === 'COALESCE') {
    for (const argument of operand.args) {
      const value = resolve(argument, context);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }
  return null;
}

/** Compare deux valeurs comme MySQL : nombres d'un côté, texte de l'autre. */
export function compare(operator: CompareOperator, left: unknown, right: unknown): boolean {
  if (operator === 'like') return likeMatch(String(left ?? ''), String(right ?? ''));
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (operator === '=') return sameValue(left, right);
  if (operator === '!=' || operator === '<>') return !sameValue(left, right);
  const order = compareValues(left, right);
  if (order === null) return false;
  if (operator === '<') return order < 0;
  if (operator === '<=') return order <= 0;
  if (operator === '>') return order > 0;
  return order >= 0;
}

/** Égalité tolérante : `1` et `'1'` sont égaux, comme dans MySQL. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (typeof left === 'number' || typeof right === 'number') {
    const first = Number(left);
    const second = Number(right);
    if (Number.isFinite(first) && Number.isFinite(second)) return first === second;
  }
  return String(left) === String(right);
}

/** Ordre de deux valeurs ; `null` si l'une n'est pas comparable. */
export function compareValues(left: unknown, right: unknown): number | null {
  if (left === null || left === undefined || right === null || right === undefined) return null;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const first = String(left);
  const second = String(right);
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

/** `LIKE` avec `%` et `_`. */
function likeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
  return regex.test(value);
}

/* ----------------------------------------------------------------- jetons */

/** Jeton suivant, sans le consommer. */
export function peek(cursor: Cursor): Token | undefined {
  return cursor.tokens[cursor.index];
}

/** Jeton suivant, consommé. */
export function consume(cursor: Cursor): Token | undefined {
  const token = cursor.tokens[cursor.index];
  cursor.index += 1;
  return token;
}

/** Vérifie (et consomme) une ponctuation attendue. */
export function expectPunct(cursor: Cursor, text: string): void {
  const token = consume(cursor);
  if (!token || token.text !== text) {
    throw new Error(`double SQL : « ${text} » attendu, trouvé « ${token?.text ?? 'fin'} »`);
  }
}
