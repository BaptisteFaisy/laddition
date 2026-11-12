import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSettings } from '../core/settings';
import type { IssueFact } from '../core/types';
import { contextVelocity } from '../core/units';
import { issueFact } from '../platform/db/testFixtures';
import type { RecomputeInput } from './recompute';
import { prepare, recomputeAll } from './recompute';

/**
 * Chaîne DT-15 (§11) : `prepare` mesure la vélocité du projet avec
 * `contextVelocity` et l'injecte dans `CostContext.velocityPointsPerWeek`,
 * pour que `buildBill` convertisse les points d'une dette en jours. Calcul
 * pur : aucune I/O, aucune horloge.
 */

function input(facts: IssueFact[], overrides: Partial<RecomputeInput> = {}): RecomputeInput {
  return {
    projectId: 'p1',
    settings: makeSettings('p1', 'PAY'),
    facts,
    links: [],
    spansByIssue: new Map(),
    scores: [],
    rejections: [],
    confirmations: [],
    now: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function closed(id: number): IssueFact {
  const at = '2026-10-01T00:00:00.000Z';
  return issueFact({ issueId: `c${id}`, key: `PAY-${id}`, resolvedAt: at, closedAt: at });
}

test('DT-15 — prepare injecte la vélocité mesurée sur les faits du projet', () => {
  const facts = [closed(1), closed(2), issueFact({ issueId: 'open', key: 'PAY-9' })];
  const settings = makeSettings('p1', 'PAY');
  const prepared = prepare(input(facts, { settings }));
  assert.equal(prepared.ctx.velocityPointsPerWeek, contextVelocity(facts, settings));
  assert.equal(prepared.ctx.velocityPointsPerWeek, 0.16);
});

test('DT-15 — sans vélocité mesurable, le contexte reste null, jamais 0', () => {
  const prepared = prepare(input([issueFact({ issueId: 'open', key: 'PAY-9' })]));
  assert.equal(prepared.ctx.velocityPointsPerWeek, null);
});

test('DT-15 — une dette estimée en points obtient un remboursement chiffré', () => {
  const closedFacts = Array.from({ length: 20 }, (_, index) => closed(index));
  const debt = issueFact({
    issueId: 'd1',
    key: 'PAY-100',
    isDebt: true,
    labels: ['tech-debt'],
    estimateJp: null,
    storyPoints: 20,
  });
  const result = recomputeAll(input([...closedFacts, debt]));
  const bill = result.bills.find((item) => item.key === 'PAY-100');
  // 20 tickets fermés sur 90 jours = 1,56 pt/semaine ; 20 pts ÷ 1,56 × 5 j = 64,1 j.
  assert.equal(bill?.repaymentJp, 64.1);
});

test('DT-15 — sans vélocité, la dette en points reste « non chiffrée »', () => {
  const debt = issueFact({
    issueId: 'd1',
    key: 'PAY-100',
    isDebt: true,
    labels: ['tech-debt'],
    estimateJp: null,
    storyPoints: 20,
  });
  const result = recomputeAll(input([debt]));
  const bill = result.bills.find((item) => item.key === 'PAY-100');
  assert.equal(bill?.repaymentJp, null);
});
