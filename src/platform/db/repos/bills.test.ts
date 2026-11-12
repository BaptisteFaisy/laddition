/**
 * Dépôt des additions (item C36) et des coûts hebdomadaires.
 *
 * Propriété vérifiée : l'écriture des additions est **groupée** et ne contient
 * plus de sous-requête par ligne — le projet est une valeur liée, comme le
 * reste. Le motif d'absence d'addition (`blockedReason`, §19 cas 2) fait
 * l'aller-retour en base.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { restoreSql, useFakeSql } from '../fakeSql';
import { ensureSchema } from '../index';
import { getBill, listBills, upsertBill, upsertBills } from './bills';
import { upsertIssueFacts } from './issues';
import { debtBill, issueFact } from '../testFixtures';

/** Double installé, schéma créé. */
async function installed(t: { after(hook: () => void): void }) {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  return fake;
}

test('C36 — un lot d’additions s’écrit en une requête, sans sous-requête', async (t) => {
  const fake = await installed(t);
  const bills = Array.from({ length: 5 }, (_, index) =>
    debtBill({ debtIssueId: `d${index}`, key: `PROJ-${index}`, lowJp: index }),
  );
  await upsertBills('p1', bills);

  const inserts = fake.log.filter((call) => call.kind === 'insert');
  assert.equal(inserts.length, 1, 'une seule écriture pour cinq additions');
  const statement = inserts[0];
  assert.match(statement?.query ?? '', /^INSERT INTO debt_bill \(/);
  assert.ok(!/SELECT/i.test(statement?.query ?? ''), 'aucune sous-requête');
  // Les cinq n-uplets sont dans la même instruction.
  assert.equal((statement?.query ?? '').split('), (').length, 5);
  assert.equal(statement?.params.length, 5 * 15);
});

test('C36 — l’écriture groupée remplace l’addition existante', async (t) => {
  await installed(t);
  await upsertBills('p1', [debtBill({ debtIssueId: 'd1', lowJp: 1 })]);
  await upsertBills('p1', [debtBill({ debtIssueId: 'd1', lowJp: 7 }), debtBill({ debtIssueId: 'd2', lowJp: 3 })]);
  const bills = await listBills('p1');
  assert.deepEqual(bills.map((bill) => [bill.debtIssueId, bill.lowJp]), [
    ['d1', 7],
    ['d2', 3],
  ]);
});

test('C36 — une addition seule retrouve son projet en une lecture', async (t) => {
  const fake = await installed(t);
  await upsertIssueFacts([issueFact({ issueId: 'd1', key: 'PROJ-1', isDebt: true })]);
  fake.log.length = 0;

  await upsertBill(debtBill({ debtIssueId: 'd1' }));
  const selects = fake.log.filter((call) => call.kind === 'select');
  const inserts = fake.log.filter((call) => call.kind === 'insert');
  assert.equal(selects.length, 1, 'une lecture du projet, pas une sous-requête par ligne');
  assert.equal(inserts.length, 1);
  assert.ok(!/SELECT/i.test(inserts[0]?.query ?? ''));
  assert.equal((await getBill('d1'))?.lowJp, 4);
});

test('C36 — le projet connu évite toute lecture', async (t) => {
  const fake = await installed(t);
  await upsertBill(debtBill({ debtIssueId: 'd1' }), 'p1');
  assert.equal(fake.log.filter((call) => call.kind === 'select').length, 0);
  const bills = await listBills('p1');
  assert.equal(bills.length, 1);
});

test('C36 — une addition sans ticket synchronisé est signalée', async (t) => {
  await installed(t);
  await assert.rejects(() => upsertBill(debtBill({ debtIssueId: 'inconnu', key: 'PROJ-9' })), /sans projet connu/);
});

test('le motif d’absence d’addition fait l’aller-retour (§19 cas 2)', async (t) => {
  await installed(t);
  await upsertBills('p1', [
    debtBill({ debtIssueId: 'd1', blockedReason: 'no-zone', lowJp: 0, highJp: 0 }),
    debtBill({ debtIssueId: 'd2' }),
  ]);
  assert.equal((await getBill('d1'))?.blockedReason, 'no-zone');
  assert.equal((await getBill('d2'))?.blockedReason, null);
});

test('les additions sont rendues de la plus lourde à la plus légère, sans SELECT *', async (t) => {
  const fake = await installed(t);
  await upsertBills('p1', [
    debtBill({ debtIssueId: 'd1', key: 'PROJ-1', lowJp: 2 }),
    debtBill({ debtIssueId: 'd2', key: 'PROJ-2', lowJp: 9 }),
    debtBill({ debtIssueId: 'd3', key: 'PROJ-3', lowJp: 5 }),
  ]);
  fake.log.length = 0;
  const bills = await listBills('p1');
  assert.deepEqual(bills.map((bill) => bill.debtIssueId), ['d2', 'd3', 'd1']);
  const reads = fake.log.filter((call) => call.kind === 'select');
  assert.ok(reads.length > 0);
  for (const call of reads) assert.ok(!/\bSELECT \*/i.test(call.query), `SELECT * subsistant : ${call.query}`);
});
