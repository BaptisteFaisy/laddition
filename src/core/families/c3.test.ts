import test from 'node:test';
import assert from 'node:assert/strict';
import type { Baseline, CostContext, IssueFact, StatusSpan } from '../types';
import { makeSettings } from '../settings';
import { c3Slowness } from './c3';

const NOW = '2026-11-30T00:00:00.000Z';

/** Ticket minimal, surchargeable champ par champ. */
function makeFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'i1',
    key: 'ABC-1',
    projectId: 'p1',
    projectKey: 'ABC',
    type: 'Story',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: [],
    createdAt: '2026-11-09T00:00:00.000Z',
    resolvedAt: '2026-11-13T00:00:00.000Z',
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
    summary: 'Ticket',
    ...overrides,
  };
}

/** Séjour « en cours » d'un ticket, de `start` à `end`. */
function activeSpan(issueId: string, start: string, end: string): StatusSpan[] {
  return [{ issueId, category: 'inprogress', startedAt: start, endedAt: end }];
}

/** Référence `type:taille` posée à la main dans la table `baseline`. */
function baseline(type: string, medianDays: number, sampleSize: number): Map<string, Baseline> {
  return new Map<string, Baseline>([
    [
      `${type}:m`,
      { issueType: type, sizeClass: 'm', medianDays, sampleSize, computedAt: NOW },
    ],
  ]);
}

/** Contexte de calcul, réglages par défaut sauf surcharge. */
function makeCtx(
  baselines: Map<string, Baseline>,
  spansByIssue: Map<string, StatusSpan[]>,
  overrides: Record<string, number | boolean> = {},
): CostContext {
  return {
    settings: makeSettings('p1', 'ABC', overrides),
    now: NOW,
    baselines,
    spansByIssue,
  };
}

/** Contexte d'un ticket unique de 6 jours ouvrés actifs sur la zone `api`. */
function singleTicketCtx(baselines: Map<string, Baseline>, overrides: Record<string, number | boolean> = {}): CostContext {
  const spans = new Map<string, StatusSpan[]>([
    ['i1', activeSpan('i1', '2026-11-09T00:00:00.000Z', '2026-11-17T00:00:00.000Z')],
  ]);
  return makeCtx(baselines, spans, overrides);
}

test('c3 : référence trop courte → preuve « données insuffisantes » à coût nul', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 4));
  const evidence = c3Slowness([makeFact()], ctx);

  assert.equal(evidence.length, 1);
  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.insufficient, true);
  assert.equal(only.costJp, 0);
  assert.equal(only.family, 'C3');
  assert.equal(only.detail.inputs.echantillon, 4);
  assert.equal(only.detail.inputs.reference, 2);
  assert.match(only.detail.formula, /insuffisantes/);
  assert.match(only.detail.formula, /moins de 5 tickets/);
});

test('c3 : référence absente → preuve insuffisante, échantillon nul', () => {
  const ctx = singleTicketCtx(new Map<string, Baseline>());
  const evidence = c3Slowness([makeFact()], ctx);

  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.insufficient, true);
  assert.equal(only.costJp, 0);
  assert.equal(only.detail.inputs.reference, null);
  assert.equal(only.detail.inputs.echantillon, 0);
});

test('c3 : surcoût nul quand le ticket est plus rapide que la référence', () => {
  const ctx = singleTicketCtx(baseline('Story', 10, 10));
  const evidence = c3Slowness([makeFact()], ctx);

  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.costJp, 0);
  assert.notEqual(only.insufficient, true);
  assert.equal(only.detail.durationDays, 6);
  assert.match(only.detail.formula, /^max\(0, 6 − 10\) × 0\.5 = 0 j-p/);
});

test('c3 : coefficient d’occupation 0,5 appliqué au surcoût', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  const evidence = c3Slowness([makeFact()], ctx);

  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.detail.durationDays, 6);
  assert.equal(only.costJp, 2);
  assert.equal(only.detail.inputs.coefficient, 0.5);
  assert.equal(only.detail.inputs.centile, 95);
  assert.match(only.detail.formula, /raboté au 95e centile/);
});

test('c3 : le coefficient du projet est respecté', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10), { occupationCoefficient: 0.25 });
  const evidence = c3Slowness([makeFact()], ctx);

  assert.equal(evidence[0]?.costJp, 1);
});

test('c3 : coût partagé à parts égales entre plusieurs zones', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  const evidence = c3Slowness([makeFact({ components: ['api', 'db'] })], ctx);

  assert.equal(evidence.length, 2);
  assert.deepEqual(
    evidence.map((item) => item.id).sort(),
    ['C3:i1:api', 'C3:i1:db'],
  );
  for (const item of evidence) assert.equal(item.costJp, 1);
});

test('c3 : une preuve par zone, identifiant ticket + zone', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  const evidence = c3Slowness([makeFact()], ctx);

  assert.equal(evidence.length, 1);
  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.id, 'C3:i1:api');
  assert.equal(only.zone, 'api');
  assert.equal(only.sourceIssueId, 'i1');
  assert.equal(only.sourceKey, 'ABC-1');
  assert.equal(only.occurredAt, '2026-11-13T00:00:00.000Z');
  assert.equal(only.method, 'computed');
  assert.equal(only.detail.inputs.duree, 6);
});

test('c3 : bugs et incidents exclus', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  const facts = [
    makeFact({ issueId: 'bug', isBug: true }),
    makeFact({ issueId: 'inc', isIncident: true }),
  ];

  assert.deepEqual(c3Slowness(facts, ctx), []);
});

test('c3 : tickets non terminés ou hors fenêtre exclus', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  const facts = [
    makeFact({ issueId: 'open', resolvedAt: null }),
    makeFact({ issueId: 'old', resolvedAt: '2026-01-05T00:00:00.000Z' }),
    makeFact({ issueId: 'future', resolvedAt: '2026-12-15T00:00:00.000Z' }),
  ];

  assert.deepEqual(c3Slowness(facts, ctx), []);
});

test('c3 : rabotage du lot au 95e centile, l’aberration est ramenée au seuil', () => {
  const facts: IssueFact[] = [];
  const spansByIssue = new Map<string, StatusSpan[]>();
  for (let index = 0; index < 20; index += 1) {
    const id = `n${index}`;
    facts.push(makeFact({ issueId: id, key: `ABC-${index}`, resolvedAt: '2026-10-21T00:00:00.000Z' }));
    spansByIssue.set(id, activeSpan(id, '2026-10-05T00:00:00.000Z', '2026-10-21T00:00:00.000Z'));
  }
  facts.push(makeFact({ issueId: 'outlier', key: 'ABC-99', resolvedAt: '2026-11-02T00:00:00.000Z' }));
  spansByIssue.set('outlier', activeSpan('outlier', '2026-09-07T00:00:00.000Z', '2026-11-02T00:00:00.000Z'));

  const evidence = c3Slowness(facts, makeCtx(baseline('Story', 2, 10), spansByIssue));
  assert.equal(evidence.length, 21);

  const outlier = evidence.find((item) => item.sourceIssueId === 'outlier');
  assert.ok(outlier);
  assert.equal(outlier.detail.durationDays, 40);
  assert.equal(outlier.costJp, 5);
  for (const item of evidence) assert.equal(item.costJp, 5);
});

test('c3 : sans historique, le coût est marqué « approximé »', () => {
  const fact = makeFact({ createdAt: '2026-11-09T00:00:00.000Z', resolvedAt: '2026-11-17T00:00:00.000Z' });
  const evidence = c3Slowness([fact], makeCtx(baseline('Story', 2, 10), new Map()));

  const only = evidence[0];
  assert.ok(only);
  assert.equal(only.method, 'approximated');
  assert.equal(only.detail.method, 'approximated');
  assert.equal(only.detail.durationDays, 6);
  assert.equal(only.costJp, 2);
});

test('c3 : calcul déterministe, deux appels rendent le même résultat', () => {
  const facts = [makeFact(), makeFact({ issueId: 'i2', components: ['web'] })];
  const spansByIssue = new Map<string, StatusSpan[]>([
    ['i1', activeSpan('i1', '2026-11-09T00:00:00.000Z', '2026-11-17T00:00:00.000Z')],
    ['i2', activeSpan('i2', '2026-11-09T00:00:00.000Z', '2026-11-13T00:00:00.000Z')],
  ]);
  const ctx = makeCtx(baseline('Story', 2, 10), spansByIssue);

  assert.deepEqual(c3Slowness(facts, ctx), c3Slowness(facts, ctx));
});

test('c3 : lot vide rend un tableau vide', () => {
  const ctx = singleTicketCtx(baseline('Story', 2, 10));
  assert.deepEqual(c3Slowness([], ctx), []);
});
