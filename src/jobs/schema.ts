import { ensureSchema } from '../platform/db/index';
import { oncePerExecutor } from '../platform/db/once';

/**
 * Création du schéma, une seule fois par instance d'exécution.
 *
 * `ensureSchema()` est idempotent, mais onze instructions DDL à chaque trigger
 * coûteraient cher pour rien. La promesse est mémorisée ; si elle échoue, elle
 * est oubliée pour qu'une invocation ultérieure puisse réessayer.
 */
/** Garantit que les tables du §16 existent avant tout accès. */
export const ensureReady = oncePerExecutor(ensureSchema);
