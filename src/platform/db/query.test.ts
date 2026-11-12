/**
 * L'écriture en deux temps (C35) et la discipline des paramètres liés.
 *
 * Forge SQL n'a pas de transaction (§17) : ces tests vérifient la propriété
 * qui la remplace — **un projet n'est jamais laissé sans preuves** — en
 * simulant une panne à chaque phase, et que le SQL généré ne contient jamais
 * une valeur concaténée.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { FakeSqlClient } from './fakeSql';
import { fakeExecutor, restoreSql, useFakeSql } from './fakeSql';
import { ensureSchema } from './index';
import type { SqlExecutor } from './query';
import { selectAllBatched, setSqlExecutor } from './query';
import { listEvidence, replaceEvidence } from './repos/costs';
import { upsertIssueFacts } from './repos/issues';
import { evidence, issueFact } from './testFixtures';

/** Double installé, schéma créé : le socle de chaque test de ce fichier. */
async function installed(t: { after(hook: () => void): void }): Promise<FakeSqlClient> {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  return fake;
}

/** Fait échouer toute écriture dont la requête porte le motif donné. */
function breakOn(pattern: RegExp, client: FakeSqlClient): void {
  const inner: SqlExecutor = fakeExecutor(client);
  setSqlExecutor({
    select: (query, params) => inner.select(query, params),
    ddl: (statement) => inner.ddl(statement),
    execute: async (query, params) => {
      if (pattern.test(query)) throw new Error('panne simulée');
      return inner.execute(query, params);
    },
  });
}

/** Identifiants des preuves d'un projet, triés. */
async function evidenceIds(projectId: string): Promise<string[]> {
  return (await listEvidence(projectId)).map((item) => item.id).sort();
}

test('C35 — le nouveau jeu est écrit avant que l’ancien soit retiré', async (t) => {
  const fake = await installed(t);
  await replaceEvidence('p1', [evidence({ id: 'e1' }), evidence({ id: 'e2' })]);
  const writes = fake.log.filter((call) => call.kind === 'insert' || call.kind === 'delete');
  assert.equal(writes[0]?.kind, 'insert', 'l’écriture passe avant l’effacement');
  assert.equal(writes[writes.length - 1]?.kind, 'delete');

  fake.log.length = 0;
  await replaceEvidence('p1', [evidence({ id: 'e2' }), evidence({ id: 'e3' })]);
  assert.deepEqual(await evidenceIds('p1'), ['e2', 'e3']);
});

test('C35 — une panne pendant l’écriture laisse l’ancien jeu intact', async (t) => {
  const fake = await installed(t);
  await replaceEvidence('p1', [evidence({ id: 'e1' })]);
  breakOn(/^INSERT INTO evidence/, fake);
  await assert.rejects(
    () => replaceEvidence('p1', [evidence({ id: 'e2' }), evidence({ id: 'e3' })]),
    /panne simulée/,
  );
  assert.deepEqual(await evidenceIds('p1'), ['e1'], 'le projet n’est jamais laissé sans preuves');
});

test('C35 — une panne pendant la purge laisse le nouveau jeu lisible', async (t) => {
  const fake = await installed(t);
  await replaceEvidence('p1', [evidence({ id: 'e1' })]);
  breakOn(/^DELETE FROM evidence/, fake);
  await assert.rejects(() => replaceEvidence('p1', [evidence({ id: 'e2' })]), /panne simulée/);
  // État dégradé assumé, documenté dans `query.ts` : l'écriture suivante nettoie.
  assert.deepEqual(await evidenceIds('p1'), ['e1', 'e2']);
});

test('C35 — le marqueur de lot distingue l’ancien jeu du nouveau', async (t) => {
  const fake = await installed(t);
  await replaceEvidence('p1', [evidence({ id: 'e1' })]);
  const first = fake.store.require('evidence').rows[0]?.batch_id;
  assert.equal(typeof first, 'string');

  await replaceEvidence('p1', [evidence({ id: 'e2' })]);
  const rows = fake.store.require('evidence').rows;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]?.batch_id, first);
});

test('C35 — un remplacement vide retire tout le périmètre, et seulement lui', async (t) => {
  await installed(t);
  await replaceEvidence('p1', [evidence({ id: 'e1' })]);
  await replaceEvidence('p2', [evidence({ id: 'e9' })]);
  await replaceEvidence('p1', []);
  assert.deepEqual(await evidenceIds('p1'), []);
  assert.deepEqual(await evidenceIds('p2'), ['e9'], 'un autre projet n’est pas touché');
});

test('aucune valeur n’est concaténée dans le SQL', async (t) => {
  const fake = await installed(t);
  const hostile = "x'; DROP TABLE issue_fact; --";
  await upsertIssueFacts([issueFact({ summary: hostile, description: hostile, projectId: hostile })]);
  assert.ok(fake.log.length > 0);
  for (const call of fake.log) {
    assert.ok(!call.query.includes('DROP TABLE'), `valeur concaténée : ${call.query}`);
    assert.ok(!call.query.includes(';'), `plusieurs instructions : ${call.query}`);
  }
  // La valeur hostile est bien stockée comme donnée, pas exécutée.
  const rows = fake.store.require('issue_fact').rows;
  assert.equal(rows[0]?.summary, hostile);
});

test('selectAllBatched lit tout le résultat par lots bornés', async (t) => {
  const fake = await installed(t);
  const facts = Array.from({ length: 5 }, (_, index) =>
    issueFact({ issueId: `i${index}`, key: `PROJ-${index}`, createdAt: `2026-10-0${index + 1}T08:00:00.000Z` }),
  );
  await upsertIssueFacts(facts);
  fake.log.length = 0;
  const rows = await selectAllBatched<{ issue_id: string }>(
    'SELECT issue_id FROM issue_fact WHERE project_id = ? ORDER BY issue_id',
    ['p1'],
    { batchSize: 2 },
  );
  assert.equal(rows.length, 5);
  const selects = fake.log.filter((call) => call.kind === 'select');
  assert.equal(selects.length, 3, 'deux lots pleins puis un lot court');
  // LIMIT/OFFSET sont inline : Forge SQL (MySQL) refuse les paramètres liés ici.
  for (const call of selects) assert.match(call.query, /LIMIT \d+ OFFSET \d+$/);
});
