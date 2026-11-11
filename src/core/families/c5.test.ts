import assert from 'node:assert/strict';
import test from 'node:test';
import type { CostContext, Evidence, IssueFact, IssueLink } from '../types';
import { BILLED_FAMILIES } from '../types';
import { makeSettings } from '../settings';
import { c5Delay } from './c5';

/** Instant de référence des tests (mercredi). */
const NOW = '2026-11-11T00:00:00.000Z';

/** Ticket minimal, surchargé au cas par cas. */
function makeFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'D-1',
    key: 'ADD-9',
    projectId: 'p1',
    projectKey: 'ADD',
    type: 'Task',
    isBug: false,
    isIncident: false,
    isDebt: true,
    zones: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    resolvedAt: '2026-11-01T00:00:00.000Z',
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: ['tech-debt'],
    components: ['api'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'Ticket de dette',
    ...overrides,
  };
}

/** Ticket de dette (bloquant). */
function makeDebt(): IssueFact {
  return makeFact();
}

/** Ticket bloqué par la dette, résolu le 06/11. */
function makeBlocked(overrides: Partial<IssueFact> = {}): IssueFact {
  return makeFact({
    issueId: 'B-2',
    key: 'ADD-2',
    isDebt: false,
    labels: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    resolvedAt: '2026-11-06T00:00:00.000Z',
    summary: 'Ticket bloqué',
    ...overrides,
  });
}

/** Lien « blocks » de la dette vers le ticket bloqué. */
function makeLink(overrides: Partial<IssueLink> = {}): IssueLink {
  return { fromIssueId: 'D-1', toIssueId: 'B-2', toKey: 'ADD-2', type: 'blocks', ...overrides };
}

/** Contexte de calcul minimal (C5 ne lit pas les séjours de statut). */
function makeCtx(): CostContext {
  return { settings: makeSettings('p1', 'ADD'), now: NOW, baselines: new Map(), spansByIssue: new Map() };
}

/** Unique preuve attendue. */
function only(evidence: Evidence[]): Evidence {
  assert.equal(evidence.length, 1);
  return evidence[0] as Evidence;
}

test('un lien blocks depuis un ticket de dette produit une preuve de retard', () => {
  const evidence = only(c5Delay([makeDebt(), makeBlocked()], makeCtx(), [makeLink()]));

  assert.equal(evidence.id, 'C5:B-2:api');
  assert.equal(evidence.zone, 'api');
  assert.equal(evidence.family, 'C5');
  assert.equal(evidence.sourceIssueId, 'B-2');
  assert.equal(evidence.sourceKey, 'ADD-2');
  assert.equal(evidence.occurredAt, '2026-11-01T00:00:00.000Z');
  // 01/11 → 06/11 : 5 jours calendaires de retard.
  assert.equal(evidence.costJp, 5);
  assert.equal(evidence.detail.durationDays, 5);
  assert.equal(evidence.detail.familyLabel, 'Retard induit (hors addition)');
});

test('un lien d’un autre type est ignoré', () => {
  const facts = [makeDebt(), makeBlocked()];
  const relates = makeLink({ type: 'relates to' });
  const caused = makeLink({ type: 'caused by' });
  assert.deepEqual(c5Delay(facts, makeCtx(), [relates, caused]), []);
});

test('un lien dont l’origine n’est pas un ticket de dette est ignoré', () => {
  const debt = makeFact({ isDebt: false, labels: [] });
  assert.deepEqual(c5Delay([debt, makeBlocked()], makeCtx(), [makeLink()]), []);
});

test('un ticket bloqué non résolu est compté jusqu’à now', () => {
  const blocked = makeBlocked({ resolvedAt: null });
  const evidence = only(c5Delay([makeDebt(), blocked], makeCtx(), [makeLink()]));

  // 01/11 → 11/11 : 10 jours calendaires, blocage toujours en cours.
  assert.equal(evidence.costJp, 10);
});

test('C5 est marqué hors addition', () => {
  const evidence = only(c5Delay([makeDebt(), makeBlocked()], makeCtx(), [makeLink()]));

  assert.equal(evidence.detail.inputs.delai, true);
  assert.equal(evidence.detail.familyLabel, 'Retard induit (hors addition)');
  assert.equal(BILLED_FAMILIES.includes('C5'), false);
});

test('le retard d’un ticket multi-zones est partagé à parts égales', () => {
  const blocked = makeBlocked({ components: ['api', 'web'] });
  const evidence = c5Delay([makeDebt(), blocked], makeCtx(), [makeLink()]);

  assert.equal(evidence.length, 2);
  assert.deepEqual(
    evidence.map((item) => item.id).sort(),
    ['C5:B-2:api', 'C5:B-2:web'],
  );
  const total = evidence.reduce((sum, item) => sum + item.costJp, 0);
  assert.equal(Math.round(total * 100) / 100, 5);
  for (const item of evidence) assert.equal(item.detail.inputs.delai, true);
});

test('un lien sans ticket bloqué connu est ignoré', () => {
  const orphan = makeLink({ toIssueId: 'INCONNU' });
  assert.deepEqual(c5Delay([makeDebt()], makeCtx(), [orphan]), []);
});

test('le calcul est déterministe', () => {
  const facts = [makeDebt(), makeBlocked()];
  const links = [makeLink()];
  const ctx = makeCtx();

  const first = c5Delay(facts, ctx, links);
  const second = c5Delay(facts, ctx, links);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((item) => item.id),
    ['C5:B-2:api'],
  );
});
