/**
 * Cache des scores de pertinence (soutien A4/B16, §18).
 *
 * Le cache rend les scores durables : sans lui, chaque nuit repaierait au
 * modèle les couples de textes déjà évalués. On vérifie l'aller-retour,
 * l'upsert par empreinte, l'isolation par projet et la lecture groupée.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { restoreSql, useFakeSql } from '../fakeSql';
import { ensureSchema } from '../index';
import { countScores, getScores, listScores, saveScores } from './scores';

const NOW = '2026-11-11T09:00:00.000Z';

/** Double installé, schéma créé. */
async function installed(t: { after(hook: () => void): void }) {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  return fake;
}

test('B16 — les scores écrits se relisent par empreinte', async (t) => {
  await installed(t);
  await saveScores(
    'p1',
    [
      { fingerprint: 'f1', relevance: 0.8, rationale: 'même service' },
      { fingerprint: 'f2', relevance: 0.2, rationale: 'sans rapport' },
    ],
    NOW,
  );
  const found = await getScores('p1', ['f1', 'f2', 'f3']);
  assert.equal(found.size, 2, 'une empreinte inconnue n’est pas inventée');
  assert.deepEqual(found.get('f1'), { fingerprint: 'f1', relevance: 0.8, rationale: 'même service' });
  assert.equal(found.has('f3'), false);
});

test('B16 — réécrire une empreinte la rafraîchit sans dupliquer', async (t) => {
  await installed(t);
  await saveScores('p1', [{ fingerprint: 'f1', relevance: 0.4, rationale: 'avant' }], NOW);
  await saveScores('p1', [{ fingerprint: 'f1', relevance: 0.9, rationale: 'après' }], NOW);
  assert.equal(await countScores('p1'), 1);
  const found = await getScores('p1', ['f1']);
  assert.equal(found.get('f1')?.relevance, 0.9);
  assert.equal(found.get('f1')?.rationale, 'après');
});

test('B16 — le cache est isolé par projet', async (t) => {
  await installed(t);
  await saveScores('p1', [{ fingerprint: 'f1', relevance: 0.5, rationale: 'p1' }], NOW);
  await saveScores('p2', [{ fingerprint: 'f1', relevance: 0.7, rationale: 'p2' }], NOW);
  assert.equal((await getScores('p1', ['f1'])).get('f1')?.rationale, 'p1');
  assert.equal((await getScores('p2', ['f1'])).get('f1')?.rationale, 'p2');
  assert.equal(await countScores('p1'), 1);
  assert.equal(await countScores('p2'), 1);
});

test('B16 — tout le cache d’un projet se précharge en une lecture', async (t) => {
  const fake = await installed(t);
  const entries = Array.from({ length: 5 }, (_, index) => ({
    fingerprint: `f${index}`,
    relevance: index / 10,
    rationale: `r${index}`,
  }));
  await saveScores('p1', entries, NOW);
  fake.log.length = 0;
  const all = await listScores('p1');
  assert.equal(all.size, 5);
  const reads = fake.log.filter((call) => call.kind === 'select');
  assert.equal(reads.length, 1, 'une requête pour tout le cache');
  assert.ok(!/SELECT \*/i.test(reads[0]?.query ?? ''));
});

test('B16 — l’écriture est groupée et paramétrée', async (t) => {
  const fake = await installed(t);
  await saveScores(
    'p1',
    [
      { fingerprint: "f'; DROP TABLE score_cache; --", relevance: 1, rationale: 'hôte' },
      { fingerprint: 'f2', relevance: 0, rationale: '' },
    ],
    NOW,
  );
  const inserts = fake.log.filter((call) => call.kind === 'insert');
  assert.equal(inserts.length, 1);
  assert.ok(!inserts[0]?.query.includes('DROP TABLE'), 'aucune valeur concaténée');
  assert.equal(await countScores('p1'), 2);
});

test('B16 — une liste vide n’écrit rien', async (t) => {
  const fake = await installed(t);
  await saveScores('p1', [], NOW);
  assert.equal(fake.log.filter((call) => call.kind === 'insert').length, 0);
  assert.equal((await getScores('p1', [])).size, 0);
});
