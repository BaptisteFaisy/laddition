/**
 * Fixtures de test de la couche de stockage.
 *
 * Fichier **réservé aux tests** (il n'est importé par aucun module de
 * production) : il évite que chaque fichier de test réécrive les mêmes
 * objets du domaine. Les fabriques acceptent des surcharges partielles, pour
 * qu'un test n'écrive que ce qu'il veut vraiment fixer.
 *
 * Usage :
 * ```ts
 * import { issueFact, evidence } from '../testFixtures';
 * await upsertIssueFacts([issueFact({ issueId: 'i1', isDebt: true })]);
 * ```
 */

import type {
  Attribution,
  Baseline,
  DebtBill,
  Evidence,
  Family,
  IssueFact,
  Repayment,
  StatusSpan,
} from '../../core/types';
import { zeroFamilyNumbers } from './rows';

/** Instant figé des fixtures : les tests n'ont pas d'horloge implicite. */
export const FIXTURE_NOW = '2026-11-11T09:00:00.000Z';

/** Un fait de ticket complet, cohérent avec le contrat (`core/types.ts`). */
export function issueFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'i1',
    key: 'PROJ-1',
    projectId: 'p1',
    projectKey: 'PROJ',
    type: 'Story',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: ['api'],
    createdAt: '2026-10-01T08:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: ['api'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'un ticket',
    ...overrides,
  };
}

/** Un séjour de statut. */
export function statusSpan(overrides: Partial<StatusSpan> = {}): StatusSpan {
  return {
    issueId: 'i1',
    category: 'inprogress',
    startedAt: '2026-10-01T08:00:00.000Z',
    endedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

/** Une preuve, avec le détail affiché au clic (§18). */
export function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'e1',
    zone: 'api',
    family: 'C1' as Family,
    sourceIssueId: 'i1',
    sourceKey: 'PROJ-1',
    occurredAt: '2026-10-01T08:00:00.000Z',
    costJp: 2,
    method: 'computed',
    visible: true,
    detail: {
      durationDays: 2,
      method: 'computed',
      formula: '2 j',
      inputs: {},
      familyLabel: 'Incidents',
    },
    ...overrides,
  };
}

/** Une part de preuve imputée à une dette (§10). */
export function attribution(overrides: Partial<Attribution> = {}): Attribution {
  return {
    evidenceId: 'e1',
    debtIssueId: 'd1',
    share: 0.5,
    basis: 'inferred',
    relevance: 0.6,
    rationale: 'même zone',
    ...overrides,
  };
}

/** Une addition de dette (DT-06). */
export function debtBill(overrides: Partial<DebtBill> = {}): DebtBill {
  return {
    debtIssueId: 'd1',
    key: 'PROJ-2',
    computedAt: FIXTURE_NOW,
    lowJp: 4,
    highJp: 9,
    byFamily: familyTotals(),
    evidenceIds: ['e1'],
    hiddenCount: 0,
    repaymentJp: null,
    avoidableJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
    ...overrides,
  };
}

/** Une référence C3. */
export function baseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    issueType: 'Story',
    sizeClass: 'm',
    medianDays: 3,
    sampleSize: 8,
    computedAt: FIXTURE_NOW,
    ...overrides,
  };
}

/** Un bulletin de remboursement (§11). */
export function repayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    debtIssueId: 'd1',
    key: 'PROJ-2',
    zone: 'api',
    closedAt: FIXTURE_NOW,
    beforeRate: 3,
    afterRate: 1,
    weeksBefore: 8,
    weeksAfter: 8,
    caveats: [],
    publishedAt: FIXTURE_NOW,
    ...overrides,
  };
}

/** Ventilation par famille, partout à zéro. */
function familyTotals(): DebtBill['byFamily'] {
  const families = zeroFamilyNumbers();
  const out = {} as DebtBill['byFamily'];
  for (const family of Object.keys(families) as Family[]) {
    out[family] = { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false };
  }
  return out;
}
