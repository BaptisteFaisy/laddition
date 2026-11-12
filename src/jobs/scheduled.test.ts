import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectSettings } from '../core/types';
import type { NightlyPorts, RepaymentRunPorts } from './scheduled';
import type { RepaymentOutcome } from './repayments';
import { stubForgeRuntime } from './testForge';
import { makeSettings } from './testFixtures';

// `scheduled` charge le recalcul, qui importe le scoreur LLM : double installé
// avant l'import (aucun test n'appelle Forge).
stubForgeRuntime();
const { nightlyRecalc, publishRepayments } = await import('./scheduled');

/**
 * C34 — la nuit ne calcule plus tout en série dans un seul `scheduledTrigger`.
 * B16 — un projet de démonstration n'est ni recalculé, ni écrit dans Jira.
 */

function nightlyPorts(options: {
  projects?: string[];
  settings?: (projectId: string) => ProjectSettings | null;
  failOn?: string[];
}) {
  const enqueued: string[] = [];
  const ports: NightlyPorts = {
    ensureReady: async () => undefined,
    listProjects: async () => options.projects ?? ['p1', 'p2'],
    settingsOf: async (projectId) =>
      options.settings ? options.settings(projectId) : makeSettings(projectId, 'PAY'),
    enqueue: async (projectId) => {
      if ((options.failOn ?? []).includes(projectId)) throw new Error('file indisponible');
      enqueued.push(projectId);
    },
  };
  return { ports, enqueued };
}

test('C34 — un message de file par projet', async () => {
  const { ports, enqueued } = nightlyPorts({ projects: ['p1', 'p2', 'p3'] });
  const result = await nightlyRecalc(ports);
  assert.deepEqual(enqueued, ['p1', 'p2', 'p3']);
  assert.equal(result.queued, 3);
  assert.equal(result.ok, true);
  assert.equal(result.projects.every((item) => item.queued), true);
});

test('B16 — un projet `demoData` n’est pas mis en file', async () => {
  const { ports, enqueued } = nightlyPorts({
    projects: ['demo', 'reel'],
    settings: (projectId) => makeSettings(projectId, 'PAY', { demoData: projectId === 'demo' }),
  });
  const result = await nightlyRecalc(ports);
  assert.deepEqual(enqueued, ['reel']);
  assert.equal(result.queued, 1);
  const demo = result.projects.find((item) => item.projectId === 'demo');
  assert.equal(demo?.skipped, 'demo-data');
  assert.equal(demo?.error, undefined, 'écarter le jeu d’exemple n’est pas une erreur');
});

test('un projet sans réglages est signalé, pas ignoré', async () => {
  const { ports, enqueued } = nightlyPorts({ projects: ['p9'], settings: () => null });
  const result = await nightlyRecalc(ports);
  assert.deepEqual(enqueued, []);
  assert.equal(result.ok, false);
  assert.match(result.projects[0]?.error ?? '', /sans réglages/);
});

test('un échec de file sur un projet n’empêche pas les autres', async () => {
  const { ports, enqueued } = nightlyPorts({ projects: ['p1', 'p2'], failOn: ['p1'] });
  const result = await nightlyRecalc(ports);
  assert.deepEqual(enqueued, ['p2']);
  assert.equal(result.ok, false);
  assert.match(result.projects[0]?.error ?? '', /file indisponible/);
});

function repaymentPorts(options: {
  projects?: string[];
  settings?: (projectId: string) => ProjectSettings | null;
  outcome?: RepaymentOutcome;
}) {
  const published: string[] = [];
  const ports: RepaymentRunPorts = {
    ensureReady: async () => undefined,
    listProjects: async () => options.projects ?? ['p1'],
    settingsOf: async (projectId) =>
      options.settings ? options.settings(projectId) : makeSettings(projectId, 'PAY'),
    publish: async (projectId) => {
      published.push(projectId);
      return options.outcome ?? { projectId, published: 1, removed: 0, groups: 1 };
    },
  };
  return { ports, published };
}

test('B16 — aucun bulletin n’est publié pour le jeu d’exemple', async () => {
  const { ports, published } = repaymentPorts({
    projects: ['demo', 'reel'],
    settings: (projectId) => makeSettings(projectId, 'PAY', { demoData: projectId === 'demo' }),
  });
  const result = await publishRepayments(ports);
  assert.deepEqual(published, ['reel'], 'rien n’est écrit sur les tickets du jeu d’exemple');
  const demo = result.projects.find((item) => item.projectId === 'demo');
  assert.equal(demo?.skipped, 'demo-data');
  assert.equal(result.ok, true);
});

test('le bilan des bulletins remonte les retraits et les groupes (§19)', async () => {
  const { ports } = repaymentPorts({
    projects: ['p1'],
    outcome: { projectId: 'p1', published: 2, removed: 1, groups: 1 },
  });
  const result = await publishRepayments(ports);
  assert.equal(result.projects[0]?.published, 2);
  assert.equal(result.projects[0]?.removed, 1);
  assert.equal(result.projects[0]?.groups, 1);
});

test('l’échec d’un projet est un bilan, jamais une exception', async () => {
  const { ports } = repaymentPorts({ projects: ['p1'], settings: () => null });
  const result = await publishRepayments(ports);
  assert.equal(result.ok, false);
  assert.match(result.projects[0]?.error ?? '', /sans réglages/);
});
