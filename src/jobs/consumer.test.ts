import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BatchState } from './bootstrapState';
import { stubForgeRuntime } from './testForge';

// `consumer` aiguille vers le recalcul, qui importe le scoreur LLM : double
// installé avant l'import (aucun test n'appelle Forge).
stubForgeRuntime();
const { MAX_BATCH_ATTEMPTS, MAX_BOOTSTRAP_BATCHES, planBatch, progressFrom } = await import('./consumer');

/**
 * B25, B26 — un lot rejouable, des échecs qui se voient.
 *
 * `advance` additionnait `done` à chaque passage : un message rejoué par Forge
 * comptait deux fois les mêmes tickets, et la barre de progression mentait.
 * La progression vient désormais de la **somme des lots** enregistrés, et un lot
 * déjà joué n'est ni ré-enregistré ni re-poussé. Les rejeux sont bornés.
 */

function state(overrides: Partial<BatchState> = {}): BatchState {
  return {
    projectId: 'p1',
    pageToken: 'token',
    done: 50,
    failed: 0,
    attempts: 1,
    ingested: true,
    pushed: true,
    finished: false,
    error: null,
    updatedAt: '2026-04-20T02:00:00.000Z',
    ...overrides,
  };
}

const OPEN_PAGE = {
  finished: false,
  hasNext: true,
  maxAttempts: MAX_BATCH_ATTEMPTS,
  batches: 1,
  maxBatches: MAX_BOOTSTRAP_BATCHES,
};

test('un lot jamais joué est enregistré, puis pousse le suivant', () => {
  const plan = planBatch(null, OPEN_PAGE);
  assert.equal(plan.ingest, true);
  assert.equal(plan.push, true);
  assert.equal(plan.attempts, 1);
  assert.equal(plan.stop, undefined);
});

test('un lot déjà joué n’est ni ré-enregistré ni re-poussé (B25)', () => {
  const plan = planBatch(state(), OPEN_PAGE);
  assert.equal(plan.ingest, false);
  assert.equal(plan.push, false);
});

test('un lot enregistré mais non poussé repousse le suivant, sans ré-enregistrer', () => {
  const plan = planBatch(state({ pushed: false }), OPEN_PAGE);
  assert.equal(plan.ingest, false);
  assert.equal(plan.push, true);
});

test('le dernier lot ne pousse rien', () => {
  const plan = planBatch(null, { ...OPEN_PAGE, finished: true, hasNext: false });
  assert.equal(plan.push, false);
  assert.equal(plan.ingest, true);
});

test('les rejeux sont bornés : au-delà du maximum, le lot s’arrête (B26)', () => {
  const plan = planBatch(state({ attempts: MAX_BATCH_ATTEMPTS }), OPEN_PAGE);
  assert.equal(plan.ingest, false);
  assert.equal(plan.push, false);
  assert.match(plan.stop ?? '', /abandonné/);
});

test('la chaîne de messages est bornée : pas de démultiplication infinie', () => {
  const plan = planBatch(null, { ...OPEN_PAGE, batches: MAX_BOOTSTRAP_BATCHES });
  assert.equal(plan.push, false);
  assert.equal(plan.stop, undefined, 'le lot lui-même est traité, seule la chaîne s’arrête');
});

test('la progression vient des totaux : rejouer un lot ne double pas le compte', () => {
  const totals = { done: 100, failed: 2, batches: 2, error: null, attempts: 1 };
  const previous = {
    projectId: 'p1',
    total: 250,
    done: 100,
    failed: 2,
    startedAt: '2026-04-20T01:00:00.000Z',
    updatedAt: '2026-04-20T01:30:00.000Z',
    finished: false,
    error: null,
    attempts: 1,
  };
  const first = progressFrom('p1', totals, previous, false, '2026-04-20T02:00:00.000Z');
  const replay = progressFrom('p1', totals, first, false, '2026-04-20T02:05:00.000Z');
  assert.equal(first.done, 100);
  assert.equal(replay.done, 100, 'le rejeu rend le même total');
  assert.equal(replay.total, 250, 'le dénominateur fixé au démarrage est conservé');
  assert.equal(replay.startedAt, previous.startedAt);
});

test('échecs et rejeux sont écrits dans le contrat (B26)', () => {
  const totals = {
    done: 48,
    failed: 2,
    batches: 1,
    error: 'ticket PAY-9 illisible',
    attempts: 2,
  };
  const progress = progressFrom('p1', totals, null, false, '2026-04-20T02:00:00.000Z');
  assert.equal(progress.failed, 2);
  assert.equal(progress.error, 'ticket PAY-9 illisible');
  assert.equal(progress.attempts, 2);
  assert.equal(progress.finished, false);
});

test('à la fin, le total rejoint ce qui a été traité', () => {
  const totals = { done: 120, failed: 0, batches: 3, error: null, attempts: 1 };
  const progress = progressFrom('p1', totals, null, true, '2026-04-20T02:00:00.000Z');
  assert.equal(progress.total, 120);
  assert.equal(progress.finished, true);
});

test('C34 — le consommateur reconnaît un message de recalcul', async () => {
  const { isRecalcPayload } = await import('./recalcQueue');
  assert.equal(isRecalcPayload({ kind: 'recalc', projectId: 'p1' }), true);
  assert.equal(isRecalcPayload({ kind: 'recalc' }), false, 'sans projet, rien à recalculer');
  assert.equal(isRecalcPayload({ projectId: 'p1', nextPageToken: '' }), false, 'un lot n’est pas un recalcul');
});

test('un message sans projet rend un bilan explicite, pas un rejeu infini', async () => {
  const { bootstrapBatch } = await import('./consumer');
  const result = await bootstrapBatch({ body: { nextPageToken: 'abc' } });
  assert.equal('ok' in result, true);
  const bilan = result as { ok: boolean; error?: string };
  assert.equal(bilan.ok, false);
  assert.match(bilan.error ?? '', /projectId/);
});
