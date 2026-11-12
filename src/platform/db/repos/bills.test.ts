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
import { makeSettings } from '../../../core/settings';
import type { Family } from '../../../core/types';
import { zeroFamilyNumbers } from '../rows';
import { getBill, listBills, listZoneWeeks, upsertBill, upsertBills, upsertZoneWeek } from './bills';
import { replaceEvidence } from './costs';
import { upsertIssueFacts } from './issues';
import { saveSettings } from './project';
import { debtBill, evidence, issueFact } from '../testFixtures';

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

/* ------------------------------------------------ coûts de zone (item 56, §9) */

/** Case zone × semaine, ventilation complète à partir de valeurs partielles. */
function zoneWeek(zone: string, week: string, costJp: number, values: Partial<Record<Family, number>>) {
  const byFamily = zeroFamilyNumbers();
  for (const family of Object.keys(byFamily) as Family[]) byFamily[family] = values[family] ?? 0;
  return { projectId: 'p1', zone, week, costJp, byFamily };
}

test('item 56 — C3 sous le seuil de références marque la zone « données insuffisantes »', async (t) => {
  await installed(t);
  await saveSettings(makeSettings('p1', 'PAY'));
  await replaceEvidence('p1', [
    evidence({ id: 'c1', zone: 'taxes', family: 'C3', sourceIssueId: 's1', sourceKey: 'PAY-1' }),
    evidence({ id: 'c2', zone: 'taxes', family: 'C3', sourceIssueId: 's2', sourceKey: 'PAY-2' }),
    evidence({ id: 'c3', zone: 'taxes', family: 'C3', sourceIssueId: 's2', sourceKey: 'PAY-2' }),
    evidence({ id: 'r1', zone: 'taxes', family: 'C4', sourceIssueId: 's9', sourceKey: 'PAY-9' }),
  ]);
  await upsertZoneWeek([
    zoneWeek('taxes', '2026-11-02', 3, { C3: 2, C4: 1 }),
    zoneWeek('api', '2026-11-02', 1, { C3: 1 }),
  ]);

  const costs = await listZoneWeeks('p1', ['2026-11-02']);
  const taxes = costs.find((cost) => cost.zone === 'taxes');
  assert.equal(taxes?.insufficientByFamily?.C3, true, 'deux tickets de référence distincts < 5 (§9)');
  assert.equal(taxes?.insufficientByFamily?.C4, undefined, 'seule C3 dépend de l’échantillon de références');
  const api = costs.find((cost) => cost.zone === 'api');
  assert.equal(api?.insufficientByFamily?.C3, true, 'un coût C3 sans aucune référence n’est pas chiffrable');
});

test('item 56 — échantillon suffisant : aucun drapeau, seuil lu dans les réglages', async (t) => {
  await installed(t);
  await saveSettings(makeSettings('p1', 'PAY', { minBaselineSample: 3 }));
  await replaceEvidence(
    'p1',
    [1, 2, 3].map((n) =>
      evidence({ id: `c${n}`, zone: 'api', family: 'C3', sourceIssueId: `s${n}`, sourceKey: `PAY-${n}` }),
    ),
  );
  await upsertZoneWeek([zoneWeek('api', '2026-11-02', 6, { C3: 6 })]);

  const costs = await listZoneWeeks('p1', ['2026-11-02']);
  assert.equal(costs.length, 1);
  assert.equal(costs[0]?.insufficientByFamily, undefined, '3 références distinctes ≥ seuil de 3');
  assert.equal(costs[0]?.totalJp, 6);
});
