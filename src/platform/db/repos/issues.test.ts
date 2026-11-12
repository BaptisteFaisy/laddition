/**
 * Dépôt des faits et des séjours de statut (item C33).
 *
 * Trois propriétés vérifiées ici, sur le double en mémoire de Forge SQL :
 * - la fenêtre d'analyse a **exactement** la sémantique d'avant, mais sans
 *   `COALESCE` sur une colonne indexée ;
 * - plus aucun `SELECT *` : le `MEDIUMTEXT` de `description` n'est lu que pour
 *   les tickets de dette, les seuls dont le texte sert au score de pertinence ;
 * - les lectures sont paginées, et `listStatusSpans` peut se passer de la
 *   jointure quand l'appelant connaît déjà les tickets de la fenêtre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { restoreSql, useFakeSql } from '../fakeSql';
import { ensureSchema } from '../index';
import { listIssuesInWindow, listStatusSpans, replaceStatusSpans, upsertIssueFacts } from './issues';
import { issueFact, statusSpan } from '../testFixtures';

const FROM = '2026-10-01T00:00:00.000Z';

/** Double installé, schéma créé. */
async function installed(t: { after(hook: () => void): void }) {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  return fake;
}

/** Identifiants lus dans la fenêtre, triés. */
async function idsInWindow(projectId = 'p1'): Promise<string[]> {
  return (await listIssuesInWindow(projectId, FROM)).map((fact) => fact.issueId).sort();
}

test('C33 — la fenêtre retient création, résolution et clôture récentes', async (t) => {
  await installed(t);
  await upsertIssueFacts([
    // Créé dans la fenêtre.
    issueFact({ issueId: 'recent', key: 'PROJ-1', createdAt: '2026-10-05T08:00:00.000Z' }),
    // Créé avant, résolu dans la fenêtre.
    issueFact({
      issueId: 'resolved',
      key: 'PROJ-2',
      createdAt: '2026-01-05T08:00:00.000Z',
      resolvedAt: '2026-10-20T08:00:00.000Z',
    }),
    // Créé avant, jamais résolu, clos dans la fenêtre.
    issueFact({
      issueId: 'closed',
      key: 'PROJ-3',
      createdAt: '2026-01-05T08:00:00.000Z',
      closedAt: '2026-10-21T08:00:00.000Z',
    }),
    // Créé et résolu avant la fenêtre : plus aucun coût récent.
    issueFact({
      issueId: 'old',
      key: 'PROJ-4',
      createdAt: '2026-01-05T08:00:00.000Z',
      resolvedAt: '2026-02-05T08:00:00.000Z',
      closedAt: '2026-10-22T08:00:00.000Z',
    }),
    // Créé avant, toujours ouvert : hors fenêtre (aucune date de fin récente).
    issueFact({ issueId: 'open', key: 'PROJ-5', createdAt: '2026-01-05T08:00:00.000Z' }),
  ]);
  assert.deepEqual(await idsInWindow(), ['closed', 'recent', 'resolved']);
});

test('C33 — plus de SELECT * ni de COALESCE sur une colonne indexée', async (t) => {
  const fake = await installed(t);
  await upsertIssueFacts([issueFact({ issueId: 'i1' })]);
  fake.log.length = 0;
  await listIssuesInWindow('p1', FROM);
  const selects = fake.log.filter((call) => call.kind === 'select');
  assert.ok(selects.length > 0);
  for (const call of selects) {
    assert.ok(!/\bSELECT \*/i.test(call.query), `SELECT * subsistant : ${call.query}`);
    assert.ok(!/COALESCE/i.test(call.query), `prédicat non sargable : ${call.query}`);
  }
  const window = selects[0];
  assert.match(window?.query ?? '', /created_at >= \?/);
  assert.match(window?.query ?? '', /resolved_at IS NOT NULL AND resolved_at >= \?/);
  assert.match(window?.query ?? '', /closed_at IS NOT NULL AND closed_at >= \?/);
  assert.match(window?.query ?? '', /ORDER BY created_at, issue_id/);
});

test('C33 — la description n’est lue que pour les tickets de dette', async (t) => {
  const fake = await installed(t);
  await upsertIssueFacts([
    issueFact({ issueId: 'd1', key: 'PROJ-1', isDebt: true, description: 'corps de la dette' }),
    issueFact({ issueId: 'i2', key: 'PROJ-2', description: 'corps du ticket' }),
  ]);
  fake.log.length = 0;
  const facts = await listIssuesInWindow('p1', FROM);
  const debt = facts.find((fact) => fact.issueId === 'd1');
  const other = facts.find((fact) => fact.issueId === 'i2');
  assert.equal(debt?.description, 'corps de la dette', 'le score de pertinence a besoin du texte');
  assert.equal(other?.description, undefined, 'un ticket ordinaire ne traîne pas son MEDIUMTEXT');
  const bulk = fake.log.filter((call) => call.kind === 'select')[0];
  assert.ok(!(bulk?.query ?? '').includes('description'));
});

test('C33 — une page demandée explicitement borne la lecture', async (t) => {
  const fake = await installed(t);
  await upsertIssueFacts(
    Array.from({ length: 5 }, (_, index) =>
      issueFact({
        issueId: `i${index}`,
        key: `PROJ-${index}`,
        createdAt: `2026-10-0${index + 2}T08:00:00.000Z`,
      }),
    ),
  );
  fake.log.length = 0;
  const page = await listIssuesInWindow('p1', FROM, { limit: 2, offset: 2 });
  assert.deepEqual(page.map((fact) => fact.issueId), ['i2', 'i3']);
  const selects = fake.log.filter((call) => call.kind === 'select');
  assert.equal(selects.length, 1, 'une page = une requête');
  // LIMIT/OFFSET sont inline (Forge SQL refuse les paramètres liés ici) :
  // ce sont des entiers bornés produits par le code, jamais des entrées.
  assert.match(selects[0]?.query ?? '', /LIMIT 2 OFFSET 2$/);
  // Plus aucun paramètre de pagination : projet + les trois bornes de fenêtre,
  // au format datetime de la base.
  const params = selects[0]?.params ?? [];
  assert.equal(params.length, 4, 'projet + 3 bornes, sans LIMIT/OFFSET liés');
  assert.equal(params[0], 'p1');
  assert.equal(new Set(params.slice(1)).size, 1, 'les trois bornes sont identiques');
});

test('C33 — un gros volume est lu par lots, en plusieurs requêtes', async (t) => {
  const fake = await installed(t);
  const total = 250;
  await upsertIssueFacts(
    Array.from({ length: total }, (_, index) =>
      issueFact({
        issueId: `i${String(index).padStart(3, '0')}`,
        key: `PROJ-${index}`,
        createdAt: '2026-10-05T08:00:00.000Z',
      }),
    ),
  );
  fake.log.length = 0;
  const facts = await listIssuesInWindow('p1', FROM);
  assert.equal(facts.length, total);
  const selects = fake.log.filter((call) => call.kind === 'select');
  assert.ok(selects.length >= 2, `lecture par lots, pas en une requête (${selects.length} requêtes)`);
});

test('C33 — les séjours de statut se lisent sans jointure quand les tickets sont connus', async (t) => {
  const fake = await installed(t);
  await upsertIssueFacts([issueFact({ issueId: 'i1' }), issueFact({ issueId: 'i2', key: 'PROJ-2' })]);
  await replaceStatusSpans('i1', [statusSpan({ issueId: 'i1' })]);
  await replaceStatusSpans('i2', [statusSpan({ issueId: 'i2', category: 'done' })]);

  fake.log.length = 0;
  const scoped = await listStatusSpans('p1', ['i1']);
  assert.deepEqual(scoped.map((span) => span.issueId), ['i1']);
  assert.ok(!fake.log.some((call) => /JOIN/i.test(call.query)), 'aucune jointure : la clé primaire suffit');

  fake.log.length = 0;
  const all = await listStatusSpans('p1');
  assert.deepEqual(all.map((span) => span.issueId).sort(), ['i1', 'i2']);
  assert.ok(fake.log.some((call) => /JOIN issue_fact/i.test(call.query)), 'sans les identifiants, la jointure reste');
});

test('C33 — le remplacement des séjours retire ceux qui ont disparu', async (t) => {
  await installed(t);
  await upsertIssueFacts([issueFact({ issueId: 'i1' })]);
  await replaceStatusSpans('i1', [
    statusSpan({ issueId: 'i1', startedAt: '2026-10-01T08:00:00.000Z' }),
    statusSpan({ issueId: 'i1', category: 'done', startedAt: '2026-10-02T08:00:00.000Z' }),
  ]);
  await replaceStatusSpans('i1', [statusSpan({ issueId: 'i1', startedAt: '2026-10-01T08:00:00.000Z' })]);
  const spans = await listStatusSpans('p1', ['i1']);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.startedAt, '2026-10-01T08:00:00.000Z');
});
