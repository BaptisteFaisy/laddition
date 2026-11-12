import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  jqlForTopDebts,
  postRepaymentComment,
  setJiraHttp,
  writeDebtCost,
} from './field';
import type { JiraHttp } from './field';
import type { Route } from '@forge/api';

/**
 * C29 (écritures parallèles bornées), C42 (comparaison arrondie, chaîne
 * tolérée) et G91 (bulletin idempotent en commentaire). Transport HTTP injecté,
 * aucun réseau ; le champ est identifié par une constante locale.
 */

const FIELD = 'customfield_10042';

interface FakeState {
  current: Map<string, number | string>;
  fail: Map<string, number>;
  comments: Array<{ body?: unknown }>;
  postOk: boolean;
  puts: Array<{ key: string; value: number }>;
  posts: Array<{ payload: Record<string, unknown> }>;
  inFlight: number;
  maxInFlight: number;
}

function makeHttp(init: {
  current?: Record<string, number | string>;
  fail?: Record<string, number>;
  comments?: Array<{ body?: unknown }>;
  postOk?: boolean;
} = {}) {
  const state: FakeState = {
    current: new Map(Object.entries(init.current ?? {})),
    fail: new Map(Object.entries(init.fail ?? {})),
    comments: init.comments ?? [],
    postOk: init.postOk ?? true,
    puts: [],
    posts: [],
    inFlight: 0,
    maxInFlight: 0,
  };
  const http: JiraHttp = {
    async getJson<T>(_url: Route, what: string): Promise<T | null> {
      if (what.startsWith('readComments')) return { comments: state.comments, total: state.comments.length, startAt: 0 } as T;
      if (what === 'listFields') return [] as T;
      return null;
    },
    async sendJson<T>(method: string, _url: Route, payload: unknown, what: string) {
      if (what.startsWith('writeDebtCost')) {
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        await Promise.resolve();
        state.inFlight -= 1;
        const key = what.slice('writeDebtCost '.length);
        state.puts.push({ key, value: (payload as { fields: Record<string, unknown> }).fields[FIELD] as number });
        const remain = state.fail.get(key) ?? 0;
        if (remain > 0) state.fail.set(key, remain - 1);
        return { ok: remain <= 0, data: null };
      }
      if (what.startsWith('postRepaymentComment')) {
        state.posts.push({ payload: payload as Record<string, unknown> });
        return state.postOk ? { ok: true, data: null } : { ok: false, data: null };
      }
      return { ok: true, data: null };
    },
    async search(_jql, fields, _maxResults) {
      const fieldId = fields[0] ?? FIELD;
      const issues = [...state.current.keys()].map((key) => ({ key, fields: { [fieldId]: state.current.get(key) } }));
      return { issues: issues as never, nextPageToken: null };
    },
  };
  return { state, http };
}

beforeEach(() => setJiraHttp(null));
afterEach(() => setJiraHttp(null));

test('C42 : comparaison après arrondi, une chaîne est tolérée', async () => {
  const { state, http } = makeHttp({
    current: { 'A-1': '3.10', 'B-1': 3.14159, 'C-1': 3.15 },
  });
  setJiraHttp(http);

  const outcome = await writeDebtCost(
    ['A-1', 'B-1', 'C-1'],
    new Map([
      ['A-1', 3.1],
      ['B-1', 3.14],
      ['C-1', 3.14],
    ]),
    FIELD,
  );

  assert.deepEqual(outcome.updated, ['C-1']);
  assert.deepEqual(outcome.skipped, ['A-1', 'B-1']);
  assert.deepEqual(state.puts, [{ key: 'C-1', value: 3.14 }]);
  assert.equal(outcome.ok, true);
});

test('C29 : au plus 5 PUT en vol, toutes les clés sont écrites', async () => {
  const keys = Array.from({ length: 12 }, (_v, i) => `K-${i + 1}`);
  const { state, http } = makeHttp();
  setJiraHttp(http);

  const outcome = await writeDebtCost(keys, new Map(keys.map((key) => [key, 1])), FIELD);

  assert.ok(state.maxInFlight > 1 && state.maxInFlight <= 5, `concurrence observée ${state.maxInFlight} (attendue 2..5)`);
  assert.equal(state.puts.length, 12);
  assert.equal(outcome.updated.length, 12);
  assert.equal(outcome.ok, true);
});

test('C29 : plafond de tentatives — un échec persistant échoue, sans dépasser', async () => {
  const { state, http } = makeHttp({ fail: { 'B-1': 1, 'C-1': 2 } });
  setJiraHttp(http);

  const outcome = await writeDebtCost(
    ['A-1', 'B-1', 'C-1'],
    new Map([
      ['A-1', 1],
      ['B-1', 2],
      ['C-1', 3],
    ]),
    FIELD,
  );

  assert.deepEqual(outcome.updated.sort(), ['A-1', 'B-1']);
  assert.deepEqual(outcome.failed, [{ key: 'C-1', reason: 'écriture refusée (403 ou champ verrouillé)' }]);
  assert.equal(outcome.ok, false);
  // A-1 : 1 PUT ; B-1 : 2 PUT (1 échec + 1 succès) ; C-1 : 2 PUT (2 échecs).
  assert.equal(state.puts.length, 5);
});

test('G91 : le bulletin est posté une fois, avec un marqueur dans le corps', async () => {
  const { state, http } = makeHttp();
  setJiraHttp(http);

  const first = await postRepaymentComment('DT-1', 'Avant 3,4 — après 0,6 j-p/semaine.');
  assert.equal(first.ok, true);
  assert.equal(first.posted, true);
  assert.equal(state.posts.length, 1);

  const body = state.posts[0]?.payload.body as { content?: Array<{ content?: Array<{ text?: string }> }> };
  const firstText = body.content?.[0]?.content?.[0]?.text ?? '';
  assert.match(firstText, /^<!-- laddition:bulletin:/);
});

test('G91 : le même bulletin n’est jamais reposté (idempotent)', async () => {
  const { state, http } = makeHttp();
  setJiraHttp(http);

  await postRepaymentComment('DT-1', 'Bulletin identique.');
  const postedBody = state.posts[0]?.payload.body;
  state.comments = [{ body: postedBody }];

  const second = await postRepaymentComment('DT-1', 'Bulletin identique.');
  assert.equal(second.ok, true);
  assert.equal(second.posted, false);
  assert.equal(state.posts.length, 1);
});

test('G91 : un commentaire existant n’est jamais écrasé, on ajoute', async () => {
  const { state, http } = makeHttp({
    comments: [{ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'autre commentaire' }] }] } }],
  });
  setJiraHttp(http);

  const outcome = await postRepaymentComment('DT-1', 'Nouveau bulletin.');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.posted, true);
  assert.equal(state.posts.length, 1); // on poste, on ne réécrit pas l'existant
  assert.equal(state.comments.length, 1);
});

test('G91 : publication refusée → échec explicite, jamais un throw', async () => {
  const { http } = makeHttp({ postOk: false });
  setJiraHttp(http);

  const outcome = await postRepaymentComment('DT-1', 'Bulletin.');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.posted, false);
  assert.equal(outcome.reason, 'publication du bulletin refusée');
});

test('G91 : ticket ou texte vide → refus immédiat', async () => {
  const { http } = makeHttp();
  setJiraHttp(http);

  assert.equal((await postRepaymentComment('', 'x')).ok, false);
  assert.equal((await postRepaymentComment('DT-1', '   ')).ok, false);
});

test('jqlForTopDebts borne le plafond et cite le champ', () => {
  const query = jqlForTopDebts(FIELD, 500);
  assert.equal(query.maxResults, 50);
  assert.match(query.jql, /cf\[10042\]/);
});