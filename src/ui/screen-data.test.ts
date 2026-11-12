import assert from 'node:assert/strict';
import test from 'node:test';
import type { DebtBillView, IssueCost, ProjectPageData } from './api';
import type { Family, FamilyTotal } from '../core/types';
import { costOfBill } from './issue-cost';
import { GADGET_TOP_DEBTS, dataOfPage } from './gadget-data';

function families(insufficient: boolean): Record<Family, FamilyTotal> {
  const total: FamilyTotal = { lowJp: 1, highJp: 2, evidenceCount: 3, insufficient };
  return { C1: total, C2: total, C3: total, C4: total, C5: total };
}

function billView(insufficient: boolean): DebtBillView {
  return {
    settings: { windowDays: 90, demoData: true } as DebtBillView['settings'],
    zone: 'payments',
    bill: {
      debtIssueId: '1',
      key: 'PAY-77',
      computedAt: '2026-11-11T00:00:00.000Z',
      lowJp: 19,
      highJp: 34,
      byFamily: families(insufficient),
      evidenceIds: [],
      hiddenCount: 0,
      repaymentJp: null,
      avoidableJp: null,
      roiLow: null,
      roiHigh: null,
      paybackDays: null,
    },
    evidence: [],
    pendingMatches: [],
    attribution: null,
  };
}

test('le coût du champ personnalisé reprend les chiffres de l\'addition (item D39)', () => {
  const cost: IssueCost = costOfBill(billView(false));
  assert.deepEqual(cost, { lowJp: 19, highJp: 34, days: 90, insufficient: false, demoData: true });
});

test('une famille non chiffrable marque le champ « données insuffisantes »', () => {
  assert.equal(costOfBill(billView(true)).insufficient, true);
});

function page(debts: number): ProjectPageData {
  const ranking = Array.from({ length: debts }, (_, index) => ({
    debtIssueId: `${index}`,
    key: `PAY-${index}`,
    summary: '',
    zone: '',
    lowJp: index,
    highJp: index,
    repaymentJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
  }));
  return {
    settings: { demoData: false } as ProjectPageData['settings'],
    ranking,
    zones: [],
    quality: {} as ProjectPageData['quality'],
    costByTeam: [{ team: 'pay', costJp: 4 }],
    costByQuarter: [{ quarter: '2026-T4', costJp: 4 }],
  };
}

test('le gadget ne garde que le haut du classement (item D40)', () => {
  const data = dataOfPage(page(GADGET_TOP_DEBTS + 3));
  assert.equal(data.debts.length, GADGET_TOP_DEBTS);
  assert.equal(data.debts[0]?.key, 'PAY-0');
});

test('le gadget reprend les équipes, les trimestres et le marqueur d\'exemple', () => {
  const data = dataOfPage(page(2));
  assert.deepEqual(data.costByTeam, [{ team: 'pay', costJp: 4 }]);
  assert.deepEqual(data.costByQuarter, [{ quarter: '2026-T4', costJp: 4 }]);
  assert.equal(data.demoData, false);
});
