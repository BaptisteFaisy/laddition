/**
 * Point d'entrée de la couche de stockage Forge SQL.
 *
 * `ensureSchema()` crée les tables du §16 (plus le cache des scores) en une
 * passe, puis rejoue les migrations des installations déjà en place, et se
 * tait : l'initialisation peut être relancée à chaque démarrage d'app, trigger
 * ou job sans effet de bord. `isSchemaReady()` sert de garde rapide avant un
 * calcul.
 *
 * Tout passe par l'exécuteur injectable de `query.ts` : en test, le double en
 * mémoire de `fakeSql.ts` remplace Forge SQL, `ensureSchema()` compris.
 */

import { runDdl, selectRows } from './query';
import { SCHEMA_MIGRATIONS, SCHEMA_STATEMENTS, TABLE_NAMES } from './schema';
import type { TableName } from './schema';

export * from './repos';
export { SCHEMA_MIGRATIONS, SCHEMA_STATEMENTS, TABLE_NAMES } from './schema';
export type { TableName } from './schema';

/** Motifs d'une erreur « objet déjà présent » : un schéma existant n'est pas une panne. */
const ALREADY_EXISTS = /already exists|ER_TABLE_EXISTS|ER_DUP_KEYNAME|duplicate column|duplicate key|1050|1060|1061/i;

/** Crée les tables manquantes ; une table déjà là n'est pas une erreur. */
export async function ensureSchema(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await runDdl(statement);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  await runSchemaMigrations();
}

/**
 * Colonnes ajoutées après la première version du schéma.
 *
 * Forge SQL **refuse `ALTER TABLE`** (mesuré le 11/11 sur one-atlas-cndz :
 * les 20 migrations rendent `SQL_EXECUTION_ERROR`). Une installation créée
 * avant l'ajout d'une colonne ne peut donc pas être migrée : il faut
 * recréer les tables. Cette liste sert à le détecter et à le dire, au lieu de
 * laisser chaque requête échouer sur un mystérieux « Unknown SQL execution
 * error ».
 */
export const REQUIRED_COLUMNS: ReadonlyArray<{ table: TableName; column: string }> = [
  { table: 'issue_fact', column: 'story_points' },
  { table: 'issue_fact', column: 'history_truncated' },
  { table: 'debt_bill', column: 'blocked_reason' },
  { table: 'settings', column: 'story_point_field' },
  { table: 'bootstrap_progress', column: 'attempts' },
  { table: 'score_cache', column: 'fingerprint' },
  // Colonnes de l'écriture en deux temps (C35) : sans elles, tout INSERT échoue.
  { table: 'evidence', column: 'batch_id' },
  { table: 'attribution', column: 'batch_id' },
  { table: 'status_span', column: 'batch_id' },
  { table: 'baseline', column: 'batch_id' },
];

/** Une colonne attendue manque à l'appel. */
export interface MissingColumn {
  table: string;
  column: string;
}

/**
 * Vérifie que le schéma installé est celui du code, colonne par colonne.
 * Une lecture par colonne, bornée à une ligne : le coût est négligeable et le
 * diagnostic est exact, là où Forge SQL ne renvoie qu'une erreur générique.
 */
export async function findMissingColumns(): Promise<MissingColumn[]> {
  const missing: MissingColumn[] = [];
  for (const { table, column } of REQUIRED_COLUMNS) {
    try {
      await selectRows(`SELECT ${column} FROM ${table} LIMIT 1`);
    } catch {
      missing.push({ table, column });
    }
  }
  return missing;
}

/**
 * Recrée le schéma de zéro : `DROP TABLE` puis `ensureSchema()`.
 *
 * **Destructif** — réservé à une installation de développement ou à un site de
 * démonstration, et uniquement parce que Forge SQL n'accepte pas `ALTER TABLE`.
 * Les données sont réinjectables : initialisation (`bootstrap`) pour les faits
 * et durées, recalcul pour les preuves et additions, jeu d'exemple pour la démo.
 */
export async function resetSchema(): Promise<{ dropped: string[]; missingAfterReset: MissingColumn[] }> {
  const dropped: string[] = [];
  for (const table of TABLE_NAMES) {
    try {
      await runDdl(`DROP TABLE IF EXISTS ${table}`);
      dropped.push(table);
    } catch {
      // Une table absente ou un DROP refusé n'arrête pas la recréation.
    }
  }
  await ensureSchema();
  return { dropped, missingAfterReset: await findMissingColumns() };
}

/** Issue d'une migration : appliquée, ou refusée avec la raison. */
export interface MigrationReport {
  statement: string;
  ok: boolean;
  /** Raison du refus, quand il y en a une. */
  error?: string;
}

/**
 * Rejoue les `ALTER` des installations existantes, au mieux.
 *
 * `CREATE TABLE IF NOT EXISTS` n'ajoute pas une colonne à une table déjà là :
 * sans ces migrations, une installation antérieure n'aurait ni `story_points`,
 * ni `batch_id`, ni les nouveaux index. MySQL refuse une colonne ou un index
 * déjà présent (1060/1061) : ce refus est attendu, donc toléré.
 *
 * Toute autre erreur est **rapportée, pas propagée** : Forge SQL pourrait ne
 * pas exposer `ALTER TABLE`, et casser `ensureSchema()` — donc l'app entière —
 * pour une migration serait pire que de la manquer. Le rapport permet à une
 * sonde d'exploitation de voir ce qui n'est pas passé ; la solution propre
 * reste alors une réinstallation de l'app (base neuve).
 *
 * L'alternative officielle est `migrationRunner` de `@forge/sql` (table
 * `__migrations`, une migration jouée une fois). Elle n'est pas retenue ici
 * parce qu'elle **jette** à la première erreur : sur une installation déjà
 * partiellement migrée, `ensureSchema()` échouerait au démarrage.
 */
export async function runSchemaMigrations(): Promise<MigrationReport[]> {
  const reports: MigrationReport[] = [];
  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      await runDdl(statement);
      reports.push({ statement, ok: true });
    } catch (error) {
      if (!isAlreadyExists(error)) reports.push({ statement, ok: false, error: describeError(error) });
    }
  }
  return reports;
}

/** Vrai quand toutes les tables du schéma sont présentes dans la base de l'app. */
export async function isSchemaReady(): Promise<boolean> {
  const placeholders = TABLE_NAMES.map(() => '?').join(', ');
  const query =
    'SELECT table_name AS name FROM information_schema.tables ' +
    `WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`;
  try {
    const rows = await selectRows<{ name: unknown }>(query, [...TABLE_NAMES]);
    return rows.length === TABLE_NAMES.length;
  } catch {
    return false;
  }
}

/** Vrai quand l'erreur signale un objet de schéma déjà présent. */
export function isAlreadyExists(error: unknown): boolean {
  return ALREADY_EXISTS.test(describeError(error));
}

/** Texte exploitable d'une erreur, quel que soit son emballage Forge. */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.message} ${typeof code === 'string' ? code : ''}`;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  }
  return String(error ?? '');
}
