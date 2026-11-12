import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startFakeDb } from '../mcp/testing/seed';
import { listAttributions, replaceAttributions } from '../platform/db/index';
import { attribution } from '../platform/db/testFixtures';
import { createDeadline, NO_DEADLINE } from './deadline';
import { markInvalid } from './invalidation';
import { stubForgeRuntime } from './testForge';
import { makeFact, makeSettings } from './testFixtures';

// `recalc` importe le scoreur LLM, qui exige le runtime Forge : double installé
// avant l'import (aucun test n'appelle le modèle).
stubForgeRuntime();
const { carryBeyondAttributions, consumeMarks, mergeFacts, skipReason, splitByLinkCap } =
  await import('./recalc');

/**
 * B16 — le jeu d'exemple n'est jamais recalculé ni écrit dans Jira.
 * A6  — une dette ouverte il y a un an a une addition (§7.1).
 * C34 — un recalcul trop long rend la main au lieu d'être tué.
 */

test('B16 — un projet marqué `demoData` est écarté du calcul', () => {
  assert.equal(skipReason(makeSettings('p1', 'PAY', { demoData: true })), 'demo-data');
  assert.equal(skipReason(makeSettings('p1', 'PAY', { demoData: false })), null);
});

test('A6 — les tickets de dette hors fenêtre entrent dans le calcul', () => {
  const inWindow = makeFact({ issueId: 'i1', key: 'PAY-1', createdAt: '2026-03-01T09:00:00.000Z' });
  const oldDebt = makeFact({
    issueId: 'i2',
    key: 'PAY-2',
    isDebt: true,
    createdAt: '2025-03-01T09:00:00.000Z',
  });
  const merged = mergeFacts([inWindow], [oldDebt, inWindow]);
  assert.deepEqual(merged.map((fact) => fact.issueId), ['i2', 'i1'], 'du plus ancien au plus récent');
  assert.equal(merged.length, 2, 'un ticket présent dans les deux listes n’est pas compté deux fois');
});

test('A6 — la fusion garde la version la plus complète (celle de la fenêtre)', () => {
  const fromWindow = makeFact({ issueId: 'i1', summary: 'avec description' });
  const fromDebts = makeFact({ issueId: 'i1', summary: 'sans description' });
  const merged = mergeFacts([fromWindow], [fromDebts]);
  assert.equal(merged[0]?.summary, 'avec description');
});

test('C34 — la garde de durée expire après le budget', () => {
  let clock = 1_000;
  const deadline = createDeadline(500, () => clock);
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.remaining(), 500);
  clock = 1_400;
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.remaining(), 100);
  clock = 1_600;
  assert.equal(deadline.expired(), true);
  assert.equal(deadline.remaining(), 0, 'le temps restant ne devient jamais négatif');
});

test('C34 — une garde sans budget n’expire jamais', () => {
  assert.equal(NO_DEADLINE.expired(), false);
  assert.equal(NO_DEADLINE.remaining(), Number.POSITIVE_INFINITY);
});

test('B20 — une marque née pendant le recalcul est consommée : le projet est ré-enfilé', async (t) => {
  await startFakeDb(t);
  const startedAt = '2026-04-20T02:00:00.000Z';
  const enqueued: string[] = [];
  const enqueue = async (projectId: string): Promise<void> => {
    enqueued.push(projectId);
  };
  await markInvalid('p1', 'zone', ['facturation'], '2026-04-20T01:00:00.000Z');
  assert.equal(await consumeMarks('p1', startedAt, enqueue), 0, 'marque antérieure : déjà traitée');
  assert.deepEqual(enqueued, [], 'rien de neuf : pas de ré-enfilage');
  await markInvalid('p1', 'zone', ['taxes'], '2026-04-20T02:00:05.000Z');
  assert.equal(await consumeMarks('p1', startedAt, enqueue), 1, 'marque pendant le calcul : à reprendre');
  assert.deepEqual(enqueued, ['p1'], 'le projet est ré-enfilé sans attendre la nuit suivante');
});

test('C28 — le plafond garde les plus récents, les hors-plafond gardent leurs parts', async (t) => {
  await startFakeDb(t);
  const facts = Array.from({ length: 302 }, (_, index) =>
    makeFact({
      issueId: `i${index}`,
      key: `PAY-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    }),
  );
  const { within, beyond } = splitByLinkCap(facts);
  assert.equal(within.length, 300);
  assert.equal(within[0]?.issueId, 'i2', 'le plafond garde les 300 plus récents, pas les plus anciens');
  assert.deepEqual(beyond.map((fact) => fact.issueId), ['i0', 'i1']);
  await replaceAttributions('p1', [attribution({ evidenceId: 'ev1', debtIssueId: 'i0' })]);
  const carried = await carryBeyondAttributions('p1', beyond, [], []);
  assert.equal(carried.length, 1, 'l’attribution du ticket hors plafond est rejouée, pas effacée');
  assert.equal(carried[0]?.debtIssueId, 'i0');
  assert.equal((await listAttributions('p1')).length, 1);
});
