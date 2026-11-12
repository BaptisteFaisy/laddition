/**
 * Tests de la simulation pure (DT-21).
 *
 * Propriétés vérifiées : uniquement des chiffres déjà stockés (aucun recalcul),
 * chaque ligne porte sa méthode, les deux unités (j-p sur deux trimestres,
 * j-p par semaine) ne sont jamais additionnées entre elles, et rien ne rend
 * `NaN` : ce qui n'est pas chiffrable reste `null` ou `0`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DebtBill, Family, FamilyTotal, Repayment } from './types';
import type { SimulationDebtInput, SimulationResult, SimulationRow } from './simulation';
import { simulateRepayment } from './simulation';

/** Ligne attendue, ou échec du test (indexation stricte). */
function rowAt(result: SimulationResult, index: number): SimulationRow {
  const row = result.rows[index];
  assert.ok(row, `ligne ${index} manquante`);
  return row;
}

/* ------------------------------------------------------------ fabriques */

const NOW = '2026-11-01T00:00:00.000Z';

function familyTotals(): Record<Family, FamilyTotal> {
  const out = {} as Record<Family, FamilyTotal>;
  for (const family of ['C1', 'C2', 'C3', 'C4', 'C5'] as Family[]) {
    out[family] = { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false };
  }
  return out;
}

function bill(overrides: Partial<DebtBill> = {}): DebtBill {
  return {
    debtIssueId: 'd1',
    key: 'PAY-1',
    computedAt: NOW,
    lowJp: 0,
    highJp: 0,
    byFamily: familyTotals(),
    evidenceIds: [],
    hiddenCount: 0,
    repaymentJp: null,
    avoidableJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
    ...overrides,
  };
}

function bulletin(overrides: Partial<Repayment> = {}): Repayment {
  return {
    debtIssueId: 'd1',
    key: 'PAY-1',
    zone: 'taxes',
    closedAt: NOW,
    beforeRate: 0,
    afterRate: 0,
    weeksBefore: 8,
    weeksAfter: 8,
    caveats: [],
    publishedAt: NOW,
    ...overrides,
  };
}

function debt(overrides: Partial<SimulationDebtInput> = {}): SimulationDebtInput {
  return { debtIssueId: 'd1', key: 'PAY-1', zone: 'taxes', bill: null, bulletin: null, ...overrides };
}

/* ------------------------------------------------------- cas nominal */

describe('simulateRepayment — cas nominal', () => {
  it('additionne les coûts évitables stockés, sans rien recalculer', () => {
    const result = simulateRepayment({
      selectedIds: ['d77', 'd41'],
      debts: [
        debt({ debtIssueId: 'd77', key: 'PAY-77', bill: bill({ avoidableJp: 8.4, repaymentJp: 2, paybackDays: 30 }) }),
        debt({ debtIssueId: 'd41', key: 'PAY-41', bill: bill({ avoidableJp: 5, repaymentJp: 3, paybackDays: 12 }) }),
      ],
    });
    assert.equal(result.rows.length, 2);
    const first = rowAt(result, 0);
    assert.equal(first.method, 'avoidable');
    assert.equal(first.avoidableJp, 8.4);
    assert.equal(first.repaymentJp, 2);
    assert.equal(first.paybackDays, 30);
    assert.match(first.methodText, /addition stockée : 8,4 j-p|8\.4/);
    assert.equal(result.totals.avoidableJp, 13.4);
    assert.equal(result.totals.repaymentJp, 5);
    assert.equal(result.totals.observedWeeklyJp, 0);
    assert.equal(result.totals.unquantifiedCount, 0);
    assert.equal(result.totals.selectedCount, 2);
  });

  it('une dette remboursée rend la baisse observée du bulletin publié', () => {
    const result = simulateRepayment({
      selectedIds: ['d41'],
      debts: [
        debt({
          debtIssueId: 'd41',
          bulletin: bulletin({ beforeRate: 2.6, afterRate: 0.7, caveats: ['recul insuffisant'] }),
          bill: bill({ avoidableJp: 5 }),
        }),
      ],
    });
    const row = rowAt(result, 0);
    assert.equal(row.method, 'observed');
    assert.equal(row.repaid, true);
    assert.equal(row.observedWeeklyJp, 1.9);
    assert.deepEqual(row.caveats, ['recul insuffisant'], 'les limites stockées sont recopiées');
    assert.match(row.methodText, /bulletin publié/);
    // L'observé (j-p/semaine) n'est jamais mélangé à l'évitable (j-p/2 trimestres).
    assert.equal(result.totals.observedWeeklyJp, 1.9);
    assert.equal(result.totals.avoidableJp, 0, 'une dette remboursée ne compte plus dans l’évitable');
    assert.equal(result.totals.repaymentJp, 0, 'le travail est déjà fait');
  });
});

/* ------------------------------------------- dette sans addition, inconnue */

describe('simulateRepayment — dettes sans chiffre', () => {
  it('une dette sans addition est non chiffrable, jamais 0', () => {
    const result = simulateRepayment({ selectedIds: ['d90'], debts: [debt({ debtIssueId: 'd90', key: 'PAY-90' })] });
    const row = rowAt(result, 0);
    assert.equal(row.method, 'unquantified');
    assert.equal(row.avoidableJp, null);
    assert.equal(row.observedWeeklyJp, null);
    assert.match(row.methodText, /aucune addition stockée/);
    assert.equal(result.totals.unquantifiedCount, 1);
    assert.equal(result.totals.avoidableJp, 0);
  });

  it('une addition sans coût évitable chiffré reste non chiffrable', () => {
    const result = simulateRepayment({
      selectedIds: ['d41'],
      debts: [debt({ debtIssueId: 'd41', bill: bill({ lowJp: 0, avoidableJp: null }) })],
    });
    assert.equal(rowAt(result, 0).method, 'unquantified');
    assert.match(rowAt(result, 0).methodText, /sans coût évitable chiffré/);
  });

  it('un identifiant absent du projet est signalé, pas inventé', () => {
    const result = simulateRepayment({ selectedIds: ['nope'], debts: [] });
    const row = rowAt(result, 0);
    assert.equal(row.method, 'unknown');
    assert.equal(row.key, 'nope');
    assert.match(row.methodText, /absente du projet/);
    assert.equal(result.totals.unquantifiedCount, 1);
  });

  it('les doublons de la sélection ne comptent qu’une fois, l’ordre est gardé', () => {
    const result = simulateRepayment({
      selectedIds: ['b', 'a', 'b'],
      debts: [debt({ debtIssueId: 'a', key: 'A' }), debt({ debtIssueId: 'b', key: 'B' })],
    });
    assert.deepEqual(result.rows.map((row) => row.debtIssueId), ['b', 'a']);
    assert.equal(result.totals.selectedCount, 2);
  });
});

/* --------------------------------------------- remboursement partiel, nul */

describe('simulateRepayment — remboursements partiels et capacité nulle', () => {
  it('un remboursement partiel rend la baisse nette observée', () => {
    const result = simulateRepayment({
      selectedIds: ['d1'],
      debts: [debt({ bulletin: bulletin({ beforeRate: 3, afterRate: 1.8 }) })],
    });
    assert.equal(rowAt(result, 0).observedWeeklyJp, 1.2);
    assert.equal(result.totals.observedWeeklyJp, 1.2);
  });

  it('une hausse après clôture rend 0 observé, jamais une capacité négative', () => {
    const result = simulateRepayment({
      selectedIds: ['d1'],
      debts: [debt({ bulletin: bulletin({ beforeRate: 1, afterRate: 2.5 }) })],
    });
    const row = rowAt(result, 0);
    assert.equal(row.method, 'observed');
    assert.equal(row.observedWeeklyJp, 0);
    assert.match(row.methodText, /aucune baisse observée/);
    assert.equal(result.totals.observedWeeklyJp, 0);
  });

  it('capacité nulle partout : des totaux à 0, pas des null', () => {
    const result = simulateRepayment({
      selectedIds: ['a', 'b'],
      debts: [debt({ debtIssueId: 'a' }), debt({ debtIssueId: 'b' })],
    });
    assert.equal(result.totals.avoidableJp, 0);
    assert.equal(result.totals.observedWeeklyJp, 0);
    assert.equal(result.totals.repaymentJp, 0);
    assert.equal(result.totals.unquantifiedCount, 2);
  });

  it('sélection vide : aucun ligne, totaux nuls', () => {
    const result = simulateRepayment({ selectedIds: [], debts: [debt({})] });
    assert.equal(result.rows.length, 0);
    assert.equal(result.totals.selectedCount, 0);
    assert.equal(result.totals.avoidableJp, 0);
  });

  it('des taux illisibles ne produisent jamais NaN', () => {
    const result = simulateRepayment({
      selectedIds: ['d1'],
      debts: [debt({ bulletin: bulletin({ beforeRate: Number.NaN, afterRate: Number.POSITIVE_INFINITY }) })],
    });
    assert.equal(rowAt(result, 0).observedWeeklyJp, 0);
    assert.ok(Number.isFinite(result.totals.observedWeeklyJp));
  });
});

/* ---------------------------------------------------------------- arrondis */

describe('simulateRepayment — arrondis', () => {
  it('la baisse observée est arrondie à deux décimales', () => {
    const result = simulateRepayment({
      selectedIds: ['d1'],
      debts: [debt({ bulletin: bulletin({ beforeRate: 2.667, afterRate: 0.333 }) })],
    });
    assert.equal(rowAt(result, 0).observedWeeklyJp, 2.33);
  });

  it('les totaux n’accumulent pas de bruit de virgule flottante', () => {
    const result = simulateRepayment({
      selectedIds: ['a', 'b'],
      debts: [
        debt({ debtIssueId: 'a', bill: bill({ avoidableJp: 0.1 }) }),
        debt({ debtIssueId: 'b', bill: bill({ avoidableJp: 0.2 }) }),
      ],
    });
    assert.equal(result.totals.avoidableJp, 0.3);
  });
});
