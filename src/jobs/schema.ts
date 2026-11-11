import { ensureSchema } from '../platform/db/index';

/**
 * Création du schéma, une seule fois par instance d'exécution.
 *
 * `ensureSchema()` est idempotent, mais onze instructions DDL à chaque trigger
 * coûteraient cher pour rien. La promesse est mémorisée ; si elle échoue, elle
 * est oubliée pour qu'une invocation ultérieure puisse réessayer.
 */
let ready: Promise<void> | null = null;

/** Garantit que les tables du §16 existent avant tout accès. */
export function ensureReady(): Promise<void> {
  ready ??= ensureSchema().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}
