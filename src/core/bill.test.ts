import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  Attribution,
  AttributionBasis,
  CostContext,
  Evidence,
  IssueFact,
  ProjectSettings,
} from './types';
import { makeSettings } from './settings';
import { buildBill } from './bill';

const NOW = '2026-11-11T09:00:00.000Z';

const SETTINGS: ProjectSettings = makeSettings('p1', 'PROJ');

/** Contexte de calcul minimal : réglages, instant figé, aucun historique. */
const CTX: CostContext = {
  settings: SETTINGS,
  now: NOW,
  baselines: new Map(),
  spansByIssue: new Map(),
};

const BASE_DEBT: IssueFact = {
  issueId: 'D1',
  key: 'PROJ-1',
  projectId: 'p1',
  projectKey: 'PROJ',
  type: 'Story',
  isBug: false,
  isIncident: false,
  isDebt: true,
  zones: ['api'],
  createdAt: '2026-01-05T08:00:00.000Z',
  resolvedAt: null,
  closedAt: null,
  size: 'm',
  estimateJp: 20,
  loggedSeconds: null,
  labels: ['tech-debt'],
  components: ['api'],
  affectedServices: [],
  hasPostMortem: false,
  participants: 2,
  visible: true,
  summary: 'Rapatrier la validation dans la couche domaine',
};

const BASE_EVIDENCE: Omit<Evidence, 'id'> = {
  zone: 'api',
  family: 'C1',
  sourceIssueId: 'S1',
  sourceKey: 'OPS-1',
  occurredAt: '2026-02-01T10:00:00.000Z',
  costJp: 1,
  method: 'logged',
  visible: true,
  detail: {
    durationDays: 1,
    method: 'logged',
    formula: '1 j-p saisi sur OPS-1',
    inputs: {},
    familyLabel: 'Incidents',
  },
};

/** Ticket de dette, surchargeable champ par champ. */
function debtFact(partial: Partial<IssueFact> = {}): IssueFact {
  return { ...BASE_DEBT, ...partial };
}

/** Preuve, surchargeable champ par champ. */
function evidence(partial: Partial<Evidence> & { id: string }): Evidence {
  return { ...BASE_EVIDENCE, ...partial };
}

/** Attribution d'une preuve à un ticket de dette. */
function attribution(
  evidenceId: string,
  share: number,
  basis: AttributionBasis,
  debtIssueId = 'D1',
): Attribution {
  return { evidenceId, debtIssueId, share, basis, relevance: 1, rationale: 'lien Jira direct' };
}

test('addition basse = faits, addition haute = faits + rapprochements inférés', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', family: 'C1', costJp: 10 }), evidence({ id: 'E2', family: 'C2', costJp: 6 })],
    [attribution('E1', 1, 'link'), attribution('E2', 0.5, 'inferred')],
    CTX,
  );

  assert.equal(bill.lowJp, 10); // 10 × 1
  assert.equal(bill.highJp, 13); // 10 + 6 × 0,5
  assert.deepEqual(bill.byFamily.C1, { lowJp: 10, highJp: 10, evidenceCount: 1, insufficient: false });
  assert.deepEqual(bill.byFamily.C2, { lowJp: 0, highJp: 3, evidenceCount: 1, insufficient: false });
  assert.deepEqual(bill.evidenceIds, ['E1', 'E2']);
  assert.equal(bill.hiddenCount, 0);
  assert.equal(bill.computedAt, NOW);
  assert.equal(bill.key, 'PROJ-1');
  assert.equal(bill.debtIssueId, 'D1');
});

test('le retour et le délai de retour découlent de l’addition et de l’estimation', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 }), evidence({ id: 'E2', family: 'C2', costJp: 6 })],
    [attribution('E1', 1, 'link'), attribution('E2', 0.5, 'inferred')],
    CTX,
  );

  assert.equal(bill.repaymentJp, 20);
  assert.equal(bill.avoidableJp, 14); // 10 × 2 × 0,7
  assert.equal(bill.roiLow, 0.7); // 14 / 20
  assert.equal(bill.roiHigh, 0.91); // (13 × 2 × 0,7) / 20
  assert.equal(bill.paybackDays, 180); // 20 / (10 × 7 / 90) × 7
});

test('la famille C5 n’entre jamais dans l’addition', () => {
  const bill = buildBill(
    debtFact(),
    [
      evidence({ id: 'E1', family: 'C1', costJp: 10 }),
      evidence({ id: 'E2', family: 'C2', costJp: 6 }),
      evidence({ id: 'E5', family: 'C5', costJp: 100 }),
    ],
    [attribution('E1', 1, 'link'), attribution('E2', 0.5, 'inferred'), attribution('E5', 1, 'confirmed')],
    CTX,
  );

  assert.equal(bill.lowJp, 10);
  assert.equal(bill.highJp, 13);
  assert.deepEqual(bill.evidenceIds, ['E1', 'E2']); // le délai n'est pas une preuve de coût
  assert.deepEqual(bill.byFamily.C5, { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false });
  assert.equal(bill.hiddenCount, 0);
});

test('une preuve masquée compte dans hiddenCount mais reste dans l’addition', () => {
  const bill = buildBill(
    debtFact(),
    [
      evidence({ id: 'E1', family: 'C1', costJp: 10 }),
      evidence({ id: 'E3', family: 'C3', costJp: 4, visible: false }),
    ],
    [attribution('E1', 1, 'confirmed'), attribution('E3', 1, 'confirmed')],
    CTX,
  );

  assert.equal(bill.hiddenCount, 1);
  assert.equal(bill.lowJp, 14);
  assert.equal(bill.highJp, 14);
  assert.deepEqual(bill.byFamily.C3, { lowJp: 4, highJp: 4, evidenceCount: 1, insufficient: false });
});

test('le manque de références d’une famille est propagé tel quel', () => {
  const bill = buildBill(
    debtFact(),
    [
      evidence({ id: 'E1', family: 'C1', costJp: 10 }),
      evidence({ id: 'E3', family: 'C3', costJp: 0, insufficient: true }),
    ],
    [attribution('E1', 1, 'link'), attribution('E3', 1, 'link')],
    CTX,
  );

  assert.equal(bill.byFamily.C3.insufficient, true);
  assert.equal(bill.byFamily.C1.insufficient, false);
  assert.equal(bill.byFamily.C4.insufficient, false);
});

test('sans remboursement chiffré, le retour est nul et l’écran le dit', () => {
  const bill = buildBill(
    debtFact({ estimateJp: null }),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 1, 'link')],
    CTX,
  );

  assert.equal(bill.repaymentJp, null);
  assert.equal(bill.avoidableJp, 14);
  assert.equal(bill.roiLow, null);
  assert.equal(bill.roiHigh, null);
  assert.equal(bill.paybackDays, null);
});

test('seules les preuves attribuées à ce ticket comptent', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 }), evidence({ id: 'E2', costJp: 99 })],
    [attribution('E1', 1, 'link'), attribution('E2', 1, 'link', 'AUTRE-TICKET')],
    CTX,
  );

  assert.equal(bill.lowJp, 10);
  assert.deepEqual(bill.evidenceIds, ['E1']);
});

test('une preuve inconnue ou une part absurde est ignorée sans jeter', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 1, 'link'), attribution('FANTÔME', 1, 'link'), attribution('E1', -2, 'confirmed')],
    CTX,
  );

  assert.equal(bill.lowJp, 10);
  assert.deepEqual(bill.evidenceIds, ['E1']);
});

test('les parts d’une même preuve s’additionnent, la basse restant plafonnée par preuve', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 0.4, 'confirmed'), attribution('E1', 0.3, 'inferred')],
    CTX,
  );

  assert.equal(bill.lowJp, 4); // 10 × 0,4
  assert.equal(bill.highJp, 7); // 10 × (0,4 + 0,3)
  assert.equal(bill.byFamily.C1.evidenceCount, 1);
});

test('les identifiants de preuves sortent par coût décroissant, à coût égal par identifiant', () => {
  const bill = buildBill(
    debtFact(),
    [
      evidence({ id: 'E1', costJp: 2 }),
      evidence({ id: 'E2', costJp: 9 }),
      evidence({ id: 'E3', costJp: 2 }),
      evidence({ id: 'E0', costJp: 2 }),
    ],
    [
      attribution('E1', 1, 'link'),
      attribution('E2', 1, 'link'),
      attribution('E3', 1, 'link'),
      attribution('E0', 1, 'link'),
    ],
    CTX,
  );

  assert.deepEqual(bill.evidenceIds, ['E2', 'E0', 'E1', 'E3']);
});

test('les montants sont arrondis au centième, par famille et au total', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 3.33 }), evidence({ id: 'E2', family: 'C2', costJp: 1.01 })],
    [attribution('E1', 0.33, 'confirmed'), attribution('E2', 0.5, 'inferred')],
    CTX,
  );

  assert.equal(bill.byFamily.C1.lowJp, 1.1); // 3,33 × 0,33 = 1,0989
  assert.equal(bill.lowJp, 1.1);
  assert.equal(bill.byFamily.C2.highJp, 0.51); // 1,01 × 0,5 = 0,505 → 0,51
  assert.equal(bill.highJp, 1.6); // 1,0989 + 0,505 = 1,6039
});

test('un ticket de dette sans preuve rend une addition vide et sans retour', () => {
  const bill = buildBill(debtFact(), [], [], CTX);

  assert.equal(bill.lowJp, 0);
  assert.equal(bill.highJp, 0);
  assert.equal(bill.avoidableJp, null);
  assert.equal(bill.roiLow, null);
  assert.equal(bill.paybackDays, null);
  assert.deepEqual(bill.evidenceIds, []);
  assert.equal(bill.hiddenCount, 0);
  assert.deepEqual(bill.byFamily.C1, { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false });
});

test('A7 — estimation en points convertie par la vélocité quand estimateJp manque', () => {
  const ctx: CostContext = { ...CTX, velocityPointsPerWeek: 10 };
  const bill = buildBill(debtFact({ estimateJp: null, storyPoints: 20 }), [], [], ctx);

  // 20 points ÷ 10 points par semaine × 5 jours par semaine = 10 jours.
  assert.equal(bill.repaymentJp, 10);
});

test('A7 — l’estimation en jours-personne prime sur les points', () => {
  const ctx: CostContext = { ...CTX, velocityPointsPerWeek: 10 };
  const bill = buildBill(debtFact({ estimateJp: 3, storyPoints: 20 }), [], [], ctx);

  assert.equal(bill.repaymentJp, 3);
});

test('A7 — sans vélocité mesurable, le remboursement reste non chiffré, jamais 0', () => {
  const bill = buildBill(debtFact({ estimateJp: null, storyPoints: 20 }), [], [], CTX);

  assert.equal(bill.repaymentJp, null);
  assert.equal(bill.roiLow, null);
  assert.equal(bill.roiHigh, null);
  assert.equal(bill.paybackDays, null);
});

test('A7 — points absents, nuls ou illisibles : non chiffré', () => {
  const ctx: CostContext = { ...CTX, velocityPointsPerWeek: 10 };

  assert.equal(buildBill(debtFact({ estimateJp: null }), [], [], ctx).repaymentJp, null);
  assert.equal(buildBill(debtFact({ estimateJp: null, storyPoints: 0 }), [], [], ctx).repaymentJp, null);
  assert.equal(buildBill(debtFact({ estimateJp: null, storyPoints: null }), [], [], ctx).repaymentJp, null);
  assert.equal(buildBill(debtFact({ estimateJp: null, storyPoints: Number.NaN }), [], [], ctx).repaymentJp, null);
});

test('A7 — le retour découle des points convertis', () => {
  const ctx: CostContext = { ...CTX, velocityPointsPerWeek: 10 };
  const bill = buildBill(
    debtFact({ estimateJp: null, storyPoints: 20 }),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 1, 'link')],
    ctx,
  );

  assert.equal(bill.repaymentJp, 10);
  assert.equal(bill.avoidableJp, 14);
  assert.equal(bill.roiLow, 1.4);
});

test('A12 — la somme des parts d’une preuve est plafonnée à 100 %', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 0.6, 'confirmed'), attribution('E1', 0.6, 'inferred')],
    CTX,
  );

  assert.equal(bill.highJp, 10); // jamais 12 : une preuve est répartie à 100 % au plus
  assert.equal(bill.lowJp, 5); // 0,6 / 1,2 × 10, les proportions sont conservées
  assert.equal(bill.byFamily.C1.highJp, 10);
});

test('A12 — le plafond tient compte des parts données aux autres dettes', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 })],
    [
      attribution('E1', 0.5, 'link'),
      attribution('E1', 0.5, 'link', 'AUTRE'),
      attribution('E1', 0.5, 'link', 'ENCORE'),
    ],
    CTX,
  );

  assert.equal(bill.lowJp, 3.33); // 0,5 / 1,5 × 10
  assert.ok(bill.lowJp <= 10);
});

test('A12 — des parts sous 100 % ne sont pas gonflées', () => {
  const bill = buildBill(
    debtFact(),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 0.4, 'link')],
    CTX,
  );

  assert.equal(bill.lowJp, 4);
  assert.equal(bill.highJp, 4);
});

test('§19 cas 2 — dette sans zone : addition vide et motif « no-zone »', () => {
  const bill = buildBill(
    debtFact({ zones: [], components: [], affectedServices: [], labels: [] }),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 1, 'link')],
    CTX,
  );

  assert.equal(bill.blockedReason, 'no-zone');
  assert.equal(bill.lowJp, 0);
  assert.equal(bill.highJp, 0);
  assert.deepEqual(bill.evidenceIds, []);
  assert.equal(bill.hiddenCount, 0);
  assert.equal(bill.avoidableJp, null);
  assert.equal(bill.roiLow, null);
  assert.equal(bill.paybackDays, null);
  assert.deepEqual(bill.byFamily.C1, { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false });
  // L'estimation du ticket reste lisible : c'est l'addition qui manque, pas la dette.
  assert.equal(bill.repaymentJp, 20);
});

test('§19 cas 2 — une dette rattachée à une zone n’est pas bloquée', () => {
  const bill = buildBill(debtFact(), [evidence({ id: 'E1', costJp: 10 })], [attribution('E1', 1, 'link')], CTX);

  assert.equal(bill.blockedReason, null);
  assert.equal(bill.lowJp, 10);
});

test('§19 cas 2 — une dette « non classé » est traitée comme sans zone', () => {
  const bill = buildBill(
    debtFact({ zones: ['non classé'], components: [], affectedServices: [], labels: [] }),
    [evidence({ id: 'E1', costJp: 10 })],
    [attribution('E1', 1, 'link')],
    CTX,
  );

  assert.equal(bill.blockedReason, 'no-zone');
  assert.equal(bill.highJp, 0);
});
