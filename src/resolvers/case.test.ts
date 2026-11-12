/**
 * Tests du résolveur d'argumentaire (item E68, §7.6).
 *
 * L'écran et l'agent doivent lire exactement la même page : ce test vérifie que
 * le résolveur rend les mêmes chiffres que l'outil MCP `get-debt-case`, et que
 * ses erreurs restent des phrases actionnables (item D45).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@forge/resolver';

import type { Failure } from '../jobs/support';
import type { DebtCaseData } from '../mcp/debtCase';
import { getDebtCase as caseAction } from '../mcp/debtCase';
import { startFakeDb, seedPayProject } from '../mcp/testing/seed';
import { getDebtCase } from './case';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

describe('getDebtCase — la page d’argumentaire côté écran', () => {
  it('rend les mêmes chiffres que l’outil MCP', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = (await getDebtCase(request({ issueKey: 'PAY-77' }))) as DebtCaseData;
    const action = await caseAction({ issueKey: 'PAY-77' });
    assert.equal('ok' in view, false, 'le résolveur rend la donnée, pas une enveloppe');
    assert.ok(action.ok, 'l’action doit réussir');
    assert.deepEqual(view, action.ok ? action.data : null);
    assert.equal(view.lowJp, 6);
    assert.equal(view.highJp, 9);
    assert.equal(view.method.limits.length >= 6, true);
  });

  it('accepte aussi un identifiant de ticket, comme les autres écrans', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = (await getDebtCase(request({ debtIssueId: 'd77' }))) as DebtCaseData;
    assert.equal(view.issueKey, 'PAY-77');
  });

  it('payload vide ou ticket inconnu : une phrase, jamais une exception', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const empty = (await getDebtCase(request({}))) as Failure;
    assert.equal(empty.ok, false);
    assert.match(empty.error, /« issueKey » manquant ou vide/);
    const unknown = (await getDebtCase(request({ issueKey: 'PAY-1' }))) as Failure;
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /n'est pas un ticket de dette/);
    const missing = (await getDebtCase(request({ issueKey: 'PAY-90' }))) as Failure;
    assert.match(missing.error, /aucune addition calculée/);
  });
});
