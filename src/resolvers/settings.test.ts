import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from '@forge/resolver';
import type { ProjectSettings } from '../core/types';
import { listInvalid } from '../jobs/invalidation';
import { PROJECT_SCOPE } from '../jobs/settings';
import type { Failure } from '../jobs/support';
import { startFakeDb } from '../mcp/testing/seed';
import { stubForgeRuntime } from '../jobs/testForge';

stubForgeRuntime();
const { saveSettings } = await import('./settings');

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Résultat attendu en succès ; échoue le test sur une enveloppe d'erreur. */
function ok<T>(result: T | Failure): T {
  const failure = result as Failure;
  if (failure.ok === false) assert.fail(`succès attendu, reçu : ${failure.error}`);
  return result as T;
}

/**
 * B27 (item 27) : le chemin réel de l'écran des réglages écrivait via
 * `saveSettings` du dépôt, sans jamais marquer le projet : les chiffres
 * restaient calculés avec les anciennes règles jusqu'à la nuit suivante.
 * L'écriture passe désormais par `saveProjectSettings` (`jobs/settings.ts`).
 */
test('B27 : l\'écran des réglages marque le projet, à l\'identique il ne remarque pas', async (t) => {
  await startFakeDb(t);

  const saved = ok<ProjectSettings>(await saveSettings(request({
    settings: { projectId: 'p9', projectKey: 'PAY', windowDays: 30 },
  })));
  assert.equal(saved.windowDays, 30, 'la valeur bornée est rendue à l\'écran');

  const marks = await listInvalid('p9');
  assert.deepEqual(
    marks.map((mark) => `${mark.kind}:${mark.target}`).sort(),
    [`attribution:${PROJECT_SCOPE}`, `zone:${PROJECT_SCOPE}`],
    'un changement de règle marque tout le projet',
  );

  ok<ProjectSettings>(await saveSettings(request({
    settings: { projectId: 'p9', projectKey: 'PAY', windowDays: 30 },
  })));
  assert.equal((await listInvalid('p9')).length, 2, 'des réglages inchangés ne marquent rien');
});
