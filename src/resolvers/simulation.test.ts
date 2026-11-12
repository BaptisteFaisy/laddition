/**
 * Tests du résolveur de simulation (DT-21) sur le double SQL en mémoire.
 *
 * Le jeu amorcé (`seedPayProject`) couvre exactement les cas exigés :
 * - `d77` : addition stockée avec coût évitable, pas encore remboursée ;
 * - `d41` : bulletin de remboursement publié (baisse observée 2,6 → 0,7) ;
 * - `d90` : dette sans addition (non chiffrable) ;
 * - un identifiant inconnu : signalé, jamais inventé.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@forge/resolver';

import type { Failure } from '../jobs/support';
import { seedPayProject, startFakeDb } from '../mcp/testing/seed';
import { MAX_SIMULATED_DEBTS, SIMULATION_RESOLVER_KEY, simulateRepayment } from './simulation';
import type { SimulationRow } from '../core/simulation';
import type { SimulationView } from './simulation';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Vue rendue, ou échec du test si le résolveur a renvoyé une erreur. */
function viewOf(result: SimulationView | Failure): SimulationView {
  if ('ok' in result && result.ok === false) assert.fail(`succès attendu, reçu : ${result.error}`);
  return result as SimulationView;
}

/** Ligne attendue, ou échec du test (indexation stricte). */
function rowAt(view: SimulationView, index: number): SimulationRow {
  const row = view.rows[index];
  assert.ok(row, `ligne ${index} manquante`);
  return row;
}

/** Sélection type du jeu amorcé. */
function selection(): Record<string, unknown> {
  return { projectId: 'p1', debtIssueIds: ['d77', 'd41', 'd90', 'nope'] };
}

describe('simulateRepayment — cas nominal sur le jeu PAY', () => {
  it('rend une ligne par dette sélectionnée, dans l’ordre de la sélection', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await simulateRepayment(request(selection())));
    assert.deepEqual(
      view.rows.map((row) => row.debtIssueId),
      ['d77', 'd41', 'd90', 'nope'],
    );
    assert.equal(view.totals.selectedCount, 4);
  });

  it('d77 : capacité attendue = coût évitable stocké dans l’addition', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await simulateRepayment(request(selection())));
    const row = rowAt(view, 0);
    assert.equal(row.method, 'avoidable');
    assert.equal(row.avoidableJp, 8.4);
    assert.equal(row.repaymentJp, 2);
    assert.equal(row.paybackDays, 30);
    assert.equal(row.zone, 'taxes');
    assert.equal(row.repaid, false);
    assert.equal(view.totals.avoidableJp, 8.4);
    assert.equal(view.totals.repaymentJp, 2);
  });

  it('d41 : remboursement partiel déjà publié = baisse observée du bulletin', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await simulateRepayment(request(selection())));
    const row = rowAt(view, 1);
    assert.equal(row.method, 'observed');
    assert.equal(row.repaid, true);
    assert.equal(row.observedWeeklyJp, 1.9, '2,6 − 0,7 j-p par semaine');
    assert.deepEqual(row.caveats, ['autres changements sur la zone', 'échantillon de 8 semaines']);
    assert.equal(view.totals.observedWeeklyJp, 1.9);
  });

  it('d90 sans addition et « nope » inconnu : non chiffrables, jamais 0', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await simulateRepayment(request(selection())));
    assert.equal(rowAt(view, 2).method, 'unquantified');
    assert.equal(rowAt(view, 2).avoidableJp, null);
    assert.equal(rowAt(view, 3).method, 'unknown');
    assert.equal(view.totals.unquantifiedCount, 2);
  });

  it('principe 1 : chaque chiffre rendu porte sa méthode', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await simulateRepayment(request(selection())));
    for (const row of view.rows) {
      assert.ok(row.methodText.length > 0, `${row.key} sans texte de méthode`);
      assert.ok(['observed', 'avoidable', 'unquantified', 'unknown'].includes(row.method));
    }
  });
});

describe('simulateRepayment — contrat et erreurs actionnables', () => {
  it('la clé du résolveur est une constante exportée', () => {
    assert.equal(SIMULATION_RESOLVER_KEY, 'simulateRepayment');
    assert.equal(typeof simulateRepayment, 'function');
  });

  it('payload invalide : une phrase, jamais une exception', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const noProject = await simulateRepayment(request({ debtIssueIds: ['d77'] }));
    assert.match((noProject as Failure).error, /« projectId » manquant ou vide/);
    const notAList = await simulateRepayment(request({ projectId: 'p1', debtIssueIds: 'd77' }));
    assert.match((notAList as Failure).error, /liste d’identifiants de dette/);
    const empty = await simulateRepayment(request({ projectId: 'p1', debtIssueIds: [] }));
    assert.match((empty as Failure).error, /« debtIssueIds » manquant ou vide/);
    const tooMany = await simulateRepayment(
      request({ projectId: 'p1', debtIssueIds: Array.from({ length: MAX_SIMULATED_DEBTS + 1 }, (_, i) => `d${i}`) }),
    );
    assert.match((tooMany as Failure).error, /bornée à 50 dettes/);
  });

  it('projet inconnu : échec propre, pas de pile d’appels', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await simulateRepayment(request({ projectId: 'nope', debtIssueIds: ['d77'] }));
    assert.equal('ok' in result && result.ok === false, true);
  });
});
