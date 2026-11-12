import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeadline, NO_DEADLINE } from './deadline';
import { stubForgeRuntime } from './testForge';
import { makeFact, makeSettings } from './testFixtures';

// `recalc` importe le scoreur LLM, qui exige le runtime Forge : double installé
// avant l'import (aucun test n'appelle le modèle).
stubForgeRuntime();
const { mergeFacts, skipReason } = await import('./recalc');

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
