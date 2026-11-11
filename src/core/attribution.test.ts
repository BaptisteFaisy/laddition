import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  Evidence,
  EvidenceDetail,
  IssueFact,
  IssueLink,
  RelevanceScore,
  Rejection,
  ProjectSettings,
} from './types.ts';
import { makeSettings } from './settings.ts';
import { attributeEvidence, isHighBandOnly } from './attribution.ts';

/** Détail de preuve minimal, suffisant pour les tests d'attribution. */
const DETAIL: EvidenceDetail = {
  durationDays: 1,
  method: 'computed',
  formula: 'test',
  inputs: {},
  familyLabel: 'Test',
};

function evidence(id: string, zone: string, sourceIssueId: string): Evidence {
  return {
    id,
    zone,
    family: 'C2',
    sourceIssueId,
    sourceKey: sourceIssueId.toUpperCase(),
    occurredAt: '2026-10-01T00:00:00.000Z',
    costJp: 1,
    method: 'computed',
    visible: true,
    detail: DETAIL,
  };
}

function debt(issueId: string, zones: string[]): IssueFact {
  return {
    issueId,
    key: issueId.toUpperCase(),
    projectId: 'p1',
    projectKey: 'ADD',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: true,
    zones,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: ['tech-debt'],
    components: zones,
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: `Dette ${issueId}`,
  };
}

function score(evidenceId: string, debtIssueId: string, relevance: number, rationale = 'Même zone, texte proche'): RelevanceScore {
  return { evidenceId, debtIssueId, relevance, rationale, fingerprint: `${evidenceId}:${debtIssueId}` };
}

function settings(): ProjectSettings {
  return makeSettings('p1', 'ADD');
}

/** Somme des parts d'une preuve, arrondie au centième. */
function shareSum(list: ReturnType<typeof attributeEvidence>, evidenceId: string): number {
  const parts = list.filter((item) => item.evidenceId === evidenceId);
  return Math.round(parts.reduce((sum, item) => sum + item.share, 0) * 100) / 100;
}

test('§20 — bug lié à une dette : 100 % en fourchette basse', () => {
  const bug = evidence('ev-bug', 'Paiement', 'issue-bug');
  const target = debt('debt-1', ['Paiement']);
  const links: IssueLink[] = [
    { fromIssueId: 'issue-bug', toIssueId: 'debt-1', toKey: 'DEBT-1', type: 'caused by' },
  ];

  const result = attributeEvidence([bug], [target], [], [], settings(), links);

  assert.equal(result.length, 1);
  const [attribution] = result;
  assert.equal(attribution?.share, 1);
  assert.equal(attribution?.basis, 'link');
  assert.equal(attribution?.relevance, 1);
  assert.equal(attribution?.rationale, 'Lien Jira explicite (caused by)');
  // Fourchette basse ET haute : ce n'est pas un partage déduit.
  assert.equal(isHighBandOnly(attribution as NonNullable<typeof attribution>), false);
});

test('§20 — incident sur une zone à deux dettes sans lien : partagé, somme ≤ 100 %', () => {
  const incident = evidence('ev-inc', 'Auth', 'issue-inc');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-inc', 'debt-a', 0.9), score('ev-inc', 'debt-b', 0.5)];

  const result = attributeEvidence([incident], debts, scores, [], settings());

  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.basis === 'inferred'));
  assert.ok(result.every((item) => isHighBandOnly(item)));
  assert.equal(shareSum(result, 'ev-inc'), 1);
  const first = result.find((item) => item.debtIssueId === 'debt-a');
  const second = result.find((item) => item.debtIssueId === 'debt-b');
  assert.equal(first?.share, 0.64);
  assert.equal(second?.share, 0.36);
  // La justification vient du score, en une phrase.
  assert.equal(first?.rationale, 'Même zone, texte proche');
});

test('§20 — rejet : la preuve quitte l\'addition pour cette dette', () => {
  const item = evidence('ev-rej', 'Auth', 'issue-rej');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-rej', 'debt-a', 0.8), score('ev-rej', 'debt-b', 0.6)];
  const rejections: Rejection[] = [
    { evidenceId: 'ev-rej', debtIssueId: 'debt-a', rejectedBy: 'alice', at: '2026-10-02T00:00:00.000Z' },
  ];

  const result = attributeEvidence([item], debts, scores, rejections, settings());

  assert.equal(result.length, 1);
  assert.equal(result[0]?.debtIssueId, 'debt-b');
  assert.equal(result[0]?.share, 1);
  assert.equal(shareSum(result, 'ev-rej'), 1);
});

test('§20 — rejet total : la preuve n\'est imputée à aucune dette', () => {
  const item = evidence('ev-gone', 'Auth', 'issue-gone');
  const debts = [debt('debt-a', ['Auth'])];
  const scores = [score('ev-gone', 'debt-a', 0.9)];
  const rejections: Rejection[] = [
    { evidenceId: 'ev-gone', debtIssueId: 'debt-a', rejectedBy: 'alice', at: '2026-10-02T00:00:00.000Z' },
  ];

  const result = attributeEvidence([item], debts, scores, rejections, settings());

  assert.deepEqual(result, []);
});

test('§20 — pertinence sous le seuil partout : aucune attribution (dette fantôme)', () => {
  const item = evidence('ev-low', 'Auth', 'issue-low');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-low', 'debt-a', 0.29), score('ev-low', 'debt-b', 0.1)];

  const result = attributeEvidence([item], debts, scores, [], settings());

  assert.deepEqual(result, []);
});

test('§10 — une dette sous le seuil est écartée, les autres partagent le reste', () => {
  const item = evidence('ev-mix', 'Auth', 'issue-mix');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-mix', 'debt-a', 0.8), score('ev-mix', 'debt-b', 0.2)];

  const result = attributeEvidence([item], debts, scores, [], settings());

  assert.equal(result.length, 1);
  assert.equal(result[0]?.debtIssueId, 'debt-a');
  assert.equal(result[0]?.share, 1);
});

test('§20 — normalisation exacte : la somme des parts vaut 1,00 au centième', () => {
  const item = evidence('ev-norm', 'Auth', 'issue-norm');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth']), debt('debt-c', ['Auth'])];
  const scores = [
    score('ev-norm', 'debt-a', 0.3333),
    score('ev-norm', 'debt-b', 0.3333),
    score('ev-norm', 'debt-c', 0.3334),
  ];

  const result = attributeEvidence([item], debts, scores, [], settings());

  assert.equal(result.length, 3);
  assert.equal(shareSum(result, 'ev-norm'), 1);
  for (const attribution of result) assert.ok(attribution.share > 0);
});

test('§10 — pas de double compte : deux preuves, chacune plafonnée à 100 %', () => {
  const items = [evidence('ev-1', 'Auth', 'issue-1'), evidence('ev-2', 'Auth', 'issue-2')];
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [
    score('ev-1', 'debt-a', 0.7),
    score('ev-1', 'debt-b', 0.3),
    score('ev-2', 'debt-a', 0.5),
    score('ev-2', 'debt-b', 0.5),
  ];

  const result = attributeEvidence(items, debts, scores, [], settings());

  assert.equal(result.length, 4);
  assert.equal(shareSum(result, 'ev-1'), 1);
  assert.equal(shareSum(result, 'ev-2'), 1);
});

test('§20 — déterminisme : l\'ordre de sortie est stable par preuve puis dette', () => {
  const items = [evidence('ev-b', 'Auth', 'issue-b'), evidence('ev-a', 'Auth', 'issue-a')];
  const debts = [debt('debt-b', ['Auth']), debt('debt-a', ['Auth'])];
  const scores = [
    score('ev-b', 'debt-b', 0.6),
    score('ev-b', 'debt-a', 0.6),
    score('ev-a', 'debt-b', 0.6),
    score('ev-a', 'debt-a', 0.6),
  ];

  const first = attributeEvidence(items, debts, scores, [], settings());
  const second = attributeEvidence(
    items.slice().reverse(),
    debts.slice().reverse(),
    scores.slice().reverse(),
    [],
    settings(),
  );

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((item) => `${item.evidenceId}/${item.debtIssueId}`),
    ['ev-a/debt-a', 'ev-a/debt-b', 'ev-b/debt-a', 'ev-b/debt-b'],
  );
});

test('§10 — confirmation humaine : 100 % avec l\'auteur dans la justification', () => {
  const item = evidence('ev-conf', 'Auth', 'issue-conf');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-conf', 'debt-a', 0.4), score('ev-conf', 'debt-b', 0.4)];
  const confirmations = [{ evidenceId: 'ev-conf', debtIssueId: 'debt-b', by: 'Camille' }];

  const result = attributeEvidence([item], debts, scores, [], settings(), undefined, confirmations);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.debtIssueId, 'debt-b');
  assert.equal(result[0]?.share, 1);
  assert.equal(result[0]?.basis, 'confirmed');
  assert.equal(result[0]?.relevance, 1);
  assert.equal(result[0]?.rationale, 'Rapprochement confirmé par Camille');
  assert.equal(isHighBandOnly(result[0] as NonNullable<(typeof result)[0]>), false);
});

test('§10 — un lien explicite prime sur le partage déduit', () => {
  const item = evidence('ev-prio', 'Auth', 'issue-prio');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-prio', 'debt-a', 0.9), score('ev-prio', 'debt-b', 0.8)];
  const links: IssueLink[] = [
    { fromIssueId: 'issue-prio', toIssueId: 'debt-b', toKey: 'DEBT-B', type: 'blocks' },
  ];

  const result = attributeEvidence([item], debts, scores, [], settings(), links);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.debtIssueId, 'debt-b');
  assert.equal(result[0]?.basis, 'link');
  assert.equal(result[0]?.share, 1);
});

test('§10 — un lien non explicite ne vaut pas rapprochement', () => {
  const item = evidence('ev-weak', 'Auth', 'issue-weak');
  const debts = [debt('debt-a', ['Auth'])];
  const links: IssueLink[] = [
    { fromIssueId: 'issue-weak', toIssueId: 'debt-a', toKey: 'DEBT-A', type: 'duplicates' },
  ];

  const result = attributeEvidence([item], debts, [], [], settings(), links);

  assert.deepEqual(result, []);
});

test('§10 — sans paramètre links, les liens implicites portés par les scores servent', () => {
  const item = evidence('ev-implicit', 'Auth', 'issue-implicit');
  const debts = [debt('debt-a', ['Auth']), debt('debt-b', ['Auth'])];
  const scores = [score('ev-implicit', 'debt-a', 1, 'Rapprochement évident'), score('ev-implicit', 'debt-b', 0.4)];

  const result = attributeEvidence([item], debts, scores, [], settings());

  assert.equal(result.length, 1);
  assert.equal(result[0]?.debtIssueId, 'debt-a');
  assert.equal(result[0]?.basis, 'link');
  assert.equal(result[0]?.share, 1);
  assert.equal(result[0]?.rationale, 'Rapprochement évident');
});

test('§10 — une dette d\'une autre zone n\'est jamais proposée', () => {
  const item = evidence('ev-zone', 'Auth', 'issue-zone');
  const debts = [debt('debt-other', ['Paiement'])];
  const scores = [score('ev-zone', 'debt-other', 0.99)];

  const result = attributeEvidence([item], debts, scores, [], settings());

  assert.deepEqual(result, []);
});

test('§10 — entrées vides ou incohérentes : aucune exception, résultat vide', () => {
  assert.deepEqual(attributeEvidence([], [], [], [], settings()), []);
  assert.deepEqual(attributeEvidence([evidence('ev-x', 'Auth', 'issue-x')], [], [], [], settings()), []);
  assert.deepEqual(
    attributeEvidence([evidence('ev-x', 'Auth', 'issue-x')], [debt('debt-a', ['Auth'])], [], [], settings()),
    [],
  );
});
