import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueFact, Repayment } from './types';
import { addDays, weekKey } from './time';
import type { ZoneWeek } from './repayment';
import {
  CAVEAT_COMPARISON,
  CAVEAT_INSUFFICIENT_RECUL,
  CAVEAT_OTHER_CHANGES,
  buildRepayment,
  isRepaymentStale,
  mergeMonthlyRepayments,
  repaymentCaveats,
  sampleCaveat,
} from './repayment';

/** Lundi 2 mars 2026 : ancre des semaines « avant ». */
const WORK_START = '2026-03-02T00:00:00.000Z';
/** Vendredi 13 mars 2026 : clôture, dans la semaine du lundi 9 mars. */
const CLOSED_AT = '2026-03-13T16:00:00.000Z';
const NOW = '2026-06-01T00:00:00.000Z';

function makeDebt(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'd-1',
    key: 'ABC-1',
    projectId: 'p-1',
    projectKey: 'ABC',
    type: 'Tâche',
    isBug: false,
    isIncident: false,
    isDebt: true,
    zones: ['paiement'],
    createdAt: '2026-01-05T09:00:00.000Z',
    resolvedAt: CLOSED_AT,
    closedAt: CLOSED_AT,
    size: 'm',
    estimateJp: 2,
    loggedSeconds: null,
    labels: [],
    components: ['paiement'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 2,
    visible: true,
    summary: 'Refonte du module de paiement',
    ...overrides,
  };
}

/** Série hebdomadaire : `offsets` semaines relatives à l'ancre, coût par rang. */
function weeksFrom(anchorIso: string, offsets: number[], costOf: (index: number) => number): ZoneWeek[] {
  const anchor = weekKey(anchorIso);
  return offsets.map((offset, index) => ({
    week: weekKey(addDays(anchor, offset * 7)),
    costJp: costOf(index),
  }));
}

/** Les 8 semaines strictement avant le travail, coûts 1 à 8. */
function beforeWeeks(): ZoneWeek[] {
  return weeksFrom(WORK_START, [-8, -7, -6, -5, -4, -3, -2, -1], (index) => index + 1);
}

/** Les 8 semaines strictement après la clôture, coût constant. */
function afterWeeks(cost: number, count = 8): ZoneWeek[] {
  const offsets = Array.from({ length: count }, (_unused, index) => index + 1);
  return weeksFrom(CLOSED_AT, offsets, () => cost);
}

function makePublished(overrides: Partial<Repayment> = {}): Repayment {
  return {
    debtIssueId: 'd-1',
    key: 'ABC-1',
    zone: 'paiement',
    closedAt: CLOSED_AT,
    beforeRate: 4.5,
    afterRate: 2,
    weeksBefore: 8,
    weeksAfter: 8,
    caveats: [],
    publishedAt: '2026-03-20T00:00:00.000Z',
    ...overrides,
  };
}

test('bulletin : moyenne exacte sur 8 semaines avant et 8 après', () => {
  // Semaines hors fenêtre : la semaine du travail et celle de la clôture, très
  // coûteuses, ne doivent pas entrer dans les moyennes (strictement avant/après).
  const decoys: ZoneWeek[] = [
    ...weeksFrom(WORK_START, [0], () => 999),
    ...weeksFrom(CLOSED_AT, [0], () => 999),
    ...weeksFrom(WORK_START, [-9], () => 500),
  ];
  const repayment = buildRepayment(makeDebt(), [...beforeWeeks(), ...afterWeeks(2), ...decoys], CLOSED_AT, WORK_START);

  assert.equal(repayment.beforeRate, 4.5);
  assert.equal(repayment.afterRate, 2);
  assert.equal(repayment.weeksBefore, 8);
  assert.equal(repayment.weeksAfter, 8);
  assert.deepEqual(repayment.caveats, [CAVEAT_COMPARISON, CAVEAT_OTHER_CHANGES, 'échantillon de 16 semaines']);
  assert.equal(repayment.publishedAt, null);
  assert.equal(repayment.debtIssueId, 'd-1');
  assert.equal(repayment.key, 'ABC-1');
  assert.equal(repayment.zone, 'paiement');
  assert.equal(repayment.closedAt, CLOSED_AT);
});

test('bulletin : recul insuffisant sous 4 semaines après la clôture', () => {
  const repayment = buildRepayment(makeDebt(), [...beforeWeeks(), ...afterWeeks(1, 3)], CLOSED_AT, WORK_START);

  assert.equal(repayment.weeksAfter, 3);
  assert.equal(repayment.afterRate, 1);
  assert.equal(repayment.weeksBefore, 8);
  assert.ok(repayment.caveats.includes(CAVEAT_INSUFFICIENT_RECUL));
  assert.ok(repayment.caveats.includes('échantillon de 11 semaines'));
  assert.ok(repayment.caveats.includes(CAVEAT_COMPARISON));
});

test('bulletin : échantillon partiel, moyenne sur les seules semaines observées', () => {
  const before = weeksFrom(WORK_START, [-5, -4, -3, -2, -1], (index) => [2, 4, 6, 8, 10][index] as number);
  const repayment = buildRepayment(makeDebt(), [...before, ...afterWeeks(3, 4)], CLOSED_AT, WORK_START);

  assert.equal(repayment.weeksBefore, 5);
  assert.equal(repayment.beforeRate, 6);
  assert.equal(repayment.weeksAfter, 4);
  assert.equal(repayment.afterRate, 3);
  assert.ok(!repayment.caveats.includes(CAVEAT_INSUFFICIENT_RECUL));
  assert.ok(repayment.caveats.includes('échantillon de 9 semaines'));
});

test('bulletin : aucune donnée hebdomadaire → taux nuls et zéro semaine', () => {
  const repayment = buildRepayment(makeDebt(), [], CLOSED_AT, WORK_START);

  assert.equal(repayment.beforeRate, 0);
  assert.equal(repayment.afterRate, 0);
  assert.equal(repayment.weeksBefore, 0);
  assert.equal(repayment.weeksAfter, 0);
  assert.deepEqual(repayment.caveats, [
    CAVEAT_COMPARISON,
    CAVEAT_OTHER_CHANGES,
    'échantillon de 0 semaine',
    CAVEAT_INSUFFICIENT_RECUL,
  ]);
});

test('bulletin : deux entrées sur la même semaine s’additionnent', () => {
  const duplicated: ZoneWeek[] = [
    { week: weekKey(addDays(weekKey(WORK_START), -7)), costJp: 1 },
    { week: weekKey(addDays(weekKey(WORK_START), -7)), costJp: 2 },
  ];
  const repayment = buildRepayment(makeDebt(), duplicated, CLOSED_AT, WORK_START);

  assert.equal(repayment.weeksBefore, 1);
  assert.equal(repayment.beforeRate, 3);
});

test('bulletin : zone de repli « non classé » et zone vide ignorée', () => {
  const unclassified = buildRepayment(makeDebt({ zones: [] }), beforeWeeks(), CLOSED_AT, WORK_START);
  const blank = buildRepayment(makeDebt({ zones: ['  ', 'infra'] }), beforeWeeks(), CLOSED_AT, WORK_START);

  assert.equal(unclassified.zone, 'non classé');
  assert.equal(blank.zone, 'infra');
});

test('limites : échantillon au singulier et recul calculé', () => {
  assert.equal(sampleCaveat(0), 'échantillon de 0 semaine');
  assert.equal(sampleCaveat(1), 'échantillon de 1 semaine');
  assert.equal(sampleCaveat(16), 'échantillon de 16 semaines');
  assert.deepEqual(repaymentCaveats(8, 8), [CAVEAT_COMPARISON, CAVEAT_OTHER_CHANGES, 'échantillon de 16 semaines']);
  assert.deepEqual(repaymentCaveats(8, 3), [
    CAVEAT_COMPARISON,
    CAVEAT_OTHER_CHANGES,
    'échantillon de 11 semaines',
    CAVEAT_INSUFFICIENT_RECUL,
  ]);
});

test('péremption : dette rouverte après publication → bulletin périmé', () => {
  const published = makePublished();
  const reopened = makeDebt({ resolvedAt: null, closedAt: null });

  assert.equal(isRepaymentStale(reopened, published, NOW), true);
  assert.equal(isRepaymentStale(makeDebt(), published, NOW), false);
  assert.equal(isRepaymentStale(reopened, null, NOW), false);
  assert.equal(isRepaymentStale(reopened, makePublished({ publishedAt: null }), NOW), false);
});

test('péremption : clôture postérieure à la publication, ou publication à venir', () => {
  const published = makePublished();
  const reclosed = makeDebt({ resolvedAt: '2026-04-02T10:00:00.000Z', closedAt: '2026-04-02T10:00:00.000Z' });

  assert.equal(isRepaymentStale(reclosed, published, NOW), true);
  // Bulletin daté dans le futur : il n'existe pas encore, rien à périmer.
  assert.equal(isRepaymentStale(makeDebt({ resolvedAt: null }), published, '2026-03-10T00:00:00.000Z'), false);
});

test('fusion mensuelle : deux dettes de la même zone le même mois → un bulletin', () => {
  const first: Repayment = makePublished({
    debtIssueId: 'd-7',
    key: 'ABC-7',
    closedAt: '2026-03-13T10:00:00.000Z',
    beforeRate: 4,
    afterRate: 1,
    weeksBefore: 8,
    weeksAfter: 8,
  });
  const second: Repayment = makePublished({
    debtIssueId: 'd-3',
    key: 'ABC-3',
    closedAt: '2026-03-27T10:00:00.000Z',
    beforeRate: 2,
    afterRate: 3,
    weeksBefore: 4,
    weeksAfter: 4,
    caveats: ['données manquantes en février'],
  });

  const merged = mergeMonthlyRepayments([first, second]);

  assert.equal(merged.length, 1);
  const bulletin = merged[0] as Repayment;
  assert.equal(bulletin.key, 'ABC-3');
  assert.equal(bulletin.debtIssueId, 'd-3');
  assert.equal(bulletin.zone, 'paiement');
  assert.equal(bulletin.weeksBefore, 12);
  assert.equal(bulletin.weeksAfter, 12);
  // (4 × 8 + 2 × 4) / 12 = 3,33 ; (1 × 8 + 3 × 4) / 12 = 1,67
  assert.equal(bulletin.beforeRate, 3.33);
  assert.equal(bulletin.afterRate, 1.67);
  assert.deepEqual(bulletin.caveats, [
    CAVEAT_COMPARISON,
    CAVEAT_OTHER_CHANGES,
    'échantillon de 24 semaines',
    'données manquantes en février',
  ]);
  // Les deux bulletins partagent la même date de publication : elle est conservée.
  assert.equal(bulletin.publishedAt, '2026-03-20T00:00:00.000Z');
});

test('fusion mensuelle : dates de publication divergentes → bulletin à republier', () => {
  const first = makePublished({ key: 'ABC-1' });
  const second = makePublished({ key: 'ABC-2', publishedAt: '2026-03-21T00:00:00.000Z' });

  const merged = mergeMonthlyRepayments([first, second]);

  assert.equal(merged.length, 1);
  assert.equal((merged[0] as Repayment).publishedAt, null);
});

test('fusion mensuelle : limites fusionnées sans doublon', () => {
  const first = makePublished({ key: 'ABC-1', weeksAfter: 2, caveats: ['recul insuffisant', 'lot livré en retard'] });
  const second = makePublished({ key: 'ABC-2', weeksAfter: 1, caveats: ['recul insuffisant', 'lot livré en retard'] });

  const merged = mergeMonthlyRepayments([first, second]);
  const bulletin = merged[0] as Repayment;
  const unique = new Set(bulletin.caveats);

  assert.equal(merged.length, 1);
  // 8 + 8 semaines avant, 2 + 1 après : le recul reste insuffisant.
  assert.equal(bulletin.weeksAfter, 3);
  assert.deepEqual(bulletin.caveats, [
    CAVEAT_COMPARISON,
    CAVEAT_OTHER_CHANGES,
    'échantillon de 19 semaines',
    CAVEAT_INSUFFICIENT_RECUL,
    'lot livré en retard',
  ]);
  assert.equal(bulletin.caveats.length, unique.size);
});

test('fusion mensuelle : zones et mois différents restent séparés', () => {
  const marchPayment = makePublished({ key: 'ABC-1' });
  const aprilPayment = makePublished({ key: 'ABC-2', closedAt: '2026-04-10T10:00:00.000Z' });
  const marchInfra = makePublished({ key: 'ABC-3', zone: 'infra' });

  const merged = mergeMonthlyRepayments([marchPayment, aprilPayment, marchInfra]);

  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((item) => `${item.zone}/${item.closedAt.slice(0, 7)}`),
    ['infra/2026-03', 'paiement/2026-03', 'paiement/2026-04'],
  );
  // Un bulletin seul traverse la fusion sans être modifié.
  assert.deepEqual(merged[1], marchPayment);
});

test('fusion mensuelle : liste vide et bulletin isolé', () => {
  const only = makePublished();
  assert.deepEqual(mergeMonthlyRepayments([]), []);
  assert.deepEqual(mergeMonthlyRepayments([only]), [only]);
});
