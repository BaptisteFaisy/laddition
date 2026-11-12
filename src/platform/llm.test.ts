import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET_UNAVAILABLE,
  fingerprintOf,
  openScoreCache,
  scoreRelevance,
  setLlmTransport,
  setScoreStore,
} from './llm';
import { createRateLimiter, llmThrottle, resetLlmBudget } from './ratelimit';
import type { LlmTransport, ScoreRecord, ScoreStore } from './llm';

/**
 * C30 (cache persistant) et C31 (garde de débit) : tout est testé sans appeler
 * le modèle — le transport est injecté, l'horloge est injectée, le store aussi.
 */

function makeTransport(answers: string[] = []) {
  let chatCalls = 0;
  const transport = {
    calls: 0,
    async chat() {
      chatCalls += 1;
      transport.calls = chatCalls;
      return { choices: [{ message: { content: answers[chatCalls - 1] ?? '' } }] };
    },
    async list() {
      return { models: [{ model: 'claude-3-5', status: 'active' }] };
    },
  };
  return transport as LlmTransport & { calls: number };
}

const VALID_SCORE = '{"relevance": 0.75, "rationale": "lien direct"}';

function makeStore(records: ScoreRecord[] = []): ScoreStore & { saved: ScoreRecord[] } {
  const store: ScoreStore & { saved: ScoreRecord[] } = {
    saved: [],
    async loadCachedScores() {
      return records;
    },
    async saveCachedScores(entries) {
      store.saved.push(...entries);
    },
  };
  return store;
}

beforeEach(() => {
  resetLlmBudget();
  setLlmTransport(null);
  setScoreStore(null);
});
afterEach(() => {
  resetLlmBudget();
  setLlmTransport(null);
  setScoreStore(null);
});

test('fingerprintOf est stable et distingue deux textes', () => {
  assert.equal(fingerprintOf('a', 'b'), fingerprintOf('a', 'b'));
  assert.notEqual(fingerprintOf('a', 'b'), fingerprintOf('a', 'c'));
});

test('limiteur : plafond de requêtes par minute', () => {
  const limiter = createRateLimiter({ maxRequestsPerMinute: 2, now: () => 0 });
  assert.equal(limiter.tryAcquire(1).allowed, true);
  assert.equal(limiter.tryAcquire(1).allowed, true);
  assert.equal(limiter.tryAcquire(1).allowed, false);
  assert.equal(limiter.tryAcquire(1).reason, '2 requêtes/min');
});

test('limiteur : plafond de jetons par minute', () => {
  const limiter = createRateLimiter({ maxTokensPerMinute: 100, now: () => 0 });
  assert.equal(limiter.tryAcquire(60).allowed, true);
  assert.equal(limiter.tryAcquire(60).allowed, false);
});

test('limiteur : plafond de requêtes par invocation', () => {
  const limiter = createRateLimiter({ maxRequestsPerInvocation: 1, now: () => 0 });
  assert.equal(limiter.tryAcquire(1).allowed, true);
  const refused = limiter.tryAcquire(1);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason ?? '', /invocation/);
});

test('limiteur : la fenêtre glisse (une requête redevient possible après 60 s)', () => {
  let now = 0;
  const limiter = createRateLimiter({ maxRequestsPerMinute: 1, now: () => now });
  assert.equal(limiter.tryAcquire(1).allowed, true);
  assert.equal(limiter.tryAcquire(1).allowed, false);
  now += 60_001;
  assert.equal(limiter.tryAcquire(1).allowed, true);
});

test('scoreRelevance : même couple servi depuis le cache, un seul appel modèle', async () => {
  const transport = makeTransport([VALID_SCORE]);
  setLlmTransport(transport);
  const cache = new Map();

  const first = await scoreRelevance('preuve', 'dette', cache);
  const second = await scoreRelevance('preuve', 'dette', cache);
  assert.equal(first.relevance, 0.75);
  assert.equal(second.relevance, 0.75);
  assert.equal(transport.calls, 1);
  assert.equal(first.fingerprint, fingerprintOf('preuve', 'dette'));
});

test('scoreRelevance : un score frais est persisté via le store (C30)', async () => {
  const transport = makeTransport([VALID_SCORE]);
  const store = makeStore();
  setLlmTransport(transport);
  setScoreStore(store);

  await scoreRelevance('preuve', 'dette', new Map());
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]?.fingerprint, fingerprintOf('preuve', 'dette'));
  assert.equal(store.saved[0]?.relevance, 0.75);
});

test('openScoreCache charge les scores enregistrés (C30)', async () => {
  const store = makeStore([{ fingerprint: 'fp1', relevance: 0.4, rationale: 'déjà vu' }]);
  setScoreStore(store);
  const cache = await openScoreCache();
  assert.equal(cache.get('fp1')?.relevance, 0.4);
  assert.equal(cache.get('fp1')?.rationale, 'déjà vu');
});

test('scoreRelevance : un échec du modèle n’est pas mis en cache (C43)', async () => {
  const transport = makeTransport(['n’importe quoi', 'n’importe quoi']);
  setLlmTransport(transport);
  const cache = new Map();

  const first = await scoreRelevance('x', 'y', cache);
  assert.equal(first.relevance, 0);
  assert.equal(first.rationale, 'modèle indisponible');
  assert.equal(cache.size, 0); // rien en cache
  await scoreRelevance('x', 'y', cache);
  assert.equal(transport.calls, 2); // repayé la fois suivante
});

test('scoreRelevance : plafond atteint → repli neutre déterministe, sans appel (C31)', async () => {
  const transport = makeTransport([VALID_SCORE]);
  resetLlmBudget({ maxRequestsPerInvocation: 0, now: () => 0 });
  setLlmTransport(transport);

  const result = await scoreRelevance('x', 'y', new Map());
  assert.equal(result.relevance, 0);
  assert.equal(result.rationale, BUDGET_UNAVAILABLE);
  assert.equal(transport.calls, 0);
});

test('llmThrottle expose une attente bornée (aucun throw au repos)', async () => {
  await llmThrottle.beforeCall();
});