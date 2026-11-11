import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findDeadDebt } from './dead';
import { makeSettings } from './settings';
import { addDays } from './time';
import type { Attribution, Evidence, IssueFact, ProjectSettings } from './types';

const NOW = '2026-11-11T00:00:00.000Z';
const SETTINGS: ProjectSettings = makeSettings('p1', 'PA');

/** Preuve datée, rattachable à un ticket de dette par une attribution. */
function evidence(id: string, occurredAt: string): Evidence {
  return {
    id,
    zone: 'api',
    family: 'C2',
    sourceIssueId: `src-${id}`,
    sourceKey: 'PA-1',
    occurredAt,
    costJp: 2,
    method: 'computed',
    visible: true,
    detail: {
      durationDays: 2,
      method: 'computed',
      formula: 'test',
      inputs: {},
      familyLabel: 'Bugs',
    },
  };
}

/** Ticket de dette créé à une date donnée. */
function debtTicket(issueId: string, createdAt: string, isDebt = true): IssueFact {
  return {
    issueId,
    key: `PA-${issueId}`,
    projectId: 'p1',
    projectKey: 'PA',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt,
    zones: ['api'],
    createdAt,
    resolvedAt: null,
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
    summary: `Dette ${issueId}`,
  };
}

/** Part d'une preuve imputée à un ticket de dette. */
function attribution(evidenceId: string, debtIssueId: string, share = 1): Attribution {
  return { evidenceId, debtIssueId, share, basis: 'link', relevance: 1, rationale: 'test' };
}

test('dette sans preuve depuis 181 jours → morte, comptée depuis la création', () => {
  const createdAt = addDays(NOW, -181);
  const found = findDeadDebt([debtTicket('d1', createdAt)], [], [], SETTINGS, NOW);

  assert.equal(found.length, 1);
  const dead = found[0];
  assert.ok(dead);
  assert.equal(dead.daysWithoutEvidence, 181);
  assert.equal(dead.lastEvidenceAt, null);
  assert.equal(dead.zone, 'api');
  assert.equal(dead.key, 'PA-d1');
});

test('dette avec une preuve récente → vivante', () => {
  const createdAt = addDays(NOW, -400);
  const recent = addDays(NOW, -10);
  const found = findDeadDebt(
    [debtTicket('d1', createdAt)],
    [evidence('e1', recent)],
    [attribution('e1', 'd1')],
    SETTINGS,
    NOW,
  );

  assert.deepEqual(found, []);
});

test('dette dont la dernière preuve date de 200 jours → morte', () => {
  const old = addDays(NOW, -200);
  const found = findDeadDebt(
    [debtTicket('d1', addDays(NOW, -500))],
    [evidence('e1', old), evidence('e2', addDays(NOW, -300))],
    [attribution('e1', 'd1'), attribution('e2', 'd1')],
    SETTINGS,
    NOW,
  );

  assert.equal(found.length, 1);
  const dead = found[0];
  assert.ok(dead);
  assert.equal(dead.lastEvidenceAt, old);
  assert.equal(dead.daysWithoutEvidence, 200);
});

test('seuil de 180 jours respecté à la borne : 180 reste vivante', () => {
  const found = findDeadDebt(
    [debtTicket('pile', addDays(NOW, -180)), debtTicket('juste', addDays(NOW, -180.5))],
    [],
    [],
    SETTINGS,
    NOW,
  );

  assert.deepEqual(
    found.map((item) => item.key),
    ['PA-juste'],
  );
});

test('un ticket qui n’est pas de dette est ignoré', () => {
  const found = findDeadDebt(
    [debtTicket('bug', addDays(NOW, -400), false)],
    [],
    [],
    SETTINGS,
    NOW,
  );

  assert.deepEqual(found, []);
});

test('une attribution de part nulle ne compte pas comme preuve', () => {
  const found = findDeadDebt(
    [debtTicket('d1', addDays(NOW, -400))],
    [evidence('e1', addDays(NOW, -1))],
    [attribution('e1', 'd1', 0)],
    SETTINGS,
    NOW,
  );

  assert.equal(found.length, 1);
  assert.equal(found[0]?.lastEvidenceAt, null);
});

test('tri : jours sans preuve décroissant', () => {
  const found = findDeadDebt(
    [
      debtTicket('jeune', addDays(NOW, -200)),
      debtTicket('ancien', addDays(NOW, -400)),
      debtTicket('moyen', addDays(NOW, -300)),
    ],
    [],
    [],
    SETTINGS,
    NOW,
  );

  assert.deepEqual(
    found.map((item) => item.key),
    ['PA-ancien', 'PA-moyen', 'PA-jeune'],
  );
});
