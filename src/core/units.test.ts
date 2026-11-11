import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueFact } from './types';
import {
  POINTS_PER_CLOSED_ISSUE,
  hoursToJp,
  jpToEuros,
  pointsToDays,
  velocityFromClosedIssues,
} from './units';

function makeFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'i-1',
    key: 'ABC-1',
    projectId: 'p-1',
    projectKey: 'ABC',
    type: 'Tâche',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: ['paiement'],
    createdAt: '2026-01-05T09:00:00.000Z',
    resolvedAt: '2026-01-20T09:00:00.000Z',
    closedAt: '2026-01-20T09:00:00.000Z',
    size: 's',
    estimateJp: 1,
    loggedSeconds: null,
    labels: [],
    components: ['paiement'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'Ticket de test',
    ...overrides,
  };
}

/** `count` tickets fermés, identifiants distincts. */
function closedFacts(count: number): IssueFact[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeFact({ issueId: `i-${index}`, key: `ABC-${index}` }),
  );
}

test('points → jours : conversion au rythme de la vélocité', () => {
  assert.equal(pointsToDays(20, 10, 5), 10);
  assert.equal(pointsToDays(0, 10, 5), 0);
  assert.equal(pointsToDays(5, 3, 5), 8.33);
});

test('points → jours : null quand la vélocité est nulle ou illisible', () => {
  assert.equal(pointsToDays(10, 0, 5), null);
  assert.equal(pointsToDays(10, -2, 5), null);
  assert.equal(pointsToDays(10, 10, 0), null);
  assert.equal(pointsToDays(Number.NaN, 10, 5), null);
});

test('points → jours : points négatifs ramenés à zéro', () => {
  assert.equal(pointsToDays(-5, 10, 5), 0);
});

test('heures → j-p : journée de travail du projet', () => {
  assert.equal(hoursToJp(14, 7), 2);
  assert.equal(hoursToJp(3.5, 7), 0.5);
  assert.equal(hoursToJp(0.5, 7), 0.07);
});

test('heures → j-p : entrées inutilisables rendent 0, jamais NaN', () => {
  assert.equal(hoursToJp(14, 0), 0);
  assert.equal(hoursToJp(-2, 7), 0);
  assert.equal(hoursToJp(Number.NaN, 7), 0);
});

test('j-p → euros : taux journalier du projet', () => {
  assert.equal(jpToEuros(2, 500), 1000);
  assert.equal(jpToEuros(1.5, 600), 900);
  assert.equal(jpToEuros(0.333, 500), 166.5);
});

test('j-p → euros : null quand aucun taux n’est renseigné', () => {
  assert.equal(jpToEuros(2, undefined), null);
  assert.equal(jpToEuros(2, 0), null);
  assert.equal(jpToEuros(2, -100), null);
  assert.equal(jpToEuros(Number.NaN, 500), null);
});

test('vélocité : un ticket fermé vaut un point simulé', () => {
  assert.equal(POINTS_PER_CLOSED_ISSUE, 1);
  // 10 tickets sur 70 jours = 10 points / 10 semaines.
  assert.equal(velocityFromClosedIssues(closedFacts(10), 70, 5), 1);
  // 18 tickets sur 90 jours = 18 / 12,86 semaines.
  assert.equal(velocityFromClosedIssues(closedFacts(18), 90, 5), 1.4);
});

test('vélocité : seuls les tickets fermés comptent, une fois chacun', () => {
  const facts = [
    ...closedFacts(2),
    makeFact({ issueId: 'open-1', key: 'ABC-50', resolvedAt: null, closedAt: null }),
    makeFact({ issueId: 'i-0', key: 'ABC-0' }),
  ];

  // 2 identifiants fermés distincts, 1 doublon ignoré, 1 ticket ouvert ignoré.
  assert.equal(velocityFromClosedIssues(facts, 7, 5), 2);
});

test('vélocité : fenêtre ou calendrier invalide rend 0', () => {
  assert.equal(velocityFromClosedIssues(closedFacts(5), 0, 5), 0);
  assert.equal(velocityFromClosedIssues(closedFacts(5), -30, 5), 0);
  assert.equal(velocityFromClosedIssues(closedFacts(5), 30, 0), 0);
  assert.equal(velocityFromClosedIssues([], 90, 5), 0);
});
