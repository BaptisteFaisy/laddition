import { invoke } from '@forge/bridge';
import type {
  DataQuality,
  DeadDebt,
  DebtBill,
  Evidence,
  Family,
  PhantomDebt,
  ProjectSettings,
  RankedDebt,
  Repayment,
  ZoneCost,
} from '../core/types';

/**
 * Passerelle typée vers les resolvers (§14). Chaque écran appelle une fonction
 * d'ici, jamais `invoke` directement : la clé et la forme de la réponse sont
 * écrites à un seul endroit.
 */

/** Les douze clés exposées par `src/resolvers/`. */
export type ResolverKey =
  | 'getProjectPage'
  | 'getDebtBill'
  | 'listPhantomDebt'
  | 'listDeadDebt'
  | 'getRepaymentReport'
  | 'confirmEvidence'
  | 'rejectEvidence'
  | 'getSettings'
  | 'saveSettings'
  | 'loadSampleData'
  | 'getDataQuality'
  | 'draftDebtTicket';

/** Un rapprochement proposé, en attente de confirmation humaine (§10). */
export type PendingMatch = {
  evidenceId: string;
  sourceKey: string;
  sourceSummary: string | null;
  zone: string;
  family: Family;
  costJp: number;
  relevance: number;
  rationale: string;
};

/**
 * Contexte d'attribution d'un ticket (§14 écran 3) : à quelle dette il
 * appartient déjà, ou à quelle dette il ressemble. Rendu par le même resolver
 * que l'addition, pour qu'un ticket n'ait qu'un seul chiffre.
 */
export type IssueAttribution = {
  feeds: { key: string; zone: string } | null;
  proposal: { evidenceId: string; debtIssueId: string; key: string; zone: string; relevance: number } | null;
};

/** Tout ce que le panneau d'une dette affiche. */
export type DebtBillView = {
  settings: ProjectSettings;
  /** Zone du ticket de dette ; vide quand il n'en a pas (§19). */
  zone: string;
  bill: DebtBill;
  evidence: Evidence[];
  pendingMatches: PendingMatch[];
  /** Renseigné pour un ticket qui n'est pas la dette elle-même. */
  attribution: IssueAttribution | null;
};

/** Une ligne « coût par équipe » (jamais par personne, §18). */
export type TeamCost = { team: string; costJp: number };

/** Une ligne « coût par trimestre ». */
export type QuarterCost = { quarter: string; costJp: number };

/**
 * Le modèle de lecture d'un projet, déjà agrégé par le resolver : la page
 * projet et le gadget lisent la même chose, et l'UI n'additionne jamais rien.
 */
export type ProjectPageData = {
  settings: ProjectSettings;
  ranking: RankedDebt[];
  zones: ZoneCost[];
  quality: DataQuality;
  costByTeam: TeamCost[];
  costByQuarter: QuarterCost[];
};

/** Brouillon de ticket de dette proposé depuis la dette fantôme. */
export type DraftedTicket = { key: string; url: string };

export function getProjectPage(projectId: string, projectKey: string): Promise<ProjectPageData> {
  return call<ProjectPageData>('getProjectPage', { projectId, projectKey });
}

export function getDebtBill(debtIssueId: string): Promise<DebtBillView> {
  return call<DebtBillView>('getDebtBill', { debtIssueId });
}

export function listPhantomDebt(projectId: string, projectKey: string): Promise<PhantomDebt[]> {
  return call<PhantomDebt[]>('listPhantomDebt', { projectId, projectKey });
}

export function listDeadDebt(projectId: string): Promise<DeadDebt[]> {
  return call<DeadDebt[]>('listDeadDebt', { projectId });
}

export function getRepaymentReport(projectId: string): Promise<Repayment[]> {
  return call<Repayment[]>('getRepaymentReport', { projectId });
}

export function confirmEvidence(evidenceId: string, debtIssueId: string): Promise<void> {
  return call<void>('confirmEvidence', { evidenceId, debtIssueId });
}

export function rejectEvidence(evidenceId: string, debtIssueId: string): Promise<void> {
  return call<void>('rejectEvidence', { evidenceId, debtIssueId });
}

export function getSettings(projectId: string): Promise<ProjectSettings> {
  return call<ProjectSettings>('getSettings', { projectId });
}

export function saveSettings(settings: ProjectSettings): Promise<ProjectSettings> {
  return call<ProjectSettings>('saveSettings', { settings });
}

export function loadSampleData(projectId: string): Promise<void> {
  return call<void>('loadSampleData', { projectId });
}

export function getDataQuality(projectId: string): Promise<DataQuality> {
  return call<DataQuality>('getDataQuality', { projectId });
}

export function draftDebtTicket(projectKey: string, zone: string): Promise<DraftedTicket> {
  return call<DraftedTicket>('draftDebtTicket', { projectKey, zone });
}

/** Appel générique : `invoke` peut rendre le corps nu ou l'envelopper. */
async function call<T>(key: ResolverKey, payload: Record<string, unknown>): Promise<T> {
  const response = await invoke<Record<string, unknown>, T>(key, payload);
  return unwrap<T>(response);
}

function unwrap<T>(response: T | { body: T }): T {
  if (typeof response === 'object' && response !== null && 'body' in response) {
    return (response as { body: T }).body;
  }
  return response as T;
}
