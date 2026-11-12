import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSettings } from '../core/settings';
import type { IssueFact, ProjectSettings } from '../core/types';
import type { JiraIssueJson } from '../platform/jira-types';
import { toIssueFact } from '../platform/jira-types';
import { markDebtJqlMatch, withComputedFields } from './issueSync';

/**
 * Lot A — synchronisation des faits.
 *
 * Seules les parties pures sont testées ici : la marque de la règle de dette
 * JQL (DT-01, item A5) et le calcul des zones et de la taille (§8, §9). Les
 * lectures REST (liens en lot, commentaires, historique) sont dans
 * `platform/jira.ts` ; leurs lecteurs purs sont verrouillés par
 * `platform/jira-types.test.ts`.
 */

const SETTINGS: ProjectSettings = makeSettings('10000', 'PAY', {
  debtRule: { kind: 'jql', value: 'labels = "dette"' },
});

function issue(key: string, fields: Record<string, unknown> = {}): JiraIssueJson {
  return { id: key, key, fields } as unknown as JiraIssueJson;
}

test('règle JQL : la marque ne tombe que sur les clés retenues par la recherche', () => {
  const keys = new Set(['PAY-2']);
  assert.equal(markDebtJqlMatch(issue('PAY-1'), keys).debtJqlMatch, undefined);
  assert.equal(markDebtJqlMatch(issue('PAY-2'), keys).debtJqlMatch, true);
});

test('règle JQL : une marque déjà posée n’est pas réécrite', () => {
  const marked = { ...issue('PAY-3'), debtJqlMatch: true };
  assert.equal(markDebtJqlMatch(marked, new Set()), marked);
});

test('règle JQL : le ticket marqué devient une dette, les autres non', () => {
  const keys = new Set(['PAY-2']);
  const facts = [issue('PAY-1'), issue('PAY-2')].map((item) =>
    toIssueFact(markDebtJqlMatch(item, keys), SETTINGS),
  );
  assert.deepEqual(facts.map((fact) => fact.isDebt), [false, true]);
});

test('zones et taille : le fait enregistré porte les champs calculés du §8', () => {
  const fact: IssueFact = withComputedFields(
    toIssueFact(issue('PAY-4', { components: [{ name: 'pay' }], labels: ['zone:taxes'] }), SETTINGS),
    SETTINGS,
  );
  assert.deepEqual(fact.zones, ['pay']);
  assert.notEqual(fact.size, '');
});

test('un ticket sans rattachement tombe dans « non classé »', () => {
  const fact = withComputedFields(toIssueFact(issue('PAY-5'), SETTINGS), SETTINGS);
  assert.deepEqual(fact.zones, ['non classé']);
});

test('troncature d’historique : le marqueur survit au calcul des zones (C41)', () => {
  const fact = withComputedFields(
    { ...toIssueFact(issue('PAY-6'), SETTINGS), historyTruncated: true },
    SETTINGS,
  );
  assert.equal(fact.historyTruncated, true);
});
