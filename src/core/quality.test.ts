import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuality } from './quality.ts';
import { makeSettings } from './settings.ts';
import type { CostMethod, Evidence, Family, IssueFact, ProjectSettings } from './types.ts';

const SETTINGS: ProjectSettings = makeSettings('p1', 'PA');

/** Ticket réduit : seules les sources de zone nous intéressent ici. */
function issueFact(issueId: string, components: string[]): IssueFact {
  return {
    issueId,
    key: `PA-${issueId}`,
    projectId: 'p1',
    projectKey: 'PA',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: components,
    createdAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components,
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: `Ticket ${issueId}`,
  };
}

/** Preuve paramétrable : famille, coût, méthode, zone, insuffisance. */
function evidence(
  id: string,
  zone: string,
  family: Family,
  costJp: number,
  method: CostMethod,
  insufficient = false,
): Evidence {
  return {
    id,
    zone,
    family,
    sourceIssueId: `src-${id}`,
    sourceKey: 'PA-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    costJp,
    method,
    insufficient,
    visible: true,
    detail: {
      durationDays: costJp,
      method,
      formula: 'test',
      inputs: {},
      familyLabel: family,
    },
  };
}

test('tickets sans zone et part non classée, en pourcentage', () => {
  const facts = [
    issueFact('a', ['api']),
    issueFact('b', ['front']),
    issueFact('c', []),
    issueFact('d', ['api']),
  ];

  const quality = computeQuality(facts, [], SETTINGS);

  assert.equal(quality.issuesTotal, 4);
  assert.equal(quality.issuesWithoutZone, 1);
  assert.equal(quality.unclassifiedShare, 25);
});

test('part du coût venue d’un temps saisi, C5 exclue du calcul', () => {
  const evidenceList = [
    evidence('e1', 'api', 'C2', 6, 'logged'),
    evidence('e2', 'api', 'C2', 4, 'computed'),
    evidence('e3', 'api', 'C5', 100, 'logged'),
  ];

  const quality = computeQuality([], evidenceList, SETTINGS);

  assert.equal(quality.loggedShare, 60);
});

test('familles insuffisantes : un couple zone × famille, sans doublon', () => {
  const evidenceList = [
    evidence('e1', 'api', 'C3', 0, 'computed', true),
    evidence('e2', 'api', 'C3', 0, 'computed', true),
    evidence('e3', 'front', 'C3', 0, 'computed', true),
    evidence('e4', 'api', 'C2', 3, 'computed'),
  ];

  const quality = computeQuality([], evidenceList, SETTINGS);

  assert.deepEqual(quality.insufficientFamilies, [
    { zone: 'api', family: 'C3' },
    { zone: 'front', family: 'C3' },
  ]);
});

test('preuves approximées comptées, parts à deux décimales', () => {
  const evidenceList = [
    evidence('e1', 'api', 'C2', 1, 'approximated'),
    evidence('e2', 'api', 'C2', 1, 'approximated'),
    evidence('e3', 'api', 'C2', 1, 'logged'),
  ];
  const facts = [issueFact('a', ['api']), issueFact('b', []), issueFact('c', [])];

  const quality = computeQuality(facts, evidenceList, SETTINGS);

  assert.equal(quality.approximatedIssues, 2);
  assert.equal(quality.unclassifiedShare, 66.67);
  assert.equal(quality.loggedShare, 33.33);
});

test('jeu vide : tout à zéro, jamais NaN', () => {
  const quality = computeQuality([], [], SETTINGS);

  assert.deepEqual(quality, {
    issuesTotal: 0,
    issuesWithoutZone: 0,
    unclassifiedShare: 0,
    insufficientFamilies: [],
    loggedShare: 0,
    approximatedIssues: 0,
  });
});
