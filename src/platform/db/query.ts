/**
 * Accès bas niveau à Forge SQL.
 *
 * L'API réelle de `@forge/sql` 4.x est volontairement étroite :
 * `sql.prepare<T>(query).bindParams(...).execute()` rend `{ rows }`, et
 * `sql.executeDDL(query)` sert aux instructions de schéma. Il n'existe **aucune
 * API de transaction** : un remplacement se fait donc en deux instructions
 * (un `DELETE` puis un `INSERT` groupé), jamais en une boucle de N requêtes.
 *
 * Toutes les valeurs passent par des paramètres liés (`?`). Seuls les noms de
 * tables et de colonnes — des constantes du module — sont interpolés.
 */

import { sql } from '@forge/sql';
import type { Result, UpdateQueryResponse } from '@forge/sql';
import type { SqlParam, SqlParams } from './rows';

/** Fragment SQL brut (sous-requête) inséré à la place d'un `?`. */
export interface RawSql {
  readonly sql: string;
  readonly params: readonly SqlParam[];
}

/** Marque un fragment SQL à insérer tel quel, avec ses propres paramètres. */
export function rawSql(fragment: string, params: readonly SqlParam[] = []): RawSql {
  return { sql: fragment, params };
}

/**
 * Projet d'un ticket, retrouvé en base : Forge SQL n'a pas de clé étrangère
 * (§17), et certaines entrées du domaine (addition, bulletin, rejet) ne portent
 * pas l'identifiant du projet. Une sous-requête évite un aller-retour de plus.
 */
export function projectOfIssue(issueId: string): RawSql {
  return rawSql('(SELECT f.project_id FROM issue_fact f WHERE f.issue_id = ?)', [issueId]);
}

/** Valeur d'une colonne : un paramètre lié, ou un fragment SQL. */
export type SqlValue = SqlParam | RawSql;

/** Nombre de lignes par `INSERT` groupé (limite de paramètres par requête). */
const ROW_CHUNK = 200;

function isRawSql(value: SqlValue): value is RawSql {
  return typeof value === 'object' && value !== null && 'sql' in value;
}

/** Exécute une requête de lecture et rend ses lignes typées. */
export async function selectRows<Row>(query: string, params: SqlParams = []): Promise<Row[]> {
  const result: Result<Row> = await sql.prepare<Row>(query).bindParams(...params).execute();
  return result.rows as Row[];
}

/** Exécute une écriture et rend le compte rendu du serveur. */
export async function runStatement(query: string, params: SqlParams = []): Promise<UpdateQueryResponse> {
  const result: Result<UpdateQueryResponse> = await sql
    .prepare<UpdateQueryResponse>(query)
    .bindParams(...params)
    .execute();
  return result.rows;
}

/** Clause `ON DUPLICATE KEY UPDATE` qui rafraîchit tout sauf la clé. */
export function onDuplicateUpdate(columns: readonly string[], keyColumns: readonly string[]): string {
  return columns
    .filter((column) => !keyColumns.includes(column))
    .map((column) => `${column} = VALUES(${column})`)
    .join(', ');
}

/** Découpe une liste en paquets de taille bornée. */
function chunk<Row>(rows: readonly Row[], size: number): Row[][] {
  const groups: Row[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    groups.push(rows.slice(index, index + size));
  }
  return groups;
}

/** Construit la liste `(?, ?), (?, ?)` et les paramètres liés correspondants. */
function buildValues(rowsValues: readonly SqlValue[][]): { sql: string; params: SqlParams } {
  const tuples: string[] = [];
  const params: SqlParams = [];
  for (const values of rowsValues) {
    const parts = values.map((value) => {
      if (isRawSql(value)) {
        params.push(...value.params);
        return value.sql;
      }
      params.push(value);
      return '?';
    });
    tuples.push(`(${parts.join(', ')})`);
  }
  return { sql: tuples.join(', '), params };
}

/** Options d'écriture groupée d'une table. */
export interface WriteRowsOptions<Row> {
  table: string;
  columns: readonly string[];
  rows: readonly Row[];
  /** Valeurs d'une ligne, dans l'ordre des colonnes. */
  toValues: (row: Row) => SqlValue[];
  /** Clause `ON DUPLICATE KEY UPDATE` ; absente, l'insertion est stricte. */
  onDuplicate?: string;
}

/** Insère (ou met à jour) des lignes par paquets d'un seul `INSERT` chacun. */
export async function insertRows<Row>(options: WriteRowsOptions<Row>): Promise<void> {
  const suffix = options.onDuplicate ? ` ON DUPLICATE KEY UPDATE ${options.onDuplicate}` : '';
  for (const group of chunk(options.rows, ROW_CHUNK)) {
    const built = buildValues(group.map(options.toValues));
    const statement =
      `INSERT INTO ${options.table} (${options.columns.join(', ')}) VALUES ${built.sql}${suffix}`;
    await runStatement(statement, built.params);
  }
}

/** Options de remplacement complet d'un sous-ensemble d'une table. */
export interface ReplaceRowsOptions<Row> extends WriteRowsOptions<Row> {
  /** Condition du `DELETE` préalable (colonne de projet ou de ticket). */
  where: string;
  whereParams?: SqlParams;
}

/**
 * Remplace un sous-ensemble de lignes : un `DELETE` puis un `INSERT` groupé.
 * Deux allers-retours au plus, quel que soit le nombre de lignes.
 */
export async function replaceRows<Row>(options: ReplaceRowsOptions<Row>): Promise<void> {
  await runStatement(`DELETE FROM ${options.table} WHERE ${options.where}`, options.whereParams ?? []);
  await insertRows(options);
}
