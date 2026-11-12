import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from '@forge/resolver';
import { listInvalid } from '../jobs/invalidation';
import { addConfirmation, listConfirmations } from '../jobs/confirmations';
import { startFakeDb } from '../mcp/testing/seed';
import { stubForgeRuntime } from '../jobs/testForge';

stubForgeRuntime();
const { loadSampleData, clearSampleData } = await import('./sample');

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

/**
 * Retirer le jeu d'exemple doit aussi retirer les décisions humaines posées
 * dessus : sans ça, une confirmation de démo survit au retrait et gonfle la
 * fourchette basse du jeu réinjecté (recette §20 n°3 injouable).
 */
test('le retrait du jeu d\'exemple efface aussi les confirmations', async (t) => {
  await startFakeDb(t);
  const loaded = await loadSampleData(request({ projectId: 'p3' }));
  assert.equal((loaded as { ok: boolean }).ok, true, JSON.stringify(loaded));
  await addConfirmation('p3', { evidenceId: 'ev-demo', debtIssueId: 'd-demo', by: 'demo', at: '2026-11-12T10:00:00.000Z' });
  assert.equal((await listConfirmations('p3')).length, 1, 'la confirmation est posée');

  const cleared = await clearSampleData(request({ projectId: 'p3' }));
  assert.equal((cleared as { ok: boolean }).ok, true, 'retrait accepté');
  assert.deepEqual(await listConfirmations('p3'), [], 'plus aucune décision humaine');

  assert.equal((await loadSampleData(request({ projectId: 'p3' })) as { ok: boolean }).ok, true);
  assert.deepEqual(await listConfirmations('p3'), [], 'le jeu réinjecté est vierge');
});
