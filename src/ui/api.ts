import { invoke } from '@forge/bridge';
import type {
  Attribution,
  BootstrapProgress,
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
import { unwrap } from './envelope';
import type { DebtCaseView } from '../resolvers/case';

export type { DebtCaseView };

/**
 * Passerelle typée vers les resolvers (§14). Chaque écran appelle une fonction
 * d'ici, jamais `invoke` directement : la clé et la forme de la réponse sont
 * écrites à un seul endroit.
 */

/** Les clés exposées par `src/resolvers/index.ts`, plus celles à exposer. */
export type ResolverKey =
  | 'getProjectPage'
  | 'getDebtBill'
  | 'getDebtCase'
  | 'listPhantomDebt'
  | 'listDeadDebt'
  | 'getRepaymentReport'
  | 'confirmEvidence'
  | 'rejectEvidence'
  | 'getSettings'
  | 'saveSettings'
  | 'loadSampleData'
  | 'clearSampleData'
  | 'getDataQuality'
  | 'startBootstrap'
  | 'bootstrapProgress'
  | 'draftDebtTicket'
  | 'previewDebtTicket'
  | 'listZoneEvidence'
  | 'listDebtAttributions'
  | 'getIssueCost'
  | 'getGadgetData';

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

/** Brouillon relu **avant** création : titre et description, rien de plus. */
export type DebtDraft = { title: string; description: string; source: 'model' | 'template' };

/** Ce que le champ personnalisé affiche : trois lignes, pas l'état du projet. */
export type IssueCost = {
  lowJp: number;
  highJp: number;
  days: number;
  insufficient: boolean;
  demoData: boolean;
};

/** Ce que le gadget affiche : le haut du classement et les deux replis. */
export type GadgetData = {
  debts: RankedDebt[];
  costByTeam: TeamCost[];
  costByQuarter: QuarterCost[];
  demoData: boolean;
};

/** Part d'une preuve dans une dette, telle que l'écran la montre (recette §20 n°2). */
export type AttributionShare = {
  debtIssueId: string;
  debtKey: string;
  share: number;
};

/** Une preuve de zone et les parts qui la répartissent entre les dettes. */
export type ZoneEvidenceLine = {
  evidence: Evidence;
  shares: AttributionShare[];
};

export function getProjectPage(projectId: string, projectKey: string): Promise<ProjectPageData> {
  return call<ProjectPageData>('getProjectPage', { projectId, projectKey });
}

export function getDebtBill(debtIssueId: string): Promise<DebtBillView> {
  return call<DebtBillView>('getDebtBill', { debtIssueId });
}

/** La page d'argumentaire d'une dette : chiffres, limites et texte rédigé. */
export function getDebtCase(issueKey: string): Promise<DebtCaseView> {
  return call<DebtCaseView>('getDebtCase', { issueKey });
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

export function getSettings(projectId: string, projectKey = ''): Promise<ProjectSettings> {
  return call<ProjectSettings>('getSettings', { projectId, projectKey });
}

export function saveSettings(settings: ProjectSettings): Promise<ProjectSettings> {
  return call<ProjectSettings>('saveSettings', { settings });
}

export function loadSampleData(projectId: string): Promise<void> {
  return call<void>('loadSampleData', { projectId });
}

/** Retire le jeu d'exemple : le bandeau disparaît, les vraies données restent. */
export function clearSampleData(projectId: string): Promise<void> {
  return call<void>('clearSampleData', { projectId });
}

export function getDataQuality(projectId: string): Promise<DataQuality> {
  return call<DataQuality>('getDataQuality', { projectId });
}

/** Lance l'initialisation d'un projet (DT-12) et rend son état de départ. */
export function startBootstrap(projectId: string): Promise<BootstrapProgress> {
  return call<BootstrapProgress>('startBootstrap', { projectId });
}

/** Avancement de l'initialisation : `null` tant qu'aucune n'a été lancée. */
export function bootstrapProgress(projectId: string): Promise<BootstrapProgress | null> {
  return call<BootstrapProgress | null>('bootstrapProgress', { projectId });
}

/** Crée le ticket de dette d'une zone et rend sa clé et son adresse. */
export function draftDebtTicket(projectKey: string, zone: string, siteUrl = ''): Promise<DraftedTicket> {
  return call<DraftedTicket>('draftDebtTicket', { projectKey, zone, siteUrl });
}

/**
 * Prépare le brouillon d'un ticket de dette **sans** le créer : le tech lead
 * relit, corrige, puis crée (§7.2).
 */
// TODO(integration): clé resolver à exposer — `previewDebtTicket` doit rendre
// le brouillon (titre, description) sans créer de ticket.
export function previewDebtTicket(projectKey: string, zone: string): Promise<DebtDraft> {
  return call<DebtDraft>('previewDebtTicket', { projectKey, zone });
}

/** Preuves d'une zone et leurs parts d'attribution : le chemin du chiffre (§18). */
// TODO(integration): clé resolver à exposer — `listZoneEvidence` doit rendre
// les preuves d'une zone avec, pour chacune, ses parts d'attribution.
export function listZoneEvidence(projectId: string, zone: string): Promise<ZoneEvidenceLine[]> {
  return call<ZoneEvidenceLine[]>('listZoneEvidence', { projectId, zone });
}

/** Parts d'attribution d'une dette : la somme ne dépasse jamais 100 % (recette 2). */
// TODO(integration): clé resolver à exposer — `listDebtAttributions` doit
// rendre les attributions d'un ticket de dette (part, base, pertinence).
export function listDebtAttributions(debtIssueId: string): Promise<Attribution[]> {
  return call<Attribution[]>('listDebtAttributions', { debtIssueId });
}

/** Coût d'un ticket pour le champ personnalisé : trois lignes, pas l'état du projet. */
// TODO(integration): clé resolver à exposer — `getIssueCost` doit rendre le
// coût d'un ticket sans charger tout l'état du projet.
export function getIssueCost(issueId: string): Promise<IssueCost> {
  return call<IssueCost>('getIssueCost', { issueId });
}

/** Données du gadget : le top du classement, les équipes, les trimestres. */
// TODO(integration): clé resolver à exposer — `getGadgetData` doit rendre les
// seules lignes du gadget, sans le classement complet du projet.
export function getGadgetData(projectId: string, projectKey: string): Promise<GadgetData> {
  return call<GadgetData>('getGadgetData', { projectId, projectKey });
}

/**
 * Appel générique : `invoke` peut rendre le corps nu ou l'envelopper, et
 * rendre `{ ok: false, error }` quand le resolver a échoué (item D45).
 */
async function call<T>(key: ResolverKey, payload: Record<string, unknown>): Promise<T> {
  const response = await invoke<Record<string, unknown>, T>(key, payload);
  return unwrap<T>(response);
}
