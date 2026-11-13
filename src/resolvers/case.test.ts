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
import { getDebtCase as caseAction } from '../mcp/debtCase';
import type { LlmTransport } from '../platform/llm';
import { setLlmTransport } from '../platform/llm';
import { startFakeDb, seedPayProject } from '../mcp/testing/seed';
import type { DebtCaseView } from './case';
import { getDebtCase } from './case';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Transport modèle qui répond un texte fixe : les tests n'appellent jamais le vrai modèle. */
function textTransport(answer: string): LlmTransport {
  return {
    chat: async () => ({ choices: [{ message: { content: answer } }] }),
    list: async () => ({ models: [{ model: 'claude-3-5', status: 'active' }] }),
  };
}

/** Transport modèle en panne : le repli déterministe doit prendre le relais. */
const brokenTransport: LlmTransport = {
  chat: async () => {
    throw new Error('modèle indisponible');
  },
  list: async () => ({ models: [] }),
};

describe('getDebtCase — la page d’argumentaire côté écran', () => {
  it('rend les mêmes chiffres que l’outil MCP', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    setLlmTransport(brokenTransport);
    t.after(() => setLlmTransport(null));
    const view = (await getDebtCase(request({ issueKey: 'PAY-77' }))) as DebtCaseView;
    const action = await caseAction({ issueKey: 'PAY-77' });
    assert.equal('ok' in view, false, 'le résolveur rend la donnée, pas une enveloppe');
    assert.ok(action.ok, 'l’action doit réussir');
    const { argumentaire, bill, ...facts } = view;
    assert.deepEqual(facts, action.ok ? action.data : null);
    assert.equal(bill.key, 'PAY-77');
    assert.equal(argumentaire.source, 'template');
    assert.equal(view.lowJp, 6);
    assert.equal(view.highJp, 9);
    assert.equal(view.method.limits.length >= 6, true);
  });

  it('accepte aussi un identifiant de ticket, comme les autres écrans', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    setLlmTransport(brokenTransport);
    t.after(() => setLlmTransport(null));
    const view = (await getDebtCase(request({ debtIssueId: 'd77' }))) as DebtCaseView;
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

  it('rédige l’argumentaire avec le modèle quand il répond (DT-17)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    setLlmTransport(textTransport('# Argumentaire — PAY-77\n\nLe texte du modèle, une page.'));
    t.after(() => setLlmTransport(null));
    const view = (await getDebtCase(request({ issueKey: 'PAY-77' }))) as DebtCaseView;
    assert.equal(view.argumentaire.source, 'model');
    assert.match(view.argumentaire.markdown, /Le texte du modèle/);
  });

  /**
   * La langue de rédaction est celle de l'écran (défaut : anglais, la langue de
   * l'application). Un argumentaire français sous une interface anglaise était
   * le défaut DT-17 constaté sur la capture du chat Rovo.
   */
  it('repli déterministe en anglais par défaut : sans modèle, le gabarit tient la page', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    setLlmTransport(brokenTransport);
    t.after(() => setLlmTransport(null));
    const view = (await getDebtCase(request({ issueKey: 'PAY-77' }))) as DebtCaseView;
    assert.equal(view.argumentaire.source, 'template');
    assert.match(view.argumentaire.markdown, /Case — PAY-77/);
    assert.match(view.argumentaire.markdown, /## Limits/);
  });

  it('repli déterministe en français quand l’écran le demande', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    setLlmTransport(brokenTransport);
    t.after(() => setLlmTransport(null));
    const view = (await getDebtCase(request({ issueKey: 'PAY-77', locale: 'fr' }))) as DebtCaseView;
    assert.match(view.argumentaire.markdown, /Argumentaire — PAY-77/);
    assert.match(view.argumentaire.markdown, /## Limites/);
  });
});
