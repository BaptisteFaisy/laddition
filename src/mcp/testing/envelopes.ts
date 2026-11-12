/**
 * Lecture d'enveloppes d'action, pour les tests.
 *
 * **Fichier réservé aux tests.** Une action MCP rend `{ ok, data }` ou
 * `{ ok, error }` ; ces deux lecteurs échouent le test quand la forme attendue
 * n'est pas là, pour qu'une assertion ne porte jamais sur `undefined`.
 */

import assert from 'node:assert/strict';
import type { ActionEnvelope } from '../result';

/** Erreur d'une enveloppe ; échoue le test si l'action a réussi. */
export function errorOf(result: ActionEnvelope<unknown>): string {
  if (result.ok) assert.fail(`une enveloppe d’échec était attendue, reçu : ${JSON.stringify(result.data)}`);
  return result.error;
}

/** Données d'une enveloppe ; échoue le test si l'action a échoué. */
export function dataOf<T>(result: ActionEnvelope<unknown>): T {
  if (!result.ok) assert.fail(`succès attendu, échec reçu : ${result.error}`);
  return result.data as T;
}
