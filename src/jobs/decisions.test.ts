import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Attribution, Rejection } from '../core/types';
import { attributeEvidence } from '../core/attribution';
import { preserveLinks } from './decisions';
import { makeEvidence, makeFact, makeSettings } from './testFixtures';

/**
 * B15 — une décision humaine ne détruit rien.
 *
 * `rebuild` ne relit pas Jira : avant le correctif, il rejouait l'attribution
 * avec `links: []`, donc **toutes** les parts fondées sur un lien Jira
 * disparaissaient dès qu'un utilisateur confirmait ou rejetait un
 * rapprochement. La fourchette basse s'effondrait : la recette §20 n°1 (un bug
 * lié compte à 100 % dans la fourchette basse) était cassée par la n°3 (un
 * rejet retire la preuve). Les liens sont désormais reconstruits depuis les
 * attributions `link` enregistrées.
 */

const SETTINGS = makeSettings('p1', 'PAY');

const DEBT = makeFact({ issueId: 'd1', key: 'PAY-77', isDebt: true, zones: ['facturation'] });

const EVIDENCE = makeEvidence({ id: 'C1:i9:facturation', sourceIssueId: 'i9', zone: 'facturation' });

function attribution(overrides: Partial<Attribution> = {}): Attribution {
  return {
    evidenceId: EVIDENCE.id,
    debtIssueId: DEBT.issueId,
    share: 1,
    basis: 'link',
    relevance: 1,
    rationale: 'Lien Jira explicite (relates to)',
    ...overrides,
  };
}

test('preserveLinks reconstruit le lien Jira d’une attribution `link`', () => {
  const links = preserveLinks([attribution()], [EVIDENCE], [DEBT]);
  assert.deepEqual(links, [
    { fromIssueId: 'i9', toIssueId: 'd1', toKey: 'PAY-77', type: 'relates to' },
  ]);
});

test('preserveLinks retrouve le type de lien écrit dans la justification', () => {
  const links = preserveLinks(
    [attribution({ rationale: 'Lien Jira explicite (caused by)' })],
    [EVIDENCE],
    [DEBT],
  );
  assert.equal(links[0]?.type, 'caused by');
});

test('preserveLinks retombe sur un type explicite si la justification est inconnue', () => {
  const links = preserveLinks([attribution({ rationale: 'repris de l’ancienne nuit' })], [EVIDENCE], [DEBT]);
  assert.equal(links[0]?.type, 'relates to');
});

test('preserveLinks ignore les parts confirmées et rapprochées', () => {
  const attributions = [
    attribution({ basis: 'confirmed', rationale: 'Rapprochement confirmé par alice' }),
    attribution({ basis: 'inferred', relevance: 0.6, rationale: 'même zone' }),
  ];
  assert.deepEqual(preserveLinks(attributions, [EVIDENCE], [DEBT]), []);
});

test('preserveLinks saute ce qu’il ne peut pas relier (preuve ou dette absente)', () => {
  assert.deepEqual(preserveLinks([attribution()], [], [DEBT]), []);
  assert.deepEqual(preserveLinks([attribution()], [EVIDENCE], []), []);
});

test('rejouer l’attribution garde le lien à 100 % dans la fourchette basse', () => {
  const attributions = [attribution()];
  const links = preserveLinks(attributions, [EVIDENCE], [DEBT]);
  const result = attributeEvidence([EVIDENCE], [DEBT], [], [], SETTINGS, links, []);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.basis, 'link');
  assert.equal(result[0]?.share, 1);
});

test('rejet d’un rapprochement : la preuve quitte l’addition, le lien reste', () => {
  const other = makeFact({ issueId: 'd2', key: 'PAY-78', isDebt: true, zones: ['facturation'] });
  const attributions = [
    attribution(),
    attribution({ debtIssueId: 'd2', basis: 'inferred', share: 0.6, relevance: 0.6, rationale: 'même zone' }),
  ];
  const rejections: Rejection[] = [
    { evidenceId: EVIDENCE.id, debtIssueId: 'd2', rejectedBy: 'alice', at: '2026-03-01T10:00:00.000Z' },
  ];
  const links = preserveLinks(attributions, [EVIDENCE], [DEBT, other]);
  const scores = [
    {
      evidenceId: EVIDENCE.id,
      debtIssueId: 'd2',
      relevance: 0.6,
      rationale: 'même zone',
      fingerprint: 'f1',
    },
  ];
  const result = attributeEvidence([EVIDENCE], [DEBT, other], scores, rejections, SETTINGS, links, []);
  assert.equal(result.length, 1, 'la preuve rejetée ne doit plus être proposée');
  assert.equal(result[0]?.debtIssueId, 'd1');
  assert.equal(result[0]?.basis, 'link');
  assert.equal(result[0]?.share, 1);
});

test('confirmation d’un rapprochement : la part passe en base basse, les liens voisins restent', () => {
  const other = makeFact({ issueId: 'd2', key: 'PAY-78', isDebt: true, zones: ['facturation'] });
  const secondEvidence = makeEvidence({
    id: 'C2:i8:facturation',
    sourceIssueId: 'i8',
    family: 'C2',
  });
  const attributions = [attribution()];
  const links = preserveLinks(attributions, [EVIDENCE, secondEvidence], [DEBT, other]);
  const result = attributeEvidence(
    [EVIDENCE, secondEvidence],
    [DEBT, other],
    [],
    [],
    SETTINGS,
    links,
    [{ evidenceId: secondEvidence.id, debtIssueId: 'd2' }],
  );
  const byEvidence = new Map(result.map((item) => [item.evidenceId, item]));
  assert.equal(byEvidence.get(EVIDENCE.id)?.basis, 'link');
  assert.equal(byEvidence.get(secondEvidence.id)?.basis, 'confirmed');
});
