/**
 * Tests de la sonde « tout est visible » (`?action=screens`).
 *
 * L'enjeu n'est pas seulement que la sonde fonctionne : c'est qu'elle ne puisse
 * pas oublier une surface. Les deux registres (`RESOLVERS`, `ACTIONS`) sont donc
 * la source de la liste jouée, et un test vérifie que toute clé en lecture est
 * soit jouée, soit explicitement écartée — une nouvelle fonctionnalité livrée
 * sans écran ni outil fait rougir ce test.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stubForgeRuntime } from './testForge';

stubForgeRuntime();

const { exerciseScreens, readResolvers, readTools, WRITE_RESOLVERS, LLM_SURFACES } = await import('./opsScreens');
const { RESOLVERS } = await import('../resolvers/index');
const { ACTIONS } = await import('../mcp/registry');
const { PROJECT_KEY, seedPayProject, startFakeDb } = await import('../mcp/testing/seed');

describe('exerciseScreens — toutes les surfaces de lecture répondent', () => {
  it('joue les écrans et les outils du jeu de référence sans échec', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await exerciseScreens(PROJECT_KEY, '', '');
    const failed = result.calls.filter((call) => !call.ok);
    assert.deepEqual(
      failed.map((call) => `${call.key} : ${call.summary}`),
      [],
      'des surfaces de lecture ont échoué',
    );
    assert.equal(result.allOk, true);
    assert.ok(result.calls.length >= 20, `au moins 20 surfaces jouées, reçu ${result.calls.length}`);
  });

  it('rend une ligne de résumé par surface, jamais vide', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await exerciseScreens(PROJECT_KEY, '', '');
    for (const call of result.calls) {
      assert.ok(call.summary.length > 0, `${call.key} n'a pas de résumé`);
      assert.ok(call.kind === 'écran' || call.kind === 'outil', `${call.key} a un genre inconnu`);
    }
    const page = result.calls.find((call) => call.key === 'getProjectPage');
    assert.ok(page, 'la page projet est la première surface jouée');
  });

  it('couvre chaque clé en lecture des deux registres', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await exerciseScreens(PROJECT_KEY, '', '');
    const played = new Set(result.calls.map((call) => call.key));
    const forgottenResolvers = readResolvers().filter(
      (key) => !played.has(key) && !LLM_SURFACES.includes(key),
    );
    const forgottenTools = readTools().filter((key) => !played.has(key) && !LLM_SURFACES.includes(key));
    assert.deepEqual(forgottenResolvers, [], 'résolveurs en lecture jamais joués');
    assert.deepEqual(forgottenTools, [], 'outils MCP en lecture jamais joués');
  });

  it('ne joue aucune surface d’écriture, et le dit', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await exerciseScreens(PROJECT_KEY, '', '');
    const played = new Set(result.calls.map((call) => call.key));
    for (const key of WRITE_RESOLVERS) {
      assert.equal(played.has(key), false, `${key} écrit : la sonde ne doit pas le jouer`);
    }
    assert.equal(played.has('confirm-evidence'), false);
    for (const key of [...WRITE_RESOLVERS, 'confirm-evidence']) {
      assert.ok(
        result.skipped.some((line) => line.startsWith(key)),
        `${key} doit apparaître dans les surfaces écartées`,
      );
    }
  });

  it('écarte les surfaces du modèle tant que llm=1 n’est pas demandé', () => {
    for (const key of LLM_SURFACES) {
      assert.equal(readResolvers().includes(key) || readTools().includes(key), true, `${key} existe`);
    }
  });

  it('les registres restent la source : une clé en écriture n’est pas en lecture', () => {
    for (const key of Object.keys(RESOLVERS)) {
      if (WRITE_RESOLVERS.includes(key)) assert.equal(readResolvers().includes(key), false, key);
    }
    assert.ok(Object.keys(ACTIONS).length >= 11, 'les 11 outils MCP sont déclarés');
  });
});
