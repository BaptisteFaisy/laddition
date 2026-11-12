import { sqlGeneration } from './query';

/**
 * Mémoïsation d'une tâche idempotente, valable pour l'exécuteur SQL courant.
 *
 * Créer le schéma ou une table est idempotent mais coûteux : on le mémorise.
 * Une mémoïsation au niveau du module survit cependant au changement
 * d'exécuteur — donc au double SQL qu'installe un test. Résultat mesuré le
 * 12/11 : le deuxième test d'un même fichier héritait d'une table « déjà créée »
 * qui n'existait pas dans sa base vierge (« table inconnue »). Le mémo est ici
 * lié à la génération d'exécuteur, et un échec est oublié pour qu'un appel
 * ultérieur puisse réessayer.
 */
export function oncePerExecutor(task: () => Promise<void>): () => Promise<void> {
  let generation = -1;
  let promise: Promise<void> | null = null;
  return () => {
    const current = sqlGeneration();
    if (promise === null || generation !== current) {
      generation = current;
      promise = task().catch((error: unknown) => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };
}
