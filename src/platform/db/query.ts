/**
 * Accès bas niveau à Forge SQL.
 *
 * L'API réelle de `@forge/sql` 4.x est volontairement étroite :
 * `sql.prepare<T>(query).bindParams(...).execute()` rend `{ rows }`, et
 * `sql.executeDDL(query)` sert aux instructions de schéma. Il n'existe **aucune
 * API de transaction** : un remplacement se fait donc en deux instructions —
 * d'abord l'`INSERT` groupé du nouveau jeu, ensuite le `DELETE` de l'ancien —
 * jamais en une boucle de N requêtes (le détail et la raison sont dans
 * `replaceRows`, item C35).
 *
 * Toutes les valeurs passent par des paramètres liés (`?`). Seuls les noms de
 * tables et de colonnes — des constantes du module — sont interpolés.
 *
 * **Exécution injectable.** Tout passe par un `SqlExecutor` : par défaut, celui
 * de Forge ; dans un test, celui de `fakeSql.ts` (double en mémoire). Les
 * tests d'intégration des dépôts et des jobs n'ont donc plus besoin de Forge.
 */

import { sql } from '@forge/sql';
import type { Result, UpdateQueryResponse } from '@forge/sql';
import type { SqlParam, SqlParams } from './rows';
import { BATCH_COLUMN } from './schema';

/** Valeur liée à une requête : jamais de chaîne concaténée dans le SQL. */
export type SqlValue = SqlParam;

/** Nombre de lignes par `INSERT` groupé (limite de paramètres par requête). */
const ROW_CHUNK = 200;

/** Taille d'un lot de lecture : borne la durée d'un `SELECT` (§17 : 5 s). */
export const DEFAULT_BATCH_SIZE = 200;

/** Borne haute d'une page : un LIMIT déraisonnable saturerait la charge utile. */
export const MAX_PAGE_LIMIT = 1000;

/**
 * Entier sûr pour un `LIMIT`/`OFFSET` **inline**.
 *
 * Forge SQL (MySQL) refuse les paramètres liés dans LIMIT/OFFSET ; les valeurs
 * sont donc interpolées, mais ce sont des entiers produits par le code, bornés
 * ici — jamais une chaîne venue de l'extérieur.
 */
export function safeLimitInt(value: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/** Nombre maximal de lots lus d'affilée : garde-fou contre une boucle infinie. */
const MAX_BATCHES = 200;

/* ------------------------------------------------------------- exécution */

/** Exécuteur de requêtes : Forge par défaut, double en mémoire dans les tests. */
export interface SqlExecutor {
  /** Lit des lignes. */
  select<Row>(query: string, params: SqlParams): Promise<Row[]>;
  /** Écrit (INSERT, UPDATE, DELETE) et rend le compte rendu du serveur. */
  execute(query: string, params: SqlParams): Promise<UpdateQueryResponse>;
  /** Exécute une instruction de schéma. */
  ddl(statement: string): Promise<void>;
}

/** L'exécuteur de Forge SQL : le vrai, celui du runtime. */
const forgeExecutor: SqlExecutor = {
  async select<Row>(query: string, params: SqlParams): Promise<Row[]> {
    const result: Result<Row> = await sql.prepare<Row>(query).bindParams(...params).execute();
    return result.rows as Row[];
  },
  async execute(query: string, params: SqlParams): Promise<UpdateQueryResponse> {
    const result: Result<UpdateQueryResponse> = await sql
      .prepare<UpdateQueryResponse>(query)
      .bindParams(...params)
      .execute();
    return result.rows;
  },
  async ddl(statement: string): Promise<void> {
    await sql.executeDDL(statement);
  },
};

let executor: SqlExecutor = forgeExecutor;

/**
 * Génération de l'exécuteur courant : incrémentée à chaque changement.
 *
 * Sert aux mémos de création de table (`oncePerExecutor`) : un double SQL
 * installé par un test est un nouvel exécuteur, donc les mémos des tests
 * précédents ne doivent pas survivre.
 */
let generation = 0;

/**
 * Change l'exécuteur (un double en mémoire dans les tests) ; `null` rend
 * l'exécuteur de Forge. La fonction renvoie l'exécuteur précédent, pour le
 * rétablir dans un `finally`.
 */
export function setSqlExecutor(next: SqlExecutor | null): SqlExecutor {
  const previous = executor;
  executor = next ?? forgeExecutor;
  generation += 1;
  return previous;
}

/** Génération courante de l'exécuteur (voir `oncePerExecutor`). */
export function sqlGeneration(): number {
  return generation;
}

/** L'exécuteur courant (Forge par défaut). */
export function getSqlExecutor(): SqlExecutor {
  return executor;
}

/* --------------------------------------------------------------- lecture */

/** Exécute une requête de lecture et rend ses lignes typées. */
export async function selectRows<Row>(query: string, params: SqlParams = []): Promise<Row[]> {
  return executor.select<Row>(query, params);
}

/** Exécute une écriture et rend le compte rendu du serveur. */
export async function runStatement(query: string, params: SqlParams = []): Promise<UpdateQueryResponse> {
  return executor.execute(query, params);
}

/** Exécute une instruction de schéma (une seule instruction par appel). */
export async function runDdl(statement: string): Promise<void> {
  await executor.ddl(statement);
}

/** Options de lecture par lots. */
export interface BatchOptions {
  /** Lignes par requête (une requête par lot). */
  batchSize?: number;
  /** Lots maximum lus d'affilée. */
  maxBatches?: number;
}

/** Une page demandée explicitement : borne et décalage. */
export interface PageRequest {
  /** Lignes voulues (1 au minimum). */
  limit?: number;
  /** Lignes sautées (0 au minimum). */
  offset?: number;
}

/**
 * Lit une page d'une requête.
 *
 * La requête doit se terminer par un `ORDER BY` déterministe et ne pas
 * comporter de `LIMIT` : la pagination est ajoutée ici.
 *
 * `LIMIT` et `OFFSET` sont **inline**, pas liés : Forge SQL (MySQL) refuse les
 * paramètres liés à ces deux endroits (« Unknown SQL execution error », mesuré
 * le 11/11 sur le site de démo). Ce n'est pas une faille d'injection : les deux
 * valeurs sont des entiers produits par le code, bornés par `safeInt`, jamais
 * des entrées utilisateur. Tout le reste de la requête reste paramétré.
 */
export async function selectPage<Row>(
  query: string,
  params: SqlParams = [],
  page: PageRequest = {},
): Promise<Row[]> {
  const limit = safeLimitInt(page.limit ?? DEFAULT_BATCH_SIZE, 1, MAX_PAGE_LIMIT);
  const offset = safeLimitInt(page.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
  return selectRows<Row>(`${query} LIMIT ${limit} OFFSET ${offset}`, params);
}

/**
 * Lit toutes les lignes d'une requête, par lots bornés.
 *
 * Même contrat que `selectPage` : chaque lot est une requête distincte, donc
 * jamais plus de 5 s (§17), et la mémoire reste bornée côté serveur.
 */
export async function selectAllBatched<Row>(
  query: string,
  params: SqlParams = [],
  options: BatchOptions = {},
): Promise<Row[]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  const rows: Row[] = [];
  for (let index = 0; index < maxBatches; index += 1) {
    const page = await selectPage<Row>(query, params, { limit: batchSize, offset: index * batchSize });
    rows.push(...page);
    if (page.length < batchSize) break;
  }
  return rows;
}

/* --------------------------------------------------------------- écriture */

/** Clause `ON DUPLICATE KEY UPDATE` qui rafraîchit tout sauf la clé. */
export function onDuplicateUpdate(columns: readonly string[], keyColumns: readonly string[]): string {
  return columns
    .filter((column) => !keyColumns.includes(column))
    .map((column) => `${column} = VALUES(${column})`)
    .join(', ');
}

/** Découpe une liste en paquets de taille bornée (une requête par paquet). */
export function chunkList<Row>(rows: readonly Row[], size: number): Row[][] {
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
    tuples.push(`(${values.map(() => '?').join(', ')})`);
    params.push(...values);
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
  for (const group of chunkList(options.rows, ROW_CHUNK)) {
    const built = buildValues(group.map(options.toValues));
    const statement =
      `INSERT INTO ${options.table} (${options.columns.join(', ')}) VALUES ${built.sql}${suffix}`;
    await runStatement(statement, built.params);
  }
}

/** Compteur de lots : rend chaque marqueur unique au sein du processus. */
let batchCounter = 0;

/** Marqueur d'un lot écrit : unique par écriture, court, stockable. */
export function newBatchId(): string {
  batchCounter += 1;
  return `b${Date.now().toString(36)}-${batchCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Options de remplacement complet d'un sous-ensemble d'une table. */
export interface ReplaceRowsOptions<Row> extends WriteRowsOptions<Row> {
  /** Condition du périmètre remplacé (colonne de projet ou de ticket). */
  where: string;
  whereParams?: SqlParams;
  /** Colonne de marquage du lot écrit ; `batch_id` par défaut. */
  batchColumn?: string;
}

/**
 * Remplace un sous-ensemble de lignes, en deux temps, sans transaction.
 *
 * Forge SQL n'a pas de transaction (§17) : un `DELETE` suivi d'un `INSERT`
 * laisse le projet vide si l'écriture échoue à mi-chemin — c'est-à-dire
 * « plus aucune preuve » (C35). L'ordre retenu est donc l'inverse :
 *
 * 1. le nouveau jeu est **écrit** et marqué d'un identifiant de lot
 *    (`batch_id`) ; les lignes déjà présentes sont rafraîchies à cette occasion ;
 * 2. le **périmètre** est ensuite purgé de tout ce que ce lot n'a pas écrit.
 *
 * Conséquences, à connaître :
 * - le projet n'est **jamais vide** : un échec en phase 1 laisse l'ancien jeu
 *   intact (seules les lignes déjà rafraîchies le sont) ; un échec en phase 2
 *   laisse un mélange ancien/neuf, que l'écriture suivante corrigera ;
 * - le résultat n'est « propre » qu'après la phase 2 ; c'est le prix de
 *   l'absence de transaction, et il est assumé ici ;
 * - les colonnes non couvertes par l'upsert restent celles de la ligne
 *   existante (même comportement qu'un `ON DUPLICATE KEY UPDATE`).
 */
export async function replaceRows<Row>(options: ReplaceRowsOptions<Row>): Promise<void> {
  const batchColumn = options.batchColumn ?? BATCH_COLUMN;
  const batchValue = newBatchId();
  const columns = [...options.columns, batchColumn];
  const onDuplicate = options.onDuplicate
    ? `${options.onDuplicate}, ${batchColumn} = VALUES(${batchColumn})`
    : undefined;
  await insertRows({
    table: options.table,
    columns,
    rows: options.rows,
    toValues: (row) => [...options.toValues(row), batchValue],
    onDuplicate,
  });
  await runStatement(
    `DELETE FROM ${options.table} WHERE ${options.where} AND (${batchColumn} IS NULL OR ${batchColumn} <> ?)`,
    [...(options.whereParams ?? []), batchValue],
  );
}

/* --------------------------------------------------------- résolutions */

/**
 * Projet de chaque ticket, lu en une requête par lot.
 *
 * Forge SQL n'a pas de clé étrangère (§17) et certaines entrées du domaine
 * (addition, bulletin, rejet) ne portent pas l'identifiant du projet : on le
 * retrouve ici, une fois pour toutes, au lieu d'une sous-requête par ligne.
 */
export async function projectIdsOfIssues(issueIds: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const unique = [...new Set(issueIds)];
  for (const group of chunkList(unique, DEFAULT_BATCH_SIZE)) {
    const placeholders = group.map(() => '?').join(', ');
    const rows = await selectRows<{ issue_id: string; project_id: string }>(
      `SELECT issue_id, project_id FROM issue_fact WHERE issue_id IN (${placeholders})`,
      [...group],
    );
    for (const row of rows) found.set(row.issue_id, row.project_id);
  }
  return found;
}
