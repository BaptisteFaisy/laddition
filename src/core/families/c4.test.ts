import assert from 'node:assert/strict';
import test from 'node:test';
import type { CostContext, Evidence, IssueFact, StatusCategory, StatusSpan } from '../types';
import { makeSettings } from '../settings';
import { c4Rework } from './c4';
import type { RejectedPullRequest } from './c4';

/** Instant de référence des tests (mercredi). */
const NOW = '2026-11-11T00:00:00.000Z';

/** Ticket minimal, surchargé au cas par cas. */
function makeFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'I-1',
    key: 'ADD-1',
    projectId: 'p1',
    projectKey: 'ADD',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: [],
    createdAt: '2026-10-19T00:00:00.000Z',
    resolvedAt: '2026-11-06T00:00:00.000Z',
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: ['api'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'Ticket de test',
    ...overrides,
  };
}

/** Contexte de calcul minimal. */
function makeCtx(spansByIssue: Map<string, StatusSpan[]>): CostContext {
  return { settings: makeSettings('p1', 'ADD'), now: NOW, baselines: new Map(), spansByIssue };
}

/** Séjour de statut. */
function span(category: StatusCategory, startedAt: string, endedAt: string | null): StatusSpan {
  return { issueId: 'I-1', category, startedAt, endedAt };
}

/** Séjours d'un ticket rouvert une fois, retravaillé du lundi 26/10 au 06/11. */
function oneReworkSpans(): StatusSpan[] {
  return [
    span('todo', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'),
    span('done', '2026-10-21T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
    span('inprogress', '2026-10-26T00:00:00.000Z', '2026-11-06T00:00:00.000Z'),
  ];
}

/** Séjours d'un ticket rouvert deux fois : 2 j ouvrés puis 4 j ouvrés. */
function twoReworkSpans(): StatusSpan[] {
  return [
    span('todo', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'),
    span('done', '2026-10-21T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
    span('inprogress', '2026-10-26T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
    span('done', '2026-10-28T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
    span('inprogress', '2026-11-02T00:00:00.000Z', '2026-11-06T00:00:00.000Z'),
  ];
}

/** Unique preuve attendue. */
function only(evidence: Evidence[]): Evidence {
  assert.equal(evidence.length, 1);
  return evidence[0] as Evidence;
}

test('une réouverture produit une preuve de reprise', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx));

  assert.equal(evidence.id, 'C4:I-1:api');
  assert.equal(evidence.zone, 'api');
  assert.equal(evidence.family, 'C4');
  assert.equal(evidence.sourceIssueId, 'I-1');
  assert.equal(evidence.sourceKey, 'ADD-1');
  assert.equal(evidence.occurredAt, '2026-11-06T00:00:00.000Z');
  assert.equal(evidence.method, 'computed');
  assert.equal(evidence.visible, true);
  // 26/10 → 06/11 : 9 jours ouvrés, une personne.
  assert.equal(evidence.costJp, 9);
  assert.equal(evidence.detail.durationDays, 9);
  assert.equal(evidence.detail.familyLabel, 'Retouches');
  assert.deepEqual(evidence.detail.inputs, { reouvertures: 1, joursReprise: 9, prRefusees: null, revueJp: 0 });
});

test('deux réouvertures cumulent les temps de reprise', () => {
  const ctx = makeCtx(new Map([['I-1', twoReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx));

  assert.deepEqual(evidence.detail.inputs, { reouvertures: 2, joursReprise: 6, prRefusees: null, revueJp: 0 });
  assert.equal(evidence.costJp, 6);
});

test('un ticket sans réouverture est ignoré', () => {
  const spans = [
    span('todo', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'),
    span('inprogress', '2026-10-21T00:00:00.000Z', '2026-11-06T00:00:00.000Z'),
  ];
  const ctx = makeCtx(new Map([['I-1', spans]]));
  assert.deepEqual(c4Rework([makeFact()], ctx), []);
});

test('une réouverture sans jour ouvré de reprise ne produit aucune preuve', () => {
  const spans = [
    span('todo', '2026-10-19T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
    span('done', '2026-10-26T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
    span('inprogress', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
  ];
  const ctx = makeCtx(new Map([['I-1', spans]]));
  assert.deepEqual(c4Rework([makeFact()], ctx), []);
});

test('un ticket résolu hors de la fenêtre est ignoré', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const fact = makeFact({ resolvedAt: '2026-01-05T00:00:00.000Z' });
  assert.deepEqual(c4Rework([fact], ctx), []);
});

test('le temps saisi ne remplace pas le coût de reprise', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const sansSaisie = only(c4Rework([makeFact()], ctx));
  const avecSaisie = only(c4Rework([makeFact({ loggedSeconds: 36_000 })], ctx));

  assert.equal(avecSaisie.costJp, sansSaisie.costJp);
  assert.match(avecSaisie.detail.formula, /déjà compté en C2\/C3/);
});

test('un ticket multi-zones partage son coût à parts égales', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const fact = makeFact({ components: ['api', 'web'] });
  const evidence = c4Rework([fact], ctx);

  assert.equal(evidence.length, 2);
  const zones = evidence.map((item) => item.zone).sort();
  assert.deepEqual(zones, ['api', 'web']);
  const total = evidence.reduce((sum, item) => sum + item.costJp, 0);
  assert.equal(Math.round(total * 100) / 100, 9);
  assert.deepEqual(
    evidence.map((item) => item.id).sort(),
    ['C4:I-1:api', 'C4:I-1:web'],
  );
});

test('le calcul est déterministe', () => {
  const spans = new Map([
    ['I-1', twoReworkSpans()],
    ['I-2', oneReworkSpans()],
  ]);
  const ctx = makeCtx(spans);
  const facts = [
    makeFact(),
    makeFact({ issueId: 'I-2', key: 'ADD-2', components: ['web'] }),
    makeFact({ issueId: 'I-3', key: 'ADD-3', resolvedAt: null }),
  ];

  const first = c4Rework(facts, ctx);
  const second = c4Rework(facts, ctx);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((item) => item.id).sort(),
    ['C4:I-1:api', 'C4:I-2:web'],
  );
});

/** PR refusée rattachée au ticket de test. */
function pr(overrides: Partial<RejectedPullRequest> = {}): RejectedPullRequest {
  return { issueId: 'I-1', prKey: 'repo#42', reviewDays: 2, ...overrides };
}

test('A14 — les PR refusées s’ajoutent au temps de reprise', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx, [pr()]));

  // 9 j de reprise + 2 j de revue refusée.
  assert.equal(evidence.costJp, 11);
  assert.equal(evidence.detail.durationDays, 11);
  assert.deepEqual(evidence.detail.inputs, {
    reouvertures: 1,
    joursReprise: 9,
    prRefusees: 1,
    revueJp: 2,
  });
  assert.match(evidence.detail.formula, /PR refusée\(s\) repo#42 : 2 j de revue/);
});

test('A14 — le nombre de relecteurs pondère le temps de revue', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx, [pr({ reviewers: 3 })]));

  // 9 j de reprise + 2 j × 3 relecteurs.
  assert.equal(evidence.costJp, 15);
  assert.equal(evidence.detail.inputs.revueJp, 6);
  assert.match(evidence.detail.formula, /repo#42 : 2 j de revue × 3 relecteur\(s\)/);
});

test('A14 — une PR refusée seule, sans réouverture, produit une preuve', () => {
  const ctx = makeCtx(new Map());
  const evidence = only(c4Rework([makeFact()], ctx, [pr({ reviewDays: 1.5 })]));

  assert.equal(evidence.costJp, 1.5);
  assert.equal(evidence.detail.inputs.reouvertures, 0);
  assert.equal(evidence.detail.inputs.joursReprise, 0);
});

test('A14 — une PR d’un autre ticket est ignorée', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx, [pr({ issueId: 'I-9' })]));

  assert.equal(evidence.costJp, 9);
  assert.equal(evidence.detail.inputs.prRefusees, 0);
});

test('A14 — une PR illisible ne produit ni NaN ni coût négatif', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx, [pr({ reviewDays: Number.NaN, reviewers: -2 })]));

  assert.equal(evidence.costJp, 9);
  assert.equal(Number.isNaN(evidence.costJp), false);
});

test('A14 — sans PR fournie, la formule dit le repli « temps en statut de revue »', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx));

  assert.match(evidence.detail.formula, /temps en statut de revue compris/);
  assert.equal(evidence.costJp, 9);
});

test('A14 — le coût des PR refusées se partage entre les zones', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = c4Rework([makeFact({ components: ['api', 'web'] })], ctx, [pr({ reviewDays: 1 })]);

  assert.equal(evidence.length, 2);
  const total = evidence.reduce((sum, item) => sum + item.costJp, 0);
  assert.equal(Math.round(total * 100) / 100, 10);
});

test('A14 — source PR absente : repli assumé, la formule dit d’où vient le chiffre', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx));

  assert.match(evidence.detail.formula, /PR refusées : source absente — repli assumé/);
  assert.match(evidence.detail.formula, /temps passé en statut de revue \(séjours de statut\), pas de PR refusées/);
  // Donnée absente : null, jamais 0 (qui prétendrait un fait mesuré).
  assert.equal(evidence.detail.inputs.prRefusees, null);
});

test('A14 — source PR fournie et vide : zéro refus est un fait, pas une absence', () => {
  const ctx = makeCtx(new Map([['I-1', oneReworkSpans()]]));
  const evidence = only(c4Rework([makeFact()], ctx, []));

  assert.equal(evidence.detail.inputs.prRefusees, 0);
  assert.doesNotMatch(evidence.detail.formula, /source absente/);
});
