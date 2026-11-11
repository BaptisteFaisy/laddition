import test from 'node:test';
import assert from 'node:assert/strict';

import type { DebtBill, Family, FamilyTotal, IssueFact } from './types';
import { rankDebts } from './ranking';

/** Ventilation par famille, tout à zéro : le classement ne la lit pas. */
function zeroFamilies(): Record<Family, FamilyTotal> {
  const total: FamilyTotal = { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false };
  return { C1: { ...total }, C2: { ...total }, C3: { ...total }, C4: { ...total }, C5: { ...total } };
}

/** Addition minimale, surchargeable champ par champ. */
function bill(partial: Partial<DebtBill> = {}): DebtBill {
  return {
    debtIssueId: 'D1',
    key: 'PROJ-1',
    computedAt: '2026-11-11T09:00:00.000Z',
    lowJp: 0,
    highJp: 0,
    byFamily: zeroFamilies(),
    evidenceIds: [],
    hiddenCount: 0,
    repaymentJp: null,
    avoidableJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
    ...partial,
  };
}

const BASE_DEBT: IssueFact = {
  issueId: 'D1',
  key: 'PROJ-1',
  projectId: 'p1',
  projectKey: 'PROJ',
  type: 'Story',
  isBug: false,
  isIncident: false,
  isDebt: true,
  zones: ['api'],
  createdAt: '2026-01-05T08:00:00.000Z',
  resolvedAt: null,
  closedAt: null,
  size: 'm',
  estimateJp: 20,
  loggedSeconds: null,
  labels: ['tech-debt'],
  components: ['api'],
  affectedServices: [],
  hasPostMortem: false,
  participants: 2,
  visible: true,
  summary: 'Rapatrier la validation dans la couche domaine',
};

/** Ticket de dette, surchargeable champ par champ. */
function debtFact(partial: Partial<IssueFact> = {}): IssueFact {
  return { ...BASE_DEBT, ...partial };
}

test('les dettes sortent de la plus chère à la moins chère', () => {
  const ranked = rankDebts(
    [
      bill({ debtIssueId: 'A', key: 'PROJ-1', lowJp: 3 }),
      bill({ debtIssueId: 'B', key: 'PROJ-2', lowJp: 10 }),
      bill({ debtIssueId: 'C', key: 'PROJ-3', lowJp: 7 }),
    ],
    [debtFact({ issueId: 'A' }), debtFact({ issueId: 'B' }), debtFact({ issueId: 'C' })],
  );

  assert.deepEqual(
    ranked.map((row) => row.lowJp),
    [10, 7, 3],
  );
});

test('à addition basse égale, l’addition haute départage', () => {
  const ranked = rankDebts(
    [
      bill({ debtIssueId: 'A', key: 'PROJ-1', lowJp: 5, highJp: 8 }),
      bill({ debtIssueId: 'B', key: 'PROJ-2', lowJp: 5, highJp: 9 }),
    ],
    [],
  );

  assert.deepEqual(
    ranked.map((row) => row.key),
    ['PROJ-2', 'PROJ-1'],
  );
});

test('à égalité parfaite, la clé alphabétique tranche : ordre déterministe', () => {
  const ranked = rankDebts(
    [
      bill({ debtIssueId: 'A', key: 'PROJ-2', lowJp: 5, highJp: 5 }),
      bill({ debtIssueId: 'B', key: 'PROJ-10', lowJp: 5, highJp: 5 }),
    ],
    [],
  );

  // Comparaison de texte, pas de nombre : « PROJ-10 » précède « PROJ-2 ».
  assert.deepEqual(
    ranked.map((row) => row.key),
    ['PROJ-10', 'PROJ-2'],
  );
});

test('le même jeu de données donne toujours le même classement', () => {
  const bills = [
    bill({ debtIssueId: 'A', key: 'PROJ-1', lowJp: 4, highJp: 6 }),
    bill({ debtIssueId: 'B', key: 'PROJ-2', lowJp: 4, highJp: 6 }),
    bill({ debtIssueId: 'C', key: 'PROJ-3', lowJp: 9, highJp: 9 }),
  ];
  const debts = [debtFact({ issueId: 'A' }), debtFact({ issueId: 'B' }), debtFact({ issueId: 'C' })];

  const first = rankDebts(bills, debts).map((row) => row.key);
  const second = rankDebts([...bills].reverse(), [...debts].reverse()).map((row) => row.key);

  assert.deepEqual(first, ['PROJ-3', 'PROJ-1', 'PROJ-2']);
  assert.deepEqual(second, first);
});

test('le classement ne modifie pas les tableaux reçus', () => {
  const bills = [
    bill({ debtIssueId: 'A', key: 'PROJ-1', lowJp: 1 }),
    bill({ debtIssueId: 'B', key: 'PROJ-2', lowJp: 9 }),
  ];

  rankDebts(bills, []);

  assert.deepEqual(
    bills.map((item) => item.key),
    ['PROJ-1', 'PROJ-2'],
  );
});

test('chaque ligne reprend la zone et le résumé du ticket de dette', () => {
  const ranked = rankDebts(
    [bill({ debtIssueId: 'A', key: 'PROJ-1', lowJp: 5, repaymentJp: 20, roiLow: 0.5, paybackDays: 60 })],
    [debtFact({ issueId: 'A', zones: ['paiement', 'api'], summary: 'Découpler le service de paiement' })],
  );

  assert.equal(ranked.length, 1);
  const row = ranked[0];
  assert.ok(row);
  assert.equal(row.zone, 'paiement'); // première zone du ticket
  assert.equal(row.summary, 'Découpler le service de paiement');
  assert.equal(row.repaymentJp, 20);
  assert.equal(row.roiLow, 0.5);
  assert.equal(row.roiHigh, null);
  assert.equal(row.paybackDays, 60);
  assert.equal(row.debtIssueId, 'A');
});

test('un ticket introuvable tombe dans « non classé » sans résumé', () => {
  const ranked = rankDebts([bill({ debtIssueId: 'ORPHELIN', key: 'PROJ-9', lowJp: 2 })], []);

  const row = ranked[0];
  assert.ok(row);
  assert.equal(row.zone, 'non classé');
  assert.equal(row.summary, '');
  assert.equal(row.key, 'PROJ-9');
});

test('aucune addition, aucun classement', () => {
  assert.deepEqual(rankDebts([], [debtFact()]), []);
});
