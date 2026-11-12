import test from 'node:test';
import assert from 'node:assert/strict';

import type { IssueFact, ProjectSettings } from './types';
import { makeSettings } from './settings';
import {
  PROJECT_ZONE,
  UNCLASSIFIED_ZONE,
  detectZoneMode,
  isUnclassified,
  zoneOptionsOf,
  zonesForIssue,
} from './zones';

/** Ticket minimal, surchargé champ par champ. */
function fact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'i1',
    key: 'PA-1',
    projectId: 'p1',
    projectKey: 'PA',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    resolvedAt: '2026-10-01T00:00:00.000Z',
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: [],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'Ticket',
    ...overrides,
  };
}

function settings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return makeSettings('p1', 'PA', overrides);
}

test('projet qui décrit ses zones : rien à signaler', () => {
  const signal = detectZoneMode([fact({ components: ['api'] })], settings());

  assert.equal(signal.missingComponents, false);
  assert.equal(signal.recommendedMode, 'component');
  assert.equal(signal.warning, '');
  assert.deepEqual(zoneOptionsOf([fact({ components: ['api'] })], settings()), {});
});

test('§19 cas 1 — projet sans composants : le mode étiquette est recommandé', () => {
  const facts = [fact({ labels: ['zone:paiement'] }), fact({ labels: ['zone:reporting'] })];
  const signal = detectZoneMode(facts, settings());

  assert.equal(signal.missingComponents, true);
  assert.equal(signal.recommendedMode, 'label');
  assert.equal(signal.warning.length > 0, true, 'un constat sans avertissement est muet');
  assert.match(signal.warning, /étiquettes/);
});

test('§19 cas 1 — projet déjà en mode étiquette : l’avertissement reste affiché', () => {
  const signal = detectZoneMode([fact({ labels: ['paiement'] })], settings({ zoneMode: 'label' }));

  assert.equal(signal.missingComponents, true);
  assert.equal(signal.recommendedMode, 'label');
  assert.equal(signal.warning.length > 0, true);
});

test('§19 cas 1 — ni composants ni étiquettes : zone unique « projet » avec avertissement', () => {
  const facts = [fact(), fact({ issueId: 'i2' })];
  const signal = detectZoneMode(facts, settings());

  assert.equal(signal.missingComponents, true);
  assert.equal(signal.recommendedMode, 'project');
  assert.equal(signal.projectZone, PROJECT_ZONE);
  assert.match(signal.warning, /projet/);
  assert.equal(signal.warning.includes('non classé'), false, 'le repli ne doit pas être un seau muet');
});

test('§19 cas 1 — le repli « projet » n’est proposé que pour la zone unique', () => {
  const componentless = [fact({ labels: ['zone:paiement'] })];
  assert.deepEqual(zoneOptionsOf(componentless, settings()), {});
  assert.deepEqual(zoneOptionsOf([fact()], settings()), { fallbackZone: PROJECT_ZONE });
});

test('§19 cas 1 — zonesForIssue applique le repli demandé', () => {
  const zones = zonesForIssue(fact(), settings(), { fallbackZone: PROJECT_ZONE });

  assert.deepEqual(zones, [PROJECT_ZONE]);
  assert.equal(isUnclassified(zones), false);
});

test('§8 — sans repli demandé, le ticket sans zone reste un indicateur « non classé »', () => {
  const zones = zonesForIssue(fact(), settings());

  assert.deepEqual(zones, [UNCLASSIFIED_ZONE]);
  assert.equal(isUnclassified(zones), true);
});

test('§8 — un ticket rattaché garde sa zone, repli ou pas', () => {
  const options = { fallbackZone: PROJECT_ZONE };

  assert.deepEqual(zonesForIssue(fact({ components: ['api'] }), settings(), options), ['api']);
  assert.deepEqual(zonesForIssue(fact({ zones: ['web'] }), settings(), options), ['web']);
});
