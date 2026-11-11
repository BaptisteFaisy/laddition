/**
 * Point d'entrée de la couche de stockage Forge SQL.
 *
 * `ensureSchema()` crée les onze tables du §16 en une passe, puis se tait :
 * l'initialisation peut être rejouée à chaque démarrage d'app, trigger ou job
 * sans effet de bord. `isSchemaReady()` sert de garde rapide avant un calcul.
 */

import { sql } from '@forge/sql';
import { selectRows } from './query.ts';
import { SCHEMA_STATEMENTS, TABLE_NAMES } from './schema.ts';

export * from './repos.ts';
export { SCHEMA_STATEMENTS, TABLE_NAMES } from './schema.ts';
export type { TableName } from './schema.ts';

/** Motifs d'une erreur « objet déjà présent » : un schéma existant n'est pas une panne. */
const ALREADY_EXISTS = /already exists|ER_TABLE_EXISTS|ER_DUP_KEYNAME|duplicate column|1050|1061|1060/i;

/** Crée les tables manquantes ; une table déjà là n'est pas une erreur. */
export async function ensureSchema(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await sql.executeDDL(statement);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
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
function describeError(error: unknown): string {
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
