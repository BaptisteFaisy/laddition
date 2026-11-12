import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueFact, ProjectSettings } from '../core/types';
import type { JiraIssueJson } from '../platform/jira-types';
import type { InvalidationKind } from './invalidation';
import type { TriggerPorts } from './triggers';
import { issueCommented, issueCreated, issueDeleted, issueUpdated, worklogChanged } from './triggers';
import { makeFact, makeSettings } from './testFixtures';

/**
 * B21, B22, B23, B24 — les événements qui manquaient.
 *
 * Le temps saisi et les intervenants nourrissent C1 et C2 (§9) : un worklog ou
 * un commentaire change donc l'addition, et doit marquer la zone. Un ticket
 * supprimé doit sortir de la base, sinon il reste classé. Un ticket déplacé
 * vers un projet sans réglages doit échouer **en le disant**. Un composant
 * renommé doit invalider l'ancienne zone (B24).
 */

const SETTINGS: ProjectSettings = makeSettings('p1', 'PAY');

function issueJson(id: string, key: string, projectId = 'p1'): JiraIssueJson {
  return { id, key, fields: { project: { id: projectId, key: 'PAY' }, summary: 'ticket' } };
}

/** Double des ports : tout est en mémoire, rien n'appelle Forge ni Jira. */
function fakePorts(options: {
  issue?: JiraIssueJson | null;
  settings?: ProjectSettings | null;
  previous?: IssueFact | null;
  stored?: IssueFact;
}) {
  const marks: Array<{ projectId: string; kind: InvalidationKind; targets: string[] }> = [];
  const deleted: string[] = [];
  const dropped: string[] = [];
  const enqueued: string[] = [];
  const logs: string[] = [];
  const ports: TriggerPorts = {
    ensureReady: async () => undefined,
    fetchIssue: async () => options.issue ?? null,
    storeIssue: async () => options.stored ?? makeFact(),
    getIssueFact: async () => options.previous ?? null,
    settingsOf: async () => (options.settings === undefined ? SETTINGS : options.settings),
    markInvalid: async (projectId, kind, targets) => {
      marks.push({ projectId, kind, targets });
    },
    dropInvalidTarget: async (_projectId, target) => {
      dropped.push(target);
    },
    deleteIssue: async (issueId) => {
      deleted.push(issueId);
    },
    enqueueRecalc: async (projectId) => {
      enqueued.push(projectId);
    },
    log: (message) => logs.push(message),
  };
  return { ports, marks, deleted, dropped, enqueued, logs };
}

const WORKLOG_EVENT = { body: { issue: { id: 'i1', key: 'PAY-1' }, worklog: { id: 'w1' } } };
const COMMENT_EVENT = { body: { issue: { id: 'i1', key: 'PAY-1' }, comment: { id: 'c1' } } };

test('B21 — un temps saisi marque la zone et remet le projet en file', async () => {
  const stored = makeFact({ issueId: 'i1', zones: ['facturation'] });
  const { ports, marks, enqueued } = fakePorts({ issue: issueJson('i1', 'PAY-1'), stored });
  const result = await worklogChanged(WORKLOG_EVENT, ports);
  assert.equal(result.ok, true);
  assert.equal(result.issueId, 'i1');
  assert.deepEqual(marks[0]?.targets, ['facturation']);
  assert.equal(marks[0]?.kind, 'zone');
  assert.deepEqual(enqueued, ['p1'], 'les chiffres changent : le recalcul n’attend pas la nuit');
});

test('B22 — un commentaire ajoute un intervenant : zone marquée et projet en file', async () => {
  const stored = makeFact({ issueId: 'i1', zones: ['facturation'], participants: 2 });
  const { ports, marks, enqueued } = fakePorts({ issue: issueJson('i1', 'PAY-1'), stored });
  const result = await issueCommented(COMMENT_EVENT, ports);
  assert.equal(result.ok, true);
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0]?.targets, ['facturation']);
  assert.deepEqual(enqueued, ['p1'], 'C1 change : le recalcul n’attend pas la nuit');
});

test('B23 — un ticket supprimé sort de la base, marques comprises', async () => {
  const previous = makeFact({ issueId: 'i1', zones: ['facturation'] });
  const { ports, deleted, dropped, marks } = fakePorts({ previous });
  const result = await issueDeleted({ body: { issue: { id: 'i1', key: 'PAY-1' } } }, ports);
  assert.equal(result.ok, true);
  assert.deepEqual(deleted, ['i1']);
  assert.deepEqual(dropped, ['i1']);
  assert.deepEqual(marks[0]?.targets, ['facturation'], 'la zone perd un ticket : elle est à recalculer');
});

test('B23 — un projet sans réglages lève pour être rejoué, pas un échec muet', async () => {
  const { ports, marks, logs } = fakePorts({ issue: issueJson('i1', 'PAY-1', 'p2'), settings: null });
  await assert.rejects(
    issueCreated({ body: { issue: { id: 'i1', key: 'PAY-1' } } }, ports),
    /projet p2 sans réglages/,
  );
  assert.deepEqual(marks, [], 'ticket inconnu : rien à détacher');
  assert.equal(logs.length, 1, 'l’échec est journalisé');
});

test('B23 — un ticket déplacé vers un projet sans réglages quitte l’ancien projet', async () => {
  const previous = makeFact({ issueId: 'i1', projectId: 'p1', zones: ['facturation'] });
  const { ports, deleted, dropped, marks, enqueued, logs } = fakePorts({
    issue: issueJson('i1', 'PAY-1', 'p2'),
    settings: null,
    previous,
  });
  await assert.rejects(
    issueCreated({ body: { issue: { id: 'i1', key: 'PAY-1' } } }, ports),
    /projet p2 sans réglages/,
  );
  assert.deepEqual(deleted, ['i1'], 'l’ancien projet perd le fait, ses preuves et son addition');
  assert.deepEqual(dropped, ['i1'], 'et la marque qui l’attendait');
  assert.deepEqual(marks[0]?.targets, ['facturation'], 'les zones de l’ancien projet bougent');
  assert.deepEqual(enqueued, ['p1'], 'l’ancien projet est remis en file pour recalcul');
  assert.equal(logs.length, 1, 'l’échec est journalisé');
});

test('B24 — une zone qui disparaît du ticket est marquée à recalculer', async () => {
  const previous = makeFact({ issueId: 'i1', zones: ['ancienne', 'facturation'] });
  const stored = makeFact({ issueId: 'i1', zones: ['facturation'] });
  const { ports, marks } = fakePorts({ issue: issueJson('i1', 'PAY-1'), previous, stored });
  await issueCreated({ body: { issue: { id: 'i1', key: 'PAY-1' } } }, ports);
  const marked = marks.flatMap((mark) => mark.targets);
  assert.ok(marked.includes('facturation'), 'la zone actuelle est marquée');
  assert.ok(marked.includes('ancienne'), 'l’ancienne zone est marquée elle aussi');
});

test('un événement sans ticket ne devine rien', async () => {
  const { ports } = fakePorts({});
  const result = await issueCreated({ body: {} }, ports);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /sans ticket/);
});

test('B23 — un ticket déplacé marque aussi l’ancien projet', async () => {
  const previous = makeFact({ issueId: 'i1', projectId: 'p1', zones: ['facturation'] });
  const stored = makeFact({ issueId: 'i1', projectId: 'p2', zones: ['taxes'] });
  const { ports, marks } = fakePorts({ issue: issueJson('i1', 'PAY-1', 'p2'), previous, stored });
  const result = await issueUpdated({ body: { issue: { id: 'i1', key: 'PAY-1' } } }, ports);
  assert.equal(result.ok, true);
  const byProject = marks.map((mark) => mark.projectId);
  assert.ok(byProject.includes('p2'), 'le nouveau projet est marqué');
  assert.ok(byProject.includes('p1'), 'l’ancien projet perd un ticket : il est marqué');
  const old = marks.find((mark) => mark.projectId === 'p1');
  assert.deepEqual(old?.targets, ['facturation']);
});

test('un ticket illisible chez Jira est signalé, pas ignoré', async () => {
  const { ports } = fakePorts({ issue: null });
  const result = await worklogChanged(WORKLOG_EVENT, ports);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /illisible/);
});
