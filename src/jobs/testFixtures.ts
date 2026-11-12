import type { Evidence, EvidenceDetail, IssueFact, Repayment } from '../core/types';
import { makeSettings } from '../core/settings';

/**
 * Fabriques de fixtures pour les tests des jobs.
 *
 * Les jobs parlent à Forge (SQL, REST, file) : leurs tests n'appellent jamais
 * la plateforme, ils injectent des doubles et construisent leurs données ici.
 * Une seule fabrique par type du contrat, partagée par tous les tests.
 */

export { makeSettings };

/** Un fait de ticket, complet et cohérent, à compléter par champ. */
export function makeFact(overrides: Partial<IssueFact> = {}): IssueFact {
  return {
    issueId: 'i1',
    key: 'PAY-1',
    projectId: 'p1',
    projectKey: 'PAY',
    type: 'Tâche',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: ['facturation'],
    createdAt: '2026-01-05T09:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'm',
    estimateJp: null,
    loggedSeconds: null,
    labels: [],
    components: ['facturation'],
    affectedServices: [],
    hasPostMortem: false,
    participants: 1,
    visible: true,
    summary: 'Ticket de test',
    ...overrides,
  };
}

/** Détail d'une preuve : ce que l'écran affiche au clic. */
export function makeDetail(overrides: Partial<EvidenceDetail> = {}): EvidenceDetail {
  return {
    durationDays: 1,
    method: 'computed',
    formula: '1 j ouvré × 1 intervenant = 1 j-p',
    inputs: { durationDays: 1, participants: 1 },
    familyLabel: 'Incidents',
    ...overrides,
  };
}

/** Une preuve, à compléter par champ. */
export function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'C1:i9:facturation',
    zone: 'facturation',
    family: 'C1',
    sourceIssueId: 'i9',
    sourceKey: 'PAYSUP-9',
    occurredAt: '2026-02-01T10:00:00.000Z',
    costJp: 4,
    method: 'computed',
    visible: true,
    detail: makeDetail(),
    ...overrides,
  };
}

/** Un bulletin de remboursement, à compléter par champ. */
export function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    debtIssueId: 'i1',
    key: 'PAY-1',
    zone: 'facturation',
    closedAt: '2026-02-02T17:00:00.000Z',
    beforeRate: 2.6,
    afterRate: 0.7,
    weeksBefore: 8,
    weeksAfter: 8,
    caveats: ['comparaison avant/après, sans preuve de causalité'],
    publishedAt: null,
    ...overrides,
  };
}
