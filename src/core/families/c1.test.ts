import test from 'node:test';
import assert from 'node:assert/strict';

import type { CostContext, IssueFact } from '../types.ts';
import { makeSettings } from '../settings.ts';
import { c1Incidents } from './c1.ts';

const NOW = '2026-11-01T00:00:00.000Z';
/** Lundi 26 octobre 2026 : 5 jours ouvrés jusqu'à NOW (dimanche). */
const MON_26_OCT = '2026-10-26T09:00:00.000Z';
/** Lundi 5 → vendredi 9 octobre 2026 : 5 jours ouvrés. */
const MON_05_OCT = '2026-10-05T09:00:00.000Z';
const FRI_09_OCT = '2026-10-09T17:00:00.000Z';

function makeFact(overrides: Partial<IssueFact>): IssueFact {
  return {
    issueId: 'i1',
    key: 'K-1',
    projectId: 'p1',
    projectKey: 'K',
    type: 'Incident',
    isBug: false,
    isIncident: true,
    isDebt: false,
    zones: [],
    createdAt: NOW,
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
    summary: 'Passerelle de paiement indisponible',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ReturnType<typeof makeSettings>> = {}): CostContext {
  return {
    settings: makeSettings('p1', 'K', {
      maxIncidentPeople: 6,
      postMortemBonusJp: 0.5,
      windowDays: 90,
      hoursPerDay: 7,
      ...overrides,
    }),
    now: NOW,
    baselines: new Map(),
    spansByIssue: new Map(),
  };
}

test('C1 — plafonne les intervenants au réglage du projet', () => {
  const fact = makeFact({ issueId: 'cap', participants: 10, createdAt: MON_26_OCT });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof, 'une preuve est attendue');
  // 5 jours ouvrés × min(10, 6) = 30, et non 50 (10 intervenants comptés).
  assert.equal(proof.costJp, 30);
  assert.equal(proof.detail.inputs.maxParticipants, 6);
  assert.equal(proof.detail.inputs.participants, 10);
});

test('C1 — un incident non résolu est compté jusqu’à now', () => {
  const fact = makeFact({ issueId: 'open', participants: 1, createdAt: MON_26_OCT });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.detail.durationDays, 5);
  assert.equal(proof.detail.inputs.enCours, true);
  assert.equal(proof.occurredAt, MON_26_OCT);
});

test('C1 — un post-mortem lié ajoute le bonus', () => {
  const fact = makeFact({
    issueId: 'pm',
    participants: 2,
    createdAt: MON_05_OCT,
    resolvedAt: FRI_09_OCT,
    hasPostMortem: true,
  });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof);
  // 5 jours × 2 intervenants = 10, plus 0,5 de bonus.
  assert.equal(proof.costJp, 10.5);
  assert.match(proof.detail.formula, /post-mortem/);
});

test('C1 — le temps saisi remplace le calcul', () => {
  const fact = makeFact({ issueId: 'logged', participants: 3, createdAt: MON_26_OCT, loggedSeconds: 50_400 });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof);
  // 50 400 s = 14 h = 2 j-p à 7 h/j, alors que la formule donnerait 15.
  assert.equal(proof.costJp, 2);
  assert.equal(proof.method, 'logged');
  assert.match(proof.detail.formula, /temps saisi/);
});

test('C1 — le coût est partagé entre les zones, sans perte', () => {
  const fact = makeFact({ issueId: 'multi', participants: 2, createdAt: MON_26_OCT, components: ['api', 'web'] });
  const proofs = c1Incidents([fact], makeCtx());

  assert.equal(proofs.length, 2);
  assert.deepEqual(proofs.map((p) => p.zone), ['api', 'web']);
  assert.deepEqual(proofs.map((p) => p.costJp), [5, 5]);
  const total = proofs.reduce((sum, p) => sum + p.costJp, 0);
  assert.equal(total, 10);
  assert.deepEqual(proofs.map((p) => p.id), ['C1:multi:api', 'C1:multi:web']);
});

test('C1 — un incident hors fenêtre est exclu', () => {
  const old = makeFact({
    issueId: 'old',
    createdAt: '2026-05-25T09:00:00.000Z',
    resolvedAt: '2026-06-01T17:00:00.000Z',
  });
  assert.deepEqual(c1Incidents([old], makeCtx()), []);
});

test('C1 — méthode, famille et visibilité sont propagées', () => {
  const fact = makeFact({ issueId: 'vis', createdAt: MON_26_OCT, visible: false });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.method, 'computed');
  assert.equal(proof.family, 'C1');
  assert.equal(proof.visible, false);
  assert.equal(proof.detail.familyLabel, 'Incidents');
  assert.equal(proof.detail.sourceSummary, fact.summary);
});

test('C1 — les tickets qui ne sont pas des incidents sont ignorés', () => {
  const bug = makeFact({ issueId: 'b', isIncident: false, isBug: true, createdAt: MON_26_OCT });
  assert.deepEqual(c1Incidents([bug], makeCtx()), []);
});

test('C1 — le coût n’est jamais négatif', () => {
  const fact = makeFact({ issueId: 'zero', participants: 0, createdAt: MON_26_OCT });
  const [proof] = c1Incidents([fact], makeCtx());

  assert.ok(proof);
  assert.equal(proof.costJp, 0);
  assert.ok(proof.costJp >= 0);
});

test('C1 — deux appels donnent exactement les mêmes preuves', () => {
  const facts = [
    makeFact({ issueId: 'a', participants: 10, createdAt: MON_26_OCT }),
    makeFact({ issueId: 'b', participants: 2, createdAt: MON_05_OCT, resolvedAt: FRI_09_OCT, hasPostMortem: true }),
  ];
  const first = c1Incidents(facts, makeCtx());
  const second = c1Incidents(facts, makeCtx());

  assert.deepEqual(first.map((p) => p.id), second.map((p) => p.id));
  assert.deepEqual(first.map((p) => p.costJp), second.map((p) => p.costJp));
});
