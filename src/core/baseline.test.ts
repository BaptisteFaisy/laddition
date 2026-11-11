import test from 'node:test';
import assert from 'node:assert/strict';
import type { IssueFact, StatusSpan } from './types.ts';
import { makeSettings } from './settings.ts';
import {
  baselineKey,
  clipToPercentile,
  computeBaselines,
  median,
  sizeClassOf,
  ticketDurationDays,
} from './baseline.ts';

const NOW = '2026-11-30T00:00:00.000Z';
const SETTINGS = makeSettings('p1', 'ABC');

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

/** Série de valeurs 1..n, pour les tests de centile. */
function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

test('median : série paire, moyenne des deux valeurs du milieu', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('median : série impaire, valeur centrale', () => {
  assert.equal(median([5, 1, 3]), 3);
});

test('median : série vide vaut 0, sans jeter', () => {
  assert.equal(median([]), 0);
});

test('median : ne modifie pas la série reçue', () => {
  const values = [9, 2, 7];
  median(values);
  assert.deepEqual(values, [9, 2, 7]);
});

test('clipToPercentile : rabote au 95e centile', () => {
  const clipped = clipToPercentile(range(20), 95);
  assert.equal(clipped.length, 20);
  assert.equal(clipped[18], 19);
  assert.equal(clipped[19], 19);
  assert.equal(clipped[0], 1);
});

test('clipToPercentile : conserve l’ordre et ne touche pas l’entrée', () => {
  const values = [100, 1, 2];
  assert.deepEqual(clipToPercentile(values, 50), [2, 1, 2]);
  assert.deepEqual(values, [100, 1, 2]);
});

test('clipToPercentile : série vide rend une série vide', () => {
  assert.deepEqual(clipToPercentile([], 95), []);
});

test('clipToPercentile : 95 par défaut', () => {
  assert.deepEqual(clipToPercentile(range(20)), clipToPercentile(range(20), 95));
});

test('sizeClassOf : la taille fournie par Jira est retenue telle quelle', () => {
  assert.equal(sizeClassOf(makeFact({ size: 'xl' }), SETTINGS), 'xl');
  assert.equal(sizeClassOf(makeFact({ size: 's' }), SETTINGS), 's');
});

test('sizeClassOf : sans taille ni temps saisi, la taille reste inconnue', () => {
  assert.equal(sizeClassOf(makeFact({ size: 'unknown', loggedSeconds: null }), SETTINGS), 'unknown');
});

test('sizeClassOf : taille déduite du temps saisi', () => {
  const small = makeFact({ size: 'unknown', loggedSeconds: 3600 * 3.5 });
  const medium = makeFact({ size: 'unknown', loggedSeconds: 3600 * 14 });
  const large = makeFact({ size: 'unknown', loggedSeconds: 3600 * 35 });
  assert.equal(sizeClassOf(small, SETTINGS), 's');
  assert.equal(sizeClassOf(medium, SETTINGS), 'm');
  assert.equal(sizeClassOf(large, SETTINGS), 'l');
});

test('baselineKey : type et taille joints par deux-points', () => {
  assert.equal(baselineKey('Bug', 'm'), 'Bug:m');
});

test('ticketDurationDays : jours ouvrés en statuts actifs', () => {
  const fact = makeFact();
  const spans = activeSpan('i1', '2026-11-09T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
  assert.deepEqual(ticketDurationDays(fact, spans), { days: 4, approximated: false });
});

test('ticketDurationDays : repli sur la durée création → résolution sans historique', () => {
  assert.deepEqual(ticketDurationDays(makeFact(), undefined), { days: 4, approximated: true });
});

test('computeBaselines : médiane et effectif par couple type:taille', () => {
  const facts = [
    makeFact({ issueId: 'a', components: ['api'] }),
    makeFact({ issueId: 'b', components: ['api'] }),
    makeFact({ issueId: 'c', components: ['api'] }),
  ];
  const spansByIssue = new Map<string, StatusSpan[]>([
    ['a', activeSpan('a', '2026-11-09T00:00:00.000Z', '2026-11-13T00:00:00.000Z')],
    ['b', activeSpan('b', '2026-11-09T00:00:00.000Z', '2026-11-17T00:00:00.000Z')],
    ['c', activeSpan('c', '2026-11-09T00:00:00.000Z', '2026-11-19T00:00:00.000Z')],
  ]);

  const baselines = computeBaselines(facts, spansByIssue, SETTINGS, NOW);
  const baseline = baselines.get('Story:m');
  assert.ok(baseline);
  assert.equal(baseline.medianDays, 6);
  assert.equal(baseline.sampleSize, 3);
  assert.equal(baseline.issueType, 'Story');
  assert.equal(baseline.sizeClass, 'm');
  assert.equal(baseline.computedAt, NOW);
});

test('computeBaselines : les zones étudiées sont exclues de la référence', () => {
  const facts = [
    makeFact({ issueId: 'a', components: ['api'] }),
    makeFact({ issueId: 'b', components: ['api'] }),
    makeFact({ issueId: 'c', components: ['web'] }),
  ];
  const spansByIssue = new Map<string, StatusSpan[]>([
    ['a', activeSpan('a', '2026-11-09T00:00:00.000Z', '2026-11-13T00:00:00.000Z')],
    ['b', activeSpan('b', '2026-11-09T00:00:00.000Z', '2026-11-17T00:00:00.000Z')],
    ['c', activeSpan('c', '2026-11-09T00:00:00.000Z', '2026-11-19T00:00:00.000Z')],
  ]);

  const included = computeBaselines(facts, spansByIssue, SETTINGS, NOW);
  assert.equal(included.get('Story:m')?.sampleSize, 3);

  const excluded = computeBaselines(facts, spansByIssue, SETTINGS, NOW, ['api']);
  assert.equal(excluded.get('Story:m')?.sampleSize, 1);
  assert.equal(excluded.get('Story:m')?.medianDays, 8);
});

test('computeBaselines : sépare les couples type:taille', () => {
  const facts = [
    makeFact({ issueId: 'a', type: 'Story', size: 'm' }),
    makeFact({ issueId: 'b', type: 'Story', size: 'l' }),
  ];
  const baselines = computeBaselines(facts, new Map(), SETTINGS, NOW);
  assert.deepEqual(Array.from(baselines.keys()).sort(), ['Story:l', 'Story:m']);
  assert.equal(baselines.get('Story:m')?.medianDays, 4);
});

test('computeBaselines : aucune donnée rend une table vide', () => {
  assert.equal(computeBaselines([], new Map(), SETTINGS, NOW).size, 0);
});
