import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueFact, Repayment, StatusSpan } from '../core/types';
import type { ZoneWeek } from '../core/repayment';
import { weekKey } from '../core/time';
import type { RepaymentPorts } from './repayments';
import { groupByZoneMonth, publishProjectRepayments, reopenedWithBulletin, zoneMonthKey } from './repayments';
import { repaymentCommentText, withdrawalCommentText } from './repaymentComment';
import { makeFact, makeRepayment } from './testFixtures';

/**
 * B17, B18, B19 — le bulletin vit sur le ticket.
 *
 * §7.5 : « Huit semaines plus tard, un commentaire est publié sur le ticket. »
 * §19 cas 8 : une dette rouverte voit son bulletin **retiré**.
 * §19 cas 9 : plusieurs dettes closes sur la même zone le même mois donnent
 * **un** bulletin commun (`mergeMonthlyRepayments`, qui n'avait aucun appelant).
 */

const NOW = '2026-04-20T02:00:00.000Z';

function closedDebt(id: string, key: string, zone: string, closedAt: string): IssueFact {
  return makeFact({
    issueId: id,
    key,
    zones: [zone],
    components: [zone],
    createdAt: '2026-01-05T09:00:00.000Z',
    resolvedAt: closedAt,
    closedAt,
    isDebt: true,
  });
}

/** Double des ports : tout est en mémoire, rien n'appelle Forge ni Jira. */
function fakePorts(debts: IssueFact[], published: Repayment[] = []) {
  const saved: Repayment[][] = [];
  const removed: string[] = [];
  const comments: Array<{ key: string; body: string }> = [];
  const ports: RepaymentPorts = {
    listDebts: async () => debts,
    listPublished: async () => published,
    listSpans: async (): Promise<StatusSpan[]> => [],
    zoneSeries: async (_projectId, _zone, weeks) => series(weeks),
    save: async (_projectId, repayments) => {
      saved.push([...repayments]);
    },
    remove: async (_projectId, debtIssueId) => {
      removed.push(debtIssueId);
    },
    publish: async (issueKey, body) => {
      comments.push({ key: issueKey, body });
    },
  };
  return { ports, saved, removed, comments };
}

/** Coût hebdomadaire : 4 j-p avant la clôture, 1 j-p après (l'écart attendu). */
function series(weeks: string[]): ZoneWeek[] {
  const pivot = weekKey('2026-02-02T17:00:00.000Z');
  return weeks.map((week) => ({ week, costJp: week < pivot ? 4 : 1 }));
}

test('B18 — deux dettes closes sur la même zone le même mois : un bulletin commun', async () => {
  const debts = [
    closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z'),
    closedDebt('d2', 'PAY-2', 'facturation', '2026-02-20T17:00:00.000Z'),
  ];
  const { ports, saved, comments } = fakePorts(debts);
  const outcome = await publishProjectRepayments('p1', NOW, ports);

  assert.equal(outcome.groups, 1, 'une seule zone, un seul mois : un seul groupe');
  assert.equal(saved.length, 1);
  const rows = saved[0] ?? [];
  assert.equal(rows.length, 2, 'le bulletin commun est porté par chaque ticket du groupe');
  assert.equal(new Set(rows.map((row) => row.beforeRate)).size, 1, 'mêmes chiffres pour tout le groupe');
  assert.equal(comments.length, 2, 'chaque ticket reçoit le bulletin');
  assert.equal(comments[0]?.body, comments[1]?.body);
  assert.match(comments[0]?.body ?? '', /Avant : 4/);
  assert.match(comments[0]?.body ?? '', /Après : 1/);
});

test('B19 — le commentaire porte les limites, jamais une causalité', async () => {
  const debts = [closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z')];
  const { ports, comments } = fakePorts(debts);
  await publishProjectRepayments('p1', NOW, ports);
  const body = comments[0]?.body ?? '';
  assert.match(body, /sans preuve de causalité/);
  assert.match(body, /zone « facturation »/);
});

test('B17 — dette rouverte : le bulletin est retiré et le ticket prévenu', async () => {
  const reopened = makeFact({ issueId: 'd4', key: 'PAY-4', zones: ['facturation'], isDebt: true });
  const published = [makeRepayment({ debtIssueId: 'd4', key: 'PAY-4', publishedAt: '2026-03-01T02:00:00.000Z' })];
  const { ports, removed, comments } = fakePorts([reopened], published);
  const outcome = await publishProjectRepayments('p1', NOW, ports);

  assert.equal(outcome.removed, 1);
  assert.deepEqual(removed, ['d4']);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.key, 'PAY-4');
  assert.match(comments[0]?.body ?? '', /retiré/);
});

test('un bulletin déjà publié et à jour n’est pas republié (pas de commentaire en boucle)', async () => {
  const debt = closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z');
  const published = [
    makeRepayment({ debtIssueId: 'd1', key: 'PAY-1', publishedAt: '2026-04-13T02:00:00.000Z' }),
  ];
  const { ports, comments, saved } = fakePorts([debt], published);
  const outcome = await publishProjectRepayments('p1', NOW, ports);
  assert.equal(outcome.published, 0);
  assert.deepEqual(comments, []);
  assert.deepEqual(saved, []);
});

test('reopenedWithBulletin ne retient que les dettes rouvertes déjà publiées', () => {
  const reopened = makeFact({ issueId: 'd4', key: 'PAY-4' });
  const closed = closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z');
  const neverPublished = makeFact({ issueId: 'd5', key: 'PAY-5' });
  const published = [makeRepayment({ debtIssueId: 'd4' }), makeRepayment({ debtIssueId: 'd1' })];
  const found = reopenedWithBulletin([reopened, closed, neverPublished], published);
  assert.deepEqual(found.map((debt) => debt.issueId), ['d4']);
});

test('groupByZoneMonth sépare les zones et les mois', () => {
  const debts = [
    closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z'),
    closedDebt('d2', 'PAY-2', 'facturation', '2026-02-20T17:00:00.000Z'),
    closedDebt('d3', 'PAY-3', 'notifications', '2026-02-10T17:00:00.000Z'),
    closedDebt('d6', 'PAY-6', 'facturation', '2026-03-04T17:00:00.000Z'),
    makeFact({ issueId: 'd7', key: 'PAY-7', isDebt: true }),
  ];
  const groups = groupByZoneMonth(debts);
  assert.equal(groups.length, 3, 'la dette ouverte n’a pas de groupe');
  assert.deepEqual(groups[0]?.map((debt) => debt.key), ['PAY-1', 'PAY-2']);
});

test('zoneMonthKey : la zone et le mois de clôture', () => {
  const debt = closedDebt('d1', 'PAY-1', 'facturation', '2026-02-02T17:00:00.000Z');
  assert.equal(zoneMonthKey(debt), 'facturation\u00002026-02');
  assert.notEqual(
    zoneMonthKey(debt),
    zoneMonthKey(closedDebt('d3', 'PAY-3', 'facturation', '2026-03-02T17:00:00.000Z')),
    'deux mois ne partagent pas la même clé',
  );
});

test('le texte du bulletin annonce l’absence de coût quand la zone est calme', () => {
  const body = repaymentCommentText(makeRepayment({ afterRate: 0 }));
  assert.match(body, /Aucun incident relevé sur la zone depuis la clôture/);
});

test('le texte de retrait nomme la dette rouverte', () => {
  assert.match(withdrawalCommentText('PAY-4'), /PAY-4 a été rouverte/);
});
