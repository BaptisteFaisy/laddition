import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSettings } from '../core/settings';
import type { IssueFact, ProjectSettings } from '../core/types';
import type { JiraIssueJson, JiraLink } from './jira-types';
import {
  affectedServicesOf,
  commentAuthorIds,
  isPostMortemTypeName,
  isSafeProjectKey,
  keyInJql,
  linksOfIssue,
  participantIdsOf,
  postMortemFromLinks,
  projectJql,
  quoteKey,
  serviceNamesOf,
  setServiceFieldIds,
  toIssueFact,
  withVisibility,
} from './jira-types';

/**
 * Lecteurs purs du JSON Jira : intervenants (C1), services affectés (§8, V4),
 * post-mortem (§9), visibilité (§18) et JQL (G87). Aucune I/O, donc aucun
 * mock : ces tests verrouillent le mappage tel que `forge build` l'embarque.
 */

const SETTINGS: ProjectSettings = makeSettings('10000', 'PAY');

function issue(fields: Record<string, unknown> = {}): JiraIssueJson {
  return { id: '10100', key: 'PAY-1', fields } as unknown as JiraIssueJson;
}

function fact(fields: Record<string, unknown> = {}): IssueFact {
  return toIssueFact(issue(fields), SETTINGS);
}

/* ------------------------------------------------------------- intervenants */

test('intervenants : assignés et commentateurs, sans double compte', () => {
  const fields = { assignee: { accountId: 'a1' }, assignees: [{ accountId: 'a1' }, { accountId: 'a2' }] };
  assert.deepEqual(participantIdsOf(fields, ['a2', 'a3', '']).sort(), ['a1', 'a2', 'a3']);
});

test('intervenants : le plafond reste au domaine, l’adaptateur compte', () => {
  const authors = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
  assert.equal(participantIdsOf({ assignee: { accountId: 'a9' } }, authors).length, 9);
});

test('toIssueFact code les intervenants réels, plus zéro en dur', () => {
  const fields = { issuetype: { name: 'Incident' }, assignee: { accountId: 'a1' } };
  const built = toIssueFact(issue(fields), SETTINGS, { commentAuthors: ['a1', 'a2'] });
  assert.equal(built.participants, 2);
  assert.equal(fact({}).participants, 0);
});

test('commentaires : des accountId, jamais des noms (§18, A2)', () => {
  const page = {
    comments: [
      { author: { accountId: 'a1', displayName: 'Alice' } },
      { author: { accountId: 'a1', displayName: 'Alice' } },
      { author: { displayName: 'Bob' } },
      {},
    ],
  };
  assert.deepEqual(commentAuthorIds(page), ['a1', 'a1']);
  assert.deepEqual(commentAuthorIds({}), []);
  assert.equal(JSON.stringify(commentAuthorIds(page)).includes('Alice'), false);
});

/* ---------------------------------------------------------- services JSM */

test('services affectés : objets nommés, textes, doublons écartés', () => {
  assert.deepEqual(serviceNamesOf([{ name: 'Paiement' }, { value: ' Taxes ' }, 'Facturation']), [
    'Paiement',
    'Taxes',
    'Facturation',
  ]);
  assert.deepEqual(serviceNamesOf([{ id: 'x' }]), []);
  assert.deepEqual(serviceNamesOf(undefined), []);
});

test('services affectés : lus dans le champ résolu du site, vide sinon', () => {
  const fields = { customfield_10200: [{ name: 'Paiement' }], customfield_10201: [{ name: 'Paiement' }] };
  assert.deepEqual(affectedServicesOf(fields, ['customfield_10200', 'customfield_10201']), ['Paiement']);
  // Champ introuvable sur le site (V4 non concluant) : liste vide, la cascade
  // du §8 rattache l’incident par son composant Jira.
  assert.deepEqual(affectedServicesOf(fields, []), []);
  assert.deepEqual(fact({ components: [{ name: 'pay' }] }).affectedServices, []);
});

test('toIssueFact renseigne affectedServices depuis le champ du site', () => {
  const built = toIssueFact(issue({ customfield_10200: [{ name: 'Paiement' }] }), SETTINGS, {
    serviceFieldIds: ['customfield_10200'],
  });
  assert.deepEqual(built.affectedServices, ['Paiement']);
});

test('services affectés : les champs enregistrés du site servent de défaut', () => {
  setServiceFieldIds(['customfield_10200']);
  assert.deepEqual(fact({ customfield_10200: [{ name: 'Paiement' }] }).affectedServices, ['Paiement']);
  setServiceFieldIds([]);
  assert.deepEqual(fact({ customfield_10200: [{ name: 'Paiement' }] }).affectedServices, []);
});

/* -------------------------------------------------------------- post-mortem */

function link(type: { name?: string; inward?: string; outward?: string }): JiraLink {
  return { type, outwardIssue: { id: '1', key: 'PAY-2' } };
}

test('post-mortem : type de lien « Post-incident review » ou « Review »', () => {
  assert.equal(postMortemFromLinks([link({ name: 'Post-incident review' })]), true);
  assert.equal(postMortemFromLinks([link({ name: 'review' })]), true);
  assert.equal(postMortemFromLinks([link({ name: 'Blocks' })]), false);
  assert.equal(postMortemFromLinks([]), false);
});

test('post-mortem : la phrase du lien compte, « reviewed by » ne suffit pas', () => {
  assert.equal(postMortemFromLinks([link({ name: 'Grooming', outward: 'is post-incident review of' })]), true);
  assert.equal(postMortemFromLinks([link({ name: 'Grooming', outward: 'is reviewed by' })]), false);
});

test('post-mortem : type de ticket JSM « [System] Post-incident review »', () => {
  assert.equal(isPostMortemTypeName('[System] Post-incident review'), true);
  assert.equal(isPostMortemTypeName('Post-mortem'), true);
  assert.equal(isPostMortemTypeName('Bug'), false);
  assert.equal(isPostMortemTypeName(undefined), false);
});

test('toIssueFact détecte le post-mortem porté par les liens du lot', () => {
  const links = [link({ name: 'Post-incident review' })];
  assert.equal(toIssueFact(issue({}), SETTINGS, { links }).hasPostMortem, true);
  assert.equal(toIssueFact(issue({ issuelinks: links }), SETTINGS).hasPostMortem, true);
  assert.equal(fact({}).hasPostMortem, false);
});

/* -------------------------------------------------------------- visibilité */

test('visibilité : un ticket hors de ce que voit le lecteur est masqué, pas perdu', () => {
  const facts = [fact({}), toIssueFact({ id: '2', key: 'PAY-2', fields: {} }, SETTINGS)];
  const masked = withVisibility(facts, new Set(['PAY-1']));
  assert.deepEqual(masked.map((item) => item.visible), [true, false]);
  assert.equal(masked.length, 2);
});

/* --------------------------------------------------------------------- JQL */

test('JQL : guillemets retirés, clés de projet validées (G87)', () => {
  assert.equal(quoteKey('PAY-1'), '"PAY-1"');
  assert.equal(quoteKey('PAY" OR project = "EVIL'), '"PAY OR project = EVIL"');
  assert.equal(isSafeProjectKey('PAY'), true);
  assert.equal(isSafeProjectKey('pay'), false);
  assert.equal(isSafeProjectKey('P" OR x = "y'), false);
  assert.equal(projectJql('pay'), null);
  assert.equal(projectJql('PAY', 'type = "Debt"'), 'project = "PAY" AND (type = "Debt")');
});

test('JQL : une clé qui n’est pas un ticket est écartée du lot', () => {
  assert.equal(keyInJql(['PAY-1', 'PAY-2']), 'key in ("PAY-1", "PAY-2")');
  assert.equal(keyInJql(['PAY-1', 'x") OR (project = "EVIL']), 'key in ("PAY-1")');
});

/* -------------------------------------------------------------------- liens */

test('liens : les deux arêtes d’un lien sont orientées depuis le ticket', () => {
  const found = linksOfIssue({
    id: '1',
    key: 'PAY-1',
    fields: {
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { id: '2', key: 'PAY-2' },
          outwardIssue: { id: '3', key: 'PAY-3' },
        },
      ],
    },
  });
  assert.equal(found.length, 2);
  assert.deepEqual(found[0], { fromIssueId: '1', toIssueId: '3', toKey: 'PAY-3', type: 'blocks' });
  assert.deepEqual(found[1], { fromIssueId: '1', toIssueId: '2', toKey: 'PAY-2', type: 'is blocked by' });
});

/* -------------------------------------------------------------- dette JQL */

test('règle jql : seul le marqueur posé par la recherche décide (DT-01)', () => {
  const settings = makeSettings('10000', 'PAY', { debtRule: { kind: 'jql', value: 'labels = "dette"' } });
  assert.equal(toIssueFact(issue({ labels: ['dette'] }), settings).isDebt, false);
  assert.equal(toIssueFact({ ...issue({ labels: ['dette'] }), debtJqlMatch: true }, settings).isDebt, true);
});

test('toIssueFact : le reste du contrat reste stable', () => {
  const built = fact({
    issuetype: { name: 'Incident' },
    created: '2026-10-01T10:00:00.000+0000',
    resolutiondate: '2026-10-03T10:00:00.000+0000',
    status: { statusCategory: { key: 'done' } },
    summary: 'Paiement en panne',
  });
  assert.equal(built.isIncident, true);
  assert.equal(built.isBug, false);
  assert.equal(built.closedAt, '2026-10-03T10:00:00.000+0000');
  assert.equal(built.visible, true);
  assert.equal(built.summary, 'Paiement en panne');
  assert.equal(built.historyTruncated, undefined);
});
