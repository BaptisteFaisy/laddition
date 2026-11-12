/**
 * Magasin du double SQL : des tables en mémoire (`Map`).
 *
 * Le double ne connaît que ce que la couche écrit : des tables créées par le
 * DDL du §16, des lignes indexées par leur clé primaire, et rien d'autre (pas
 * d'index secondaires — le double n'a pas à être rapide, seulement fidèle).
 */

import type { FakeRow } from './fakeTypes';

/** Une table du double. */
export interface FakeTable {
  name: string;
  columns: string[];
  primaryKey: string[];
  rows: FakeRow[];
}

/** Le magasin : une table par nom. */
export class FakeStore {
  /** Les tables connues du double. */
  readonly tables: Map<string, FakeTable> = new Map();

  /** Crée une table si elle n'existe pas déjà. */
  create(statement: string): void {
    const table = parseCreateTable(statement);
    if (!this.tables.has(table.name)) this.tables.set(table.name, table);
  }

  /** Applique un `ALTER TABLE` : ajoute une colonne, ignore les index. */
  alter(statement: string): void {
    const match = /ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(COLUMN\s+)?`?([A-Za-z0-9_]+)`?/i.exec(statement);
    if (!match) return;
    const explicitColumn = match[2] !== undefined;
    const name = match[3] as string;
    // « ADD KEY … », « ADD INDEX … » : un index, pas une colonne.
    if (!explicitColumn && /^(KEY|INDEX|UNIQUE|PRIMARY|CONSTRAINT|FULLTEXT)$/i.test(name)) return;
    const table = this.tables.get(match[1] as string);
    if (!table || table.columns.includes(name)) return;
    table.columns.push(name);
    for (const row of table.rows) row[name] = null;
  }

  /** Une table, ou `undefined` si elle n'existe pas. */
  table(name: string): FakeTable | undefined {
    return this.tables.get(name);
  }

  /** Une table, ou une erreur explicite. */
  require(name: string): FakeTable {
    const table = this.tables.get(name);
    if (!table) throw new Error(`double SQL : table inconnue « ${name} »`);
    return table;
  }

  /** Ligne de même clé primaire, s'il en existe une. */
  findByKey(table: FakeTable, key: readonly unknown[]): FakeRow | undefined {
    if (table.primaryKey.length === 0) return undefined;
    return table.rows.find((row) =>
      table.primaryKey.every((column, index) => sameValue(row[column], key[index])),
    );
  }

  /** Une ligne vide (toutes les colonnes à `null`) : le « pas de jointure ». */
  emptyRow(table: FakeTable): FakeRow {
    const row: FakeRow = {};
    for (const column of table.columns) row[column] = null;
    return row;
  }
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

/** Lit un `CREATE TABLE` : nom, colonnes, clé primaire. */
export function parseCreateTable(statement: string): FakeTable {
  const match = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(/i.exec(statement);
  if (!match || match.index === undefined) {
    throw new Error(`double SQL : CREATE TABLE illisible « ${statement.slice(0, 48)} »`);
  }
  const body = extractParenthesised(statement, match.index + match[0].length - 1);
  const columns: string[] = [];
  const primaryKey: string[] = [];
  for (const part of splitDefinitions(body)) {
    const definition = part.trim();
    if (/^PRIMARY\s+KEY/i.test(definition)) {
      primaryKey.push(...columnNames(definition));
      continue;
    }
    if (/^(UNIQUE\s+)?(KEY|INDEX)\b/i.test(definition) || /^CONSTRAINT\b/i.test(definition)) continue;
    const column = /^`?([A-Za-z0-9_]+)`?/.exec(definition);
    if (column) columns.push(column[1] as string);
  }
  return { name: match[1] as string, columns, primaryKey, rows: [] };
}

/** Texte entre une parenthèse ouvrante et sa fermante. */
function extractParenthesised(text: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  throw new Error('double SQL : parenthèses non équilibrées dans le DDL');
}

/** Découpe le corps d'un `CREATE TABLE` sur les virgules de premier niveau. */
function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

/** Noms de colonnes d'une définition `PRIMARY KEY (a, b)`. */
function columnNames(definition: string): string[] {
  const inside = definition.slice(definition.indexOf('(') + 1, definition.lastIndexOf(')'));
  return inside
    .split(',')
    .map((part) => part.trim().replace(/`/g, ''))
    .filter((part) => part.length > 0);
}
