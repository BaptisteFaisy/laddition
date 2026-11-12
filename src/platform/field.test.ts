import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as field from './field';
import {
  jqlForTopDebts,
  setJiraHttp,
  writeDebtCost,
} from './field';
import type { JiraHttp } from './field';
import type { Route } from '@forge/api';

/**
 * C29 (écritures parallèles bornées) et C42 (comparaison arrondie, chaîne
 * tolérée). Transport HTTP injecté, aucun réseau ; le champ est identifié par
 * une constante locale.
 */

const FIELD = 'customfield_10042';

interface FakeState {
  current: Map<string, number | string>;
  fail: Map<string, number>;
  puts: Array<{ key: string; value: number }>;
  inFlight: number;
  maxInFlight: number;
}

function makeHttp(init: {
  current?: Record<string, number | string>;
  fail?: Record<string, number>;
} = {}) {
  const state: FakeState = {
    current: new Map(Object.entries(init.current ?? {})),
    fail: new Map(Object.entries(init.fail ?? {})),
    puts: [],
    inFlight: 0,
    maxInFlight: 0,
  };
  const http: JiraHttp = {
    async getJson<T>(_url: Route, what: string): Promise<T | null> {
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

test('jqlForTopDebts borne le plafond et cite le champ', () => {
  const query = jqlForTopDebts(FIELD, 500);
  assert.equal(query.maxResults, 50);
  assert.match(query.jql, /cf\[10042\]/);
});

test('reliquat B19 : le module ne réexporte plus de doublon mort de postRepaymentComment', () => {
  assert.equal('postRepaymentComment' in field, false);
});
