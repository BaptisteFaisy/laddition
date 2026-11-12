/**
 * Tests du résolveur de dette fantôme (item 51).
 *
 * Le ticket créé doit porter les champs de zone du projet : sans eux, il reste
 * hors zone (§8) et ne capte aucune preuve (§7.2). Le transport Jira est
 * remplacé par un double — aucun réseau, base en double SQL.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import type { Request } from '@forge/resolver';
import type { Route } from '@forge/api';

import { makeSettings } from '../core/settings';
import type { Failure } from '../jobs/support';
import type { Draft } from '../platform/llm';
import type { SendResult } from '../platform/jira';
import { startFakeDb, seedPayProject } from '../mcp/testing/seed';
import { draftDebtTicket, previewDebtTicket, setDraftSend, zoneFieldsOf } from './draft';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Champs observés sur la création interceptée. */
interface SentFields {
  fields?: { labels?: string[]; components?: Array<{ name: string }> };
}

/** Double de transport : capture la création et rend une clé. */
function captureSend(context: TestContext): SentFields[] {
  const sent: SentFields[] = [];
  const send = async <T>(_method: string, _url: Route, payload: unknown): Promise<SendResult<T>> => {
    sent.push(payload as SentFields);
    return { ok: true, data: { key: 'PAY-900' } as unknown as T };
  };
  setDraftSend(send);
  context.after(() => setDraftSend(null));
  return sent;
}

/** Brouillon relu, ou échec du test si le résolveur a renvoyé une erreur. */
function draftOf(result: Draft | Failure): Draft {
  if ('ok' in result && result.ok === false) assert.fail(`brouillon attendu, reçu : ${result.error}`);
  return result as Draft;
}

describe('draftDebtTicket — le ticket fantôme porte sa zone (item 51)', () => {
  it('pose le composant de la zone du projet à la création', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const sent = captureSend(t);
    const result = await draftDebtTicket(request({ projectKey: 'PAY', zone: 'legacy' }));
    if ('ok' in result && result.ok === false) assert.fail(`création attendue, reçu : ${result.error}`);
    assert.equal(sent.length, 1, 'un seul envoi : la création');
    assert.deepEqual(sent[0]?.fields?.components, [{ name: 'legacy' }], 'composant = zone du projet');
    assert.deepEqual(sent[0]?.fields?.labels, [], 'pas d’étiquette en mode composant');
  });

  it('pose l’étiquette de zone quand le projet est en mode étiquette', () => {
    const settings = makeSettings('p1', 'PAY', { zoneMode: 'label' });
    assert.deepEqual(zoneFieldsOf(settings, 'legacy'), { labels: ['zone:legacy'], components: [] });
    const named = makeSettings('p1', 'PAY', { zoneMode: 'label', zoneLabelField: 'area' });
    assert.deepEqual(zoneFieldsOf(named, 'legacy').labels, ['area:legacy']);
  });

  it('la relecture ne crée rien : le ticket attend la relecture', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const sent = captureSend(t);
    const draft = draftOf(await previewDebtTicket(request({ projectKey: 'PAY', zone: 'legacy' })));
    assert.ok(draft.title.length > 0, 'un titre relu avant création');
    assert.equal(sent.length, 0, 'aucune création pendant la relecture');
  });
});
