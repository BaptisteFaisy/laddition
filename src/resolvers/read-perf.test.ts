/**
 * Items 38 & 40 — lectures réduites de la page projet et du gadget.
 *
 * Le double SQL (`platform/db/fakeSql.ts`) journalise chaque requête : un
 * écran secondaire ne doit lire que les tables qu'il affiche (4 SELECT),
 * jamais l'état complet du projet (`loadState`, 7 SELECT), et rendre
 * exactement les mêmes chiffres que lui. Jeu de données : `mcp/testing/seed.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@forge/resolver';

import type { DeadDebt, PhantomDebt } from '../core/types';
import { findDeadDebt } from '../core/dead';
import { findPhantomDebt } from '../core/phantom';
import type { Failure } from '../jobs/support';
import { nowIso } from '../jobs/support';
import { PROJECT_ID, seedPayProject, startFakeDb } from '../mcp/testing/seed';
import type { FakeSqlClient } from '../platform/db/fakeSql';
import type { GadgetData, ProjectPageData } from './read';
import { GADGET_TOP_DEBTS, getGadgetData, getProjectPage, listDeadDebt, listPhantomDebt } from './read';
import { loadState } from './state';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Résultat attendu en succès ; échoue le test sur une enveloppe d'erreur. */
function ok<T>(result: T | Failure): T {
  if ('ok' in (result as Failure) && (result as Failure).ok === false) {
    assert.fail(`succès attendu, reçu : ${(result as Failure).error}`);
  }
  return result as T;
}

const projectRequest = (): Request<unknown> => request({ projectId: PROJECT_ID });

/** SELECT émis depuis la position `before` du journal du double. */
function selectsSince(client: FakeSqlClient, before: number): string[] {
  return client.log.slice(before).filter((call) => call.kind === 'select').map((call) => call.query);
}

/** Tables lues (FROM/JOIN) par des requêtes : la preuve de la réduction. */
function tablesOf(queries: readonly string[]): string[] {
  const tables = new Set<string>();
  for (const query of queries) {
    for (const match of query.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) {
      tables.add((match[1] ?? '').toLowerCase());
    }
  }
  return [...tables].sort();
}

/** Vérifie le nombre de SELECT et les tables lues depuis `before`. */
function assertReducedRead(
  client: FakeSqlClient,
  before: number,
  expectedTables: string[],
  expectedSelects: number,
): void {
  const queries = selectsSince(client, before);
  assert.equal(
    queries.length,
    expectedSelects,
    `${expectedSelects} SELECT ciblés, jamais les 7 de loadState`,
  );
  assert.deepEqual(tablesOf(queries), [...expectedTables].sort());
}

describe('Item 38 — les onglets Fantôme et Mort ne lisent que leurs tables', () => {
  it('charge en 4 à 5 SELECT, avec les mêmes chiffres que l’état complet', async (t) => {
    const client = await startFakeDb(t);
    await seedPayProject();

    const beforePhantom = client.log.length;
    const phantoms = ok<PhantomDebt[]>(await listPhantomDebt(projectRequest()));
    assertReducedRead(client, beforePhantom, ['settings', 'issue_fact', 'evidence', 'zone_week'], 5);
    assert.ok(
      phantoms.some((phantom) => phantom.zone === 'legacy'),
      'la zone sans dette reste détectée',
    );

    const beforeDead = client.log.length;
    const deads = ok<DeadDebt[]>(await listDeadDebt(projectRequest()));
    assertReducedRead(client, beforeDead, ['settings', 'issue_fact', 'evidence', 'attribution'], 4);
    assert.ok(
      deads.some((dead) => dead.key === 'PAY-50'),
      'la dette morte reste détectée',
    );

    // Mêmes replis que l'état complet : la réduction ne change aucun chiffre.
    const state = await loadState(PROJECT_ID, nowIso());
    assert.deepEqual(phantoms, findPhantomDebt(state.zoneCosts, state.debts, state.evidence, state.settings));
    const fullDead = findDeadDebt(state.debts, state.evidence, state.attributions, state.settings, nowIso());
    assert.deepEqual(
      deads.map((dead) => dead.key),
      fullDead.map((dead) => dead.key),
    );
  });
});

describe('Item 40 — le gadget lit seulement le top des additions, les dettes et zone_week', () => {
  it('charge en 5 SELECT et rend les mêmes chiffres que la page complète', async (t) => {
    const client = await startFakeDb(t);
    await seedPayProject();

    const before = client.log.length;
    const gadget = ok<GadgetData>(await getGadgetData(projectRequest()));
    assertReducedRead(client, before, ['settings', 'issue_fact', 'evidence', 'debt_bill', 'zone_week'], 5);
    assert.ok(gadget.debts.length > 0 && gadget.debts.length <= GADGET_TOP_DEBTS);

    const page = ok<ProjectPageData>(await getProjectPage(projectRequest()));
    assert.deepEqual(gadget.debts, page.ranking.slice(0, GADGET_TOP_DEBTS), 'même haut de classement');
    assert.deepEqual(gadget.costByTeam, page.costByTeam);
    assert.deepEqual(gadget.costByQuarter, page.costByQuarter);
    assert.equal(gadget.demoData, page.settings.demoData);
  });
});
