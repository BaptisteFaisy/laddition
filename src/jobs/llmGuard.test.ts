import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCallGuard, LLM_CALLS_PER_MINUTE } from './llmGuard';

/**
 * C31 — le débit du modèle est borné (§17 : 100 requêtes par minute).
 *
 * Sans garde, une nuit nombreuse sature le quota et les derniers scores ne sont
 * jamais obtenus. La garde n'annule rien : elle espace les appels.
 */

/** Horloge et sommeil faux : le test fait avancer le temps sans attendre. */
function fakeTime() {
  let clock = 0;
  const sleeps: number[] = [];
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('sous le quota, aucun appel n’attend', async () => {
  const time = fakeTime();
  const guard = createCallGuard(3, time);
  await guard.beforeCall();
  await guard.beforeCall();
  await guard.beforeCall();
  assert.deepEqual(time.sleeps, []);
});

test('au-delà du quota, l’appel attend que la minute glisse', async () => {
  const time = fakeTime();
  const guard = createCallGuard(2, time);
  await guard.beforeCall();
  await guard.beforeCall();
  await guard.beforeCall();
  assert.equal(time.sleeps.length, 1, 'le troisième appel patiente');
  assert.ok((time.sleeps[0] ?? 0) > 0);
});

test('une minute écoulée rend le quota disponible', async () => {
  const time = fakeTime();
  const guard = createCallGuard(1, time);
  await guard.beforeCall();
  time.advance(60_000);
  await guard.beforeCall();
  assert.deepEqual(time.sleeps, [], 'aucune attente : la fenêtre a glissé');
});

test('la garde enchaîne les appels au rythme demandé, sans boucle infinie', async () => {
  const time = fakeTime();
  const guard = createCallGuard(60, time);
  for (let index = 0; index < 200; index += 1) await guard.beforeCall();
  assert.ok(time.sleeps.length > 0, 'le quota de 60 par minute est tenu');
  assert.ok(time.now() <= 200_000, 'le temps reste borné');
});

test('le débit retenu reste sous la limite de la plateforme', () => {
  assert.ok(LLM_CALLS_PER_MINUTE < 100);
  assert.ok(LLM_CALLS_PER_MINUTE >= 60, 'assez haut pour ne pas ralentir la nuit');
});
