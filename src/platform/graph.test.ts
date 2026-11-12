import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_TTL_MS,
  fetchIncidentServices,
  fetchTeamByComponent,
  fetchZoneLinks,
  resetGraphCache,
  setGraphClock,
  setGraphTransport,
  takeGraphFailures,
} from './graph';
import type { GraphResponse, GraphTransport } from './graph';

/**
 * C43 — le cache Teamwork Graph ne doit plus être partagé entre utilisateurs,
 * sans TTL, ni empoisonné par les échecs. Chaque test injecte un transport
 * (jamais de réseau) et vérifie : clé par utilisateur, TTL courte, échec jamais
 * mis en cache, « vide » légitime mis en cache, échec distingué du vide.
 */

function okJson(data: unknown): GraphResponse {
  return { ok: true, status: 200, json: async () => data };
}

function httpFailure(status: number): GraphResponse {
  return { ok: false, status, json: async () => ({}) };
}

function graphqlError(message: string): GraphResponse {
  return { ok: true, status: 200, json: async () => ({ errors: [{ message }] }) };
}

function makeTransport() {
  let respond: (operation: string) => GraphResponse = () => okJson({ data: {} });
  const transport: GraphTransport & { calls: Array<{ operation: string; variables: Record<string, unknown> }> } = {
    calls: [],
    async requestTeamworkGraph(_query, variables, operation) {
      transport.calls.push({ operation, variables });
      return respond(operation);
    },
  };
  return {
    transport,
    respond(next: (operation: string) => GraphResponse) {
      respond = next;
    },
  };
}

const ZONE = {
  data: { jiraWorkItems: { nodes: [{ key: 'A-1', compassComponents: { nodes: [{ name: 'api' }] } }] } },
};
const TEAM = { data: { compassComponents: { nodes: [{ id: 'c1', name: 'comp', team: { name: 'Equipe A' } }] } } };

beforeEach(() => resetGraphCache());
afterEach(() => {
  setGraphTransport(null);
  setGraphClock(null);
  resetGraphCache();
});

test('les zones sont servies depuis le cache pour un même utilisateur', async () => {
  const { transport, respond } = makeTransport();
  respond(() => okJson(ZONE));
  setGraphTransport(transport);

  const first = await fetchZoneLinks(['A-1'], 'u1');
  const second = await fetchZoneLinks(['A-1'], 'u1');
  assert.deepEqual(first.get('A-1'), ['api']);
  assert.deepEqual(second.get('A-1'), ['api']);
  assert.equal(transport.calls.length, 1);
});

test('le cache n’est PAS partagé entre utilisateurs (C43)', async () => {
  const { transport, respond } = makeTransport();
  respond(() => okJson(ZONE));
  setGraphTransport(transport);

  await fetchZoneLinks(['A-1'], 'u1');
  const again = await fetchZoneLinks(['A-1'], 'u2');
  assert.equal(transport.calls.length, 2);
  assert.deepEqual(again.get('A-1'), ['api']);
});

test('TTL courte : une entrée expire et est relue (C43)', async () => {
  let now = 0;
  setGraphClock(() => now);
  const { transport, respond } = makeTransport();
  respond(() => okJson(ZONE));
  setGraphTransport(transport);

  await fetchZoneLinks(['A-1'], 'u1');
  assert.equal(transport.calls.length, 1);
  now += GRAPH_TTL_MS + 1;
  await fetchZoneLinks(['A-1'], 'u1');
  assert.equal(transport.calls.length, 2);
});

test('un échec HTTP n’est jamais mis en cache (C43)', async () => {
  const { transport, respond } = makeTransport();
  respond(() => httpFailure(429));
  setGraphTransport(transport);

  const first = await fetchZoneLinks(['A-1'], 'u1');
  assert.deepEqual(first.get('A-1'), []);
  assert.equal(takeGraphFailures().length, 1);

  respond(() => okJson(ZONE));
  const second = await fetchZoneLinks(['A-1'], 'u1');
  assert.deepEqual(second.get('A-1'), ['api']);
  assert.equal(transport.calls.length, 2);
});

test('une erreur GraphQL n’est jamais mise en cache (C43)', async () => {
  const { transport, respond } = makeTransport();
  respond(() => graphqlError('scope manquant'));
  setGraphTransport(transport);

  await fetchZoneLinks(['A-1'], 'u1');
  assert.equal(takeGraphFailures().length, 1);
  respond(() => okJson(ZONE));
  const second = await fetchZoneLinks(['A-1'], 'u1');
  assert.deepEqual(second.get('A-1'), ['api']);
  assert.equal(transport.calls.length, 2);
});

test('le « vide » légitime est mis en cache et distingué de l’échec (C43)', async () => {
  let now = 0;
  setGraphClock(() => now);
  const { transport, respond } = makeTransport();
  respond(() => okJson({ data: { jiraWorkItems: { nodes: [] } } })); // scope absent : vide sans erreur
  setGraphTransport(transport);

  const first = await fetchZoneLinks(['A-1'], 'u1');
  assert.deepEqual(first.get('A-1'), []);
  assert.equal(takeGraphFailures().length, 0); // vide, pas un échec
  await fetchZoneLinks(['A-1'], 'u1');
  assert.equal(transport.calls.length, 1); // bien mis en cache, pas réinterrogé
});

test('équipe et services utilisent chacun leur clé par utilisateur', async () => {
  const { transport, respond } = makeTransport();
  respond((operation) => (operation === 'teamByComponent' ? okJson(TEAM) : okJson(ZONE)));
  setGraphTransport(transport);

  const teams = await fetchTeamByComponent(['c1'], 'u1');
  assert.equal(teams.get('c1'), 'Equipe A');
  const services = await fetchIncidentServices(['A-1'], 'u1');
  assert.deepEqual(services.get('A-1'), []);
  assert.equal(transport.calls.length, 2);
});

test('une équipe inconnue est un vide légitime (valeur vide en cache)', async () => {
  const { transport, respond } = makeTransport();
  respond(() => okJson({ data: { compassComponents: { nodes: [] } } }));
  setGraphTransport(transport);

  const teams = await fetchTeamByComponent(['c1'], 'u1');
  assert.equal(teams.get('c1'), '');
  assert.equal(transport.calls.length, 1);
  await fetchTeamByComponent(['c1'], 'u1');
  assert.equal(transport.calls.length, 1);
});