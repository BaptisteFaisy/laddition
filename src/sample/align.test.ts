/**
 * Tests de l'alignement des identifiants du jeu d'exemple.
 *
 * Constat du 12/11 sur le site de démo : le classement affichait PAY-77, mais
 * ouvrir le vrai ticket PAY-77 rendait « ticket 66499 inconnu » — les écrans
 * reçoivent l'identifiant Jira du ticket, le jeu d'exemple stockait un
 * identifiant fictif. L'alignement rapproche les deux, sans rien inventer :
 * une clé absente du site garde son identifiant fictif.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alignIssueIds, realIdMap } from './align';
import { buildSampleData } from './load';

const NOW = '2026-11-11T12:00:00.000Z';

describe('alignIssueIds — le jeu d’exemple parle des mêmes tickets que les écrans', () => {
  it('remplace l’identifiant fictif par l’identifiant Jira réel', async () => {
    const data = buildSampleData(NOW);
    const debt = data.facts.find((fact) => fact.key === 'PAY-77');
    assert.ok(debt, 'le jeu contient la dette PAY-77');

    const aligned = await alignIssueIds(data, async (key) => (key === 'PAY-77' ? '10001' : null));

    const real = aligned.facts.find((fact) => fact.key === 'PAY-77');
    assert.equal(real?.issueId, '10001', 'la fiche porte l’identifiant réel');
    assert.equal(
      aligned.attributions.filter((item) => item.debtIssueId === '10001').length > 0,
      true,
      'les parts d’attribution visent la dette réelle',
    );
    assert.equal(
      aligned.evidence.some((item) => item.sourceIssueId === debt.issueId),
      false,
      'plus aucune preuve ne pointe vers l’ancien identifiant de ce ticket',
    );
  });

  it('suit aussi les séjours de statut et les liens Jira', async () => {
    const data = buildSampleData(NOW);
    const withSpan = data.facts.find((fact) => data.spans.some((span) => span.issueId === fact.issueId));
    const withLink = data.facts.find(
      (fact) => fact.issueId !== withSpan?.issueId && data.links.some((link) => link.fromIssueId === fact.issueId),
    );
    assert.ok(withSpan && withLink, 'le jeu contient des séjours et des liens');

    const aligned = await alignIssueIds(data, async (key) => {
      if (key === withSpan.key) return '20001';
      if (key === withLink.key) return '20002';
      return null;
    });

    assert.equal(aligned.spans.filter((span) => span.issueId === '20001').length > 0, true);
    assert.equal(aligned.links.some((link) => link.fromIssueId === '20002'), true);
    assert.equal(aligned.spans.some((span) => span.issueId === withSpan.issueId), false, 'ancien identifiant effacé');
  });

  it('laisse les tickets absents du site avec leur identifiant fictif', async () => {
    const data = buildSampleData(NOW);
    const aligned = await alignIssueIds(data, async () => null);
    assert.deepEqual(aligned.facts, data.facts);
    assert.deepEqual(aligned.links, data.links);
  });

  it('ne résout pas deux fois le même ticket', async () => {
    const data = buildSampleData(NOW);
    const asked: string[] = [];
    await realIdMap(data.facts, async (key) => {
      asked.push(key);
      return null;
    });
    assert.equal(new Set(asked).size, asked.length, 'chaque clé n’est demandée qu’une fois');
  });
});
