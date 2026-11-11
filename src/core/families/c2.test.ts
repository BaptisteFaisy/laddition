import test from 'node:test';
import assert from 'node:assert/strict';

import type { CostContext, IssueFact, StatusSpan } from '../types';
import { makeSettings } from '../settings';
import { c2Bugs } from './c2';

const NOW = '2026-11-01T00:00:00.000Z';
/** Lundi 12 octobre 2026. */
const MON_12_OCT = '2026-10-12T09:00:00.000Z';
const FRI_16_OCT = '2026-10-16T17:00:00.000Z';
/** Lundi 19 octobre 2026 : 10 jours ouvrés jusqu'à NOW. */
const MON_19_OCT = '2026-10-19T08:00:00.000Z';

function makeFact(overrides: Partial<IssueFact>): IssueFact {
  return {
    issueId: 'b1',
    key: 'K-2',
    projectId: 'p1',
    projectKey: 'K',
    type: 'Bug',
    isBug: true,
    isIncident: false,
    isDebt: false,
    zones: [],
    createdAt: MON_12_OCT,
    resolvedAt: null,
    closedAt: null,
    size: 'unknown',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: ['api'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 2,
    visible: true,
    summary: 'Le total du panier est faux',
    ...overrides,
  };
}

function span(category: StatusSpan['category'], startedAt: string, endedAt: string | null): StatusSpan {
  return { issueId: 'b1', category, startedAt, endedAt };
}

function makeCtx(spansByIssue: Map<string, StatusSpan[]> = new Map()): CostContext {
  return {
    settings: makeSettings('p1', 'K', { windowDays: 90, hoursPerDay: 7 }),
    now: NOW,
    baselines: new Map(),
    spansByIssue,
  };
}

test('C2 — compte les jours passés en cours depuis l’historique', () => {
  const fact = makeFact({ issueId: 'b1' });
  const spans = new Map([['b1', [span('inprogress', MON_12_OCT, FRI_16_OCT)]]]);
  const [proof] = c2Bugs([fact], makeCtx(spans));

  assert.ok(proof);
  // 5 jours ouvrés en cours × 1 personne.
  assert.equal(proof.costJp, 5);
  assert.equal(proof.detail.durationDays, 5);
  assert.equal(proof.method, 'computed');
});

test('C2 — ignore les séjours hors « en cours »', () => {
  const fact = makeFact({ issueId: 'b1' });
  const spans = new Map([
    ['b1', [span('todo', '2026-10-01T09:00:00.000Z', MON_12_OCT), span('inprogress', MON_12_OCT, FRI_16_OCT)]],
  ]);
  const [proof] = c2Bugs([fact], makeCtx(spans));

  assert.ok(proof);
  assert.equal(proof.costJp, 5);
});

test('C2 — approche la durée sans historique de statuts', () => {
  const fact = makeFact({ issueId: 'nos', createdAt: MON_19_OCT });
  const [proof] = c2Bugs([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.costJp, 10);
  assert.equal(proof.method, 'approximated');
  assert.equal(proof.detail.inputs.statusHistory, false);
});

test('C2 — le temps saisi remplace le calcul', () => {
  const fact = makeFact({ issueId: 'log', createdAt: MON_19_OCT, loggedSeconds: 50_400 });
  const [proof] = c2Bugs([fact], makeCtx());

  assert.ok(proof);
  // 50 400 s = 14 h = 2 j-p, alors que la durée approchée donnerait 10.
  assert.equal(proof.costJp, 2);
  assert.equal(proof.method, 'logged');
  assert.match(proof.detail.formula, /temps saisi/);
});

test('C2 — un bug créé hors fenêtre est exclu', () => {
  const old = makeFact({ issueId: 'old', createdAt: '2026-05-04T09:00:00.000Z', resolvedAt: '2026-05-08T17:00:00.000Z' });
  assert.deepEqual(c2Bugs([old], makeCtx()), []);
});

test('C2 — le coût est partagé entre les zones, sans perte', () => {
  const fact = makeFact({ issueId: 'multi', createdAt: MON_19_OCT, components: ['api', 'web'] });
  const proofs = c2Bugs([fact], makeCtx());

  assert.equal(proofs.length, 2);
  assert.deepEqual(proofs.map((p) => p.zone), ['api', 'web']);
  assert.deepEqual(proofs.map((p) => p.costJp), [5, 5]);
  assert.equal(proofs.reduce((sum, p) => sum + p.costJp, 0), 10);
  assert.deepEqual(proofs.map((p) => p.id), ['C2:multi:api', 'C2:multi:web']);
});

test('C2 — ignore les tickets qui ne sont pas des bugs', () => {
  const incident = makeFact({ issueId: 'i', isBug: false, isIncident: true });
  assert.deepEqual(c2Bugs([incident], makeCtx()), []);
});

test('C2 — famille, libellé et résumé source sont renseignés', () => {
  const fact = makeFact({ issueId: 'meta', createdAt: MON_19_OCT, visible: false });
  const [proof] = c2Bugs([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.family, 'C2');
  assert.equal(proof.visible, false);
  assert.equal(proof.detail.familyLabel, 'Bugs');
  assert.equal(proof.detail.sourceSummary, fact.summary);
  assert.equal(proof.detail.inputs.persons, 1);
  assert.match(proof.detail.formula, /1 personne/);
});

test('C2 — deux appels donnent exactement les mêmes preuves', () => {
  const facts = [
    makeFact({ issueId: 'a', createdAt: MON_19_OCT }),
    makeFact({ issueId: 'b', createdAt: MON_19_OCT, components: ['api', 'web'] }),
  ];
  const first = c2Bugs(facts, makeCtx());
  const second = c2Bugs(facts, makeCtx());

  assert.deepEqual(first.map((p) => p.id), second.map((p) => p.id));
  assert.deepEqual(first.map((p) => p.costJp), second.map((p) => p.costJp));
});

test('C2 — le coût n’est jamais négatif', () => {
  const fact = makeFact({ issueId: 'neg', createdAt: NOW });
  const [proof] = c2Bugs([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.costJp, 0);
  assert.ok(proof.costJp >= 0);
});
