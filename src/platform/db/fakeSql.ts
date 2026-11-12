/**
 * Double en mémoire de Forge SQL (item F78).
 *
 * Forge SQL n'existe que sur le runtime : sans double, ni les dépôts, ni les
 * resolvers, ni les jobs ne sont testables hors ligne. Ce fichier fournit un
 * client de même forme que `@forge/sql` (`prepare` → `bindParams` → `execute`,
 * `executeDDL`, plus `select`/`execute` directs), posé sur des `Map`.
 *
 * # Comment l'utiliser dans un test
 *
 * ```ts
 * import test from 'node:test';
 * import assert from 'node:assert/strict';
 * import { restoreSql, useFakeSql } from '../platform/db/fakeSql';
 * import { ensureSchema } from '../platform/db/index';
 * import { listIssuesInWindow, upsertIssueFacts } from '../platform/db/repos';
 *
 * test('la fenêtre ne retient que les tickets récents', async (t) => {
 *   const fake = useFakeSql();        // 1. remplace l'exécuteur SQL
 *   t.after(restoreSql);              // 2. rend l'exécuteur de Forge en sortie
 *   await ensureSchema();             // 3. crée les tables dans le double
 *
 *   await upsertIssueFacts([fait]);
 *   const lus = await listIssuesInWindow('p1', '2026-08-01T00:00:00.000Z');
 *   assert.equal(lus.length, 1);
 *
 *   // 4. le SQL réellement exécuté est journalisé : on peut l'inspecter
 *   assert.ok(fake.log.some((call) => call.query.includes('created_at >= ?')));
 * });
 * ```
 *
 * Trois points à connaître :
 * - `useFakeSql()` remplace l'exécuteur de `query.ts` **pour tout le
 *   processus** : toujours le restaurer (`restoreSql`, ou la fonction rendue
 *   par `setSqlExecutor`) à la fin du test ;
 * - le double couvre le SQL écrit par cette couche (jointures, `IN`,
 *   `COALESCE`, `ON DUPLICATE KEY UPDATE`, `LIMIT`, sous-requête d'un `IN`,
 *   `COUNT(*)`, `information_schema.tables`). Toute autre forme échoue avec un
 *   message explicite — c'est voulu : mieux vaut une erreur qu'un faux vert ;
 * - le code qui importe `sql` de `@forge/sql` directement (par exemple
 *   `jobs/confirmations.ts` pour son DDL) contourne l'exécuteur : pour le
 *   tester, passer par `setSqlExecutor` ou isoler son DDL.
 */

import type { UpdateQueryResponse } from '@forge/sql';
import type { SqlExecutor } from './query';
import { setSqlExecutor } from './query';
import type { Statement } from './fakeStatements';
import { parseStatement } from './fakeStatements';
import { FakeStore } from './fakeStore';
import { executeSelect } from './fakeSelect';
import { executeDelete, executeInsert, executeUpdate } from './fakeMutate';
import type { FakeRow } from './fakeTypes';

/** Un appel SQL journalisé : de quoi vérifier le SQL généré dans un test. */
export interface SqlCall {
  kind: string;
  query: string;
  params: readonly unknown[];
}

/** Instruction préparée, comme celle de `@forge/sql`. */
export interface FakeStatement<Row> {
  readonly query: string;
  readonly params: readonly unknown[];
  bindParams(...params: unknown[]): FakeStatement<Row>;
  execute(): Promise<{ rows: Row[] | UpdateQueryResponse }>;
}

/** Le double : même surface que `SqlClient`, plus l'inspection. */
export interface FakeSqlClient {
  prepare<Row>(query: string): FakeStatement<Row>;
  executeDDL(statement: string): Promise<{ rows: [] }>;
  /** Lit des lignes (raccourci de `prepare(...).bindParams(...).execute()`). */
  select<Row>(query: string, params?: readonly unknown[]): Promise<Row[]>;
  /** Écrit et rend le compte rendu (raccourci idem). */
  execute(query: string, params?: readonly unknown[]): Promise<UpdateQueryResponse>;
  /** Les tables du double, pour l'inspection. */
  readonly store: FakeStore;
  /** Les appels SQL, dans l'ordre. */
  readonly log: SqlCall[];
  /** Vide les tables et le journal. */
  reset(): void;
}

/** Exécution d'une requête journalisée : ce que l'instruction préparée appelle. */
type CallFn = (query: string, params: readonly unknown[]) => FakeRow[] | UpdateQueryResponse;

/** Crée un double vierge. */
export function createFakeSql(): FakeSqlClient {
  const store = new FakeStore();
  const log: SqlCall[] = [];

  function run(statement: Statement, params: readonly unknown[]): FakeRow[] | UpdateQueryResponse {
    if (statement.kind === 'select') return executeSelect(store, statement, params);
    if (statement.kind === 'insert') return updateResult(executeInsert(store, statement, params));
    if (statement.kind === 'update') return updateResult(executeUpdate(store, statement, params));
    return updateResult(executeDelete(store, statement, params));
  }

  function call(query: string, params: readonly unknown[]): FakeRow[] | UpdateQueryResponse {
    const statement = parseStatement(query);
    log.push({ kind: statement.kind, query, params });
    return run(statement, params);
  }

  return {
    prepare: <Row>(query: string) => preparedStatement<Row>(query, call),
    async executeDDL(statement: string) {
      log.push({ kind: 'ddl', query: statement, params: [] });
      if (/^\s*CREATE\s+TABLE/i.test(statement)) store.create(statement);
      if (/^\s*ALTER\s+TABLE/i.test(statement)) store.alter(statement);
      return { rows: [] };
    },
    async select<Row>(query: string, params: readonly unknown[] = []) {
      return call(query, params) as Row[];
    },
    async execute(query: string, params: readonly unknown[] = []) {
      const result = call(query, params);
      if (Array.isArray(result)) throw new Error('double SQL : `execute` attend une écriture, pas un SELECT');
      return result;
    },
    store,
    log,
    reset() {
      store.tables.clear();
      log.length = 0;
    },
  };
}

/** Instruction préparée : `bindParams` puis `execute`, comme dans le SDK. */
function preparedStatement<Row>(query: string, call: CallFn): FakeStatement<Row> {
  let bound: readonly unknown[] = [];
  const statement: FakeStatement<Row> = {
    get query() {
      return query;
    },
    get params() {
      return bound;
    },
    bindParams(...params: unknown[]) {
      bound = params;
      return statement;
    },
    async execute() {
      return { rows: call(query, bound) as Row[] | UpdateQueryResponse };
    },
  };
  return statement;
}

/** Compte rendu d'écriture, de la forme de celui de Forge SQL. */
function updateResult(affectedRows: number): UpdateQueryResponse {
  return { affectedRows, fieldCount: 0, info: '', insertId: 0, serverStatus: 0, warningStatus: 0 };
}

/** Exécuteur branché sur un double : ce que `query.ts` consomme. */
export function fakeExecutor(client: FakeSqlClient): SqlExecutor {
  return {
    select: async <Row,>(query: string, params: readonly (string | number | boolean | null)[]) =>
      client.select<Row>(query, params),
    execute: async (query: string, params: readonly (string | number | boolean | null)[]) =>
      client.execute(query, params),
    ddl: async (statement: string) => {
      await client.executeDDL(statement);
    },
  };
}

/**
 * Installe un double comme exécuteur SQL et le rend.
 *
 * À coupler avec `restoreSql()` (ou la valeur rendue par `setSqlExecutor`)
 * pour rendre la main à Forge SQL après le test.
 */
export function useFakeSql(): FakeSqlClient {
  const client = createFakeSql();
  setSqlExecutor(fakeExecutor(client));
  return client;
}

/** Rend l'exécuteur de Forge SQL. */
export function restoreSql(): void {
  setSqlExecutor(null);
}
