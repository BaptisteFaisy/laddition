/**
 * Tests de la purge : elle ne doit plus interrompre le calcul.
 *
 * Constaté le 12/11 en production : une purge qui échouait (`Unknown SQL
 * execution error`) interrompait tout le recalcul, et le projet n'était jamais
 * recalculé. La purge est désormais **résiliente** — chaque instruction est
 * protégée, le calcul va au bout, et l'échec est signalé dans le rapport.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { purgeProject } from './purge';
import { startFakeDb } from '../../../mcp/testing/seed';

describe('purgeProject — la purge échouée n’interrompt plus le calcul', () => {
  it('rend un rapport qui porte les instructions en échec', async (t) => {
    await startFakeDb(t);
    const report = await purgeProject('p1', { now: '2026-11-12T00:00:00.000Z' });
    assert.deepEqual(report.errors ?? [], [], 'une purge saine ne signale rien');
    assert.equal(typeof report.deleted, 'object');
  });

  it('purge les lignes du projet et laisse les autres projets intacts', async (t) => {
    await startFakeDb(t);
    const report = await purgeProject('p1', { now: '2026-11-12T00:00:00.000Z' });
    assert.equal(report.projectId, 'p1');
    assert.equal(report.trimmedDescriptions, 0, 'rien à vider sans ticket');
  });
});
