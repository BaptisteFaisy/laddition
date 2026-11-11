import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findPhantomDebt, PHANTOM_TOP_EVIDENCE } from './phantom.ts';
import { makeSettings } from './settings.ts';
import type { Evidence, IssueFact, ProjectSettings, ZoneCost } from './types.ts';

const SETTINGS: ProjectSettings = makeSettings('p1', 'PA');

/** Coût de zone minimal : seule l'addition facturée nous intéresse ici. */
function zoneCost(zone: string, totalJp: number): ZoneCost {
  return {
    zone,
    projectKey: 'PA',
    totalJp,
    byFamily: { C1: 0, C2: totalJp, C3: 0, C4: 0, C5: 0 },
    weeklyJp: [],
    unclassifiedShare: 0,
  };
}

/** Preuve rattachée à une zone, famille C2 par défaut. */
function evidence(id: string, zone: string, costJp: number): Evidence {
  return {
    id,
    zone,
    family: 'C2',
    sourceIssueId: `src-${id}`,
    sourceKey: 'PA-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    costJp,
    method: 'computed',
    visible: true,
    detail: {
      durationDays: costJp,
      method: 'computed',
      formula: 'test',
      inputs: {},
      familyLabel: 'Bugs',
    },
  };
}

/** Ticket de dette rattaché à une zone par son composant. */
function debtTicket(issueId: string, zone: string): IssueFact {
  return {
    issueId,
    key: `PA-${issueId}`,
    projectId: 'p1',
    projectKey: 'PA',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: true,
    zones: [zone],
    createdAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: [zone],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: `Dette ${issueId}`,
  };
}

test('zone à 12 j-p sans ticket de dette → dette fantôme', () => {
  const found = findPhantomDebt([zoneCost('api', 12)], [], [evidence('e1', 'api', 12)], SETTINGS);

  assert.equal(found.length, 1);
  const phantom = found[0];
  assert.ok(phantom);
  assert.equal(phantom.zone, 'api');
  assert.equal(phantom.totalJp, 12);
  assert.deepEqual(phantom.topEvidenceIds, ['e1']);
  assert.equal(phantom.byFamily.C2, 12);
});

test('zone avec un ticket de dette → exclue', () => {
  const found = findPhantomDebt(
    [zoneCost('api', 30)],
    [debtTicket('d1', 'api')],
    [evidence('e1', 'api', 30)],
    SETTINGS,
  );

  assert.deepEqual(found, []);
});

test('seuil de 10 j-p respecté à la borne', () => {
  const settings = makeSettings('p1', 'PA', { phantomThresholdJp: 10 });
  const found = findPhantomDebt(
    [zoneCost('pile', 9.99), zoneCost('seuil', 10), zoneCost('au-dessus', 10.01)],
    [],
    [],
    settings,
  );

  assert.deepEqual(
    found.map((item) => item.zone),
    ['au-dessus', 'seuil'],
  );
});

test('les 5 preuves les plus coûteuses, triées décroissantes', () => {
  const costs = [3, 9, 1, 7, 5, 11, 2];
  const zoneEvidence = costs.map((cost, index) => evidence(`e${index}`, 'api', cost));

  const found = findPhantomDebt([zoneCost('api', 38)], [], zoneEvidence, SETTINGS);

  const phantom = found[0];
  assert.ok(phantom);
  assert.equal(phantom.topEvidenceIds.length, PHANTOM_TOP_EVIDENCE);
  assert.deepEqual(phantom.topEvidenceIds, ['e5', 'e1', 'e3', 'e4', 'e0']);
});

test('tri de sortie : coût décroissant puis zone alphabétique', () => {
  const found = findPhantomDebt(
    [zoneCost('zêta', 20), zoneCost('alpha', 20), zoneCost('beta', 40)],
    [],
    [],
    SETTINGS,
  );

  assert.deepEqual(
    found.map((item) => item.zone),
    ['beta', 'alpha', 'zêta'],
  );
});

test('les preuves masquées pour ce lecteur ne sont pas citées', () => {
  const hidden = { ...evidence('secret', 'api', 50), visible: false };
  const found = findPhantomDebt(
    [zoneCost('api', 12)],
    [],
    [hidden, evidence('public', 'api', 2)],
    SETTINGS,
  );

  const phantom = found[0];
  assert.ok(phantom);
  assert.deepEqual(phantom.topEvidenceIds, ['public']);
});

test('un ticket de dette sur une autre zone ne couvre pas la zone', () => {
  const found = findPhantomDebt(
    [zoneCost('api', 25)],
    [debtTicket('d1', 'front')],
    [],
    SETTINGS,
  );

  assert.equal(found.length, 1);
});
