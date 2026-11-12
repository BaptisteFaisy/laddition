import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from '@forge/resolver';
import { listInvalid } from '../jobs/invalidation';
import { startFakeDb } from '../mcp/testing/seed';
import { stubForgeRuntime } from '../jobs/testForge';

stubForgeRuntime();
const { loadSampleData } = await import('./sample');

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/**
 * B27 (item 27) : le jeu d'exemple réécrit les réglages du projet ; comme
 * l'écran, il doit passer par `saveProjectSettings` pour poser la marque.
 */
test('B27 : charger le jeu d\'exemple marque le projet à recalculer', async (t) => {
  await startFakeDb(t);
  const result = await loadSampleData(request({ projectId: 'p2' }));
  assert.equal((result as { ok: boolean }).ok, true, 'chargement accepté');
  const marks = await listInvalid('p2');
  assert.ok(marks.length >= 1, 'la marque « à recalculer » est posée');
  assert.ok(marks.some((mark) => mark.kind === 'attribution'));
});
