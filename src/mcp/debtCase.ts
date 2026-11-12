/**
 * GET `get-debt-case` — la page d'argumentaire d'une dette (item E68, §7.6).
 *
 * Le parcours « Prépare l'argumentaire pour PAY-77 » repose sur cette action :
 * elle rend, en une seule lecture, **le coût (fourchette), les preuves
 * principales, le remboursement, le retour et les limites de la méthode**.
 *
 * Elle ne calcule rien (§15) : les chiffres viennent des résultats enregistrés.
 * Elle n'appelle pas non plus le modèle — c'est l'agent qui rédige la page à
 * partir de ces faits, conformément au principe « le modèle rapproche et rédige,
 * il ne calcule pas » (§5, règle 5).
 *
 * TODO(integration) : `writeArgumentaire()` de `src/platform/llm.ts` reste sans
 * appelant. Si l'on veut une rédaction Markdown côté serveur plutôt que côté
 * agent, c'est ici qu'il faut l'injecter (import depuis `platform/`, avec repli
 * sur ces données) — à valider avec le lot plateforme avant de brancher.
 */

import type {
  Attribution,
  AttributionBasis,
  Evidence,
  Family,
  FamilyTotal,
  ProjectSettings,
} from '../core/types';
import { BILLED_FAMILIES } from '../core/types';
import { listAttributions } from '../platform/db/index';
import { billOf, evidenceOfBill, locateDebt } from './reads';
import { maskEvidence } from './masking';
import type { ActionEnvelope, JsonPayload } from './result';
import { requireText, run } from './result';

/** Nombre de preuves citées dans la page : les plus coûteuses d'abord. */
export const CASE_EVIDENCE_LIMIT = 8;

/**
 * Limites de la méthode, rendues avec chaque page (§5, §10, §11, §18).
 *
 * Elles ne sont pas une précaution de style : sans elles, un coût observé se
 * lit comme une causalité démontrée et une fourchette comme une valeur exacte.
 */
export const METHOD_LIMITS: readonly string[] = [
  'Coût observé, jamais une causalité démontrée : les rapprochements sont proposés, puis confirmés ou rejetés par un humain.',
  'La borne basse ne compte que les preuves liées ou confirmées ; la borne haute ajoute les rapprochements proposés.',
  'Aucune preuve nʼest comptée deux fois : la somme des parts dʼune preuve ne dépasse jamais 100 %.',
  'Le retard induit (C5) est un délai, pas un effort : il est affiché à part et jamais additionné au coût.',
  'Une famille sans référence suffisante est déclarée « données insuffisantes » plutôt que chiffrée.',
  'Un remboursement non chiffré reste non chiffré : aucune estimation nʼest inventée.',
  'Les preuves hors des droits du lecteur sont comptées mais masquées : le total peut reposer sur des éléments non visibles.',
  'Aucun chiffre ne classe une personne : lʼunité est la zone, lʼéquipe ou le ticket.',
];

/** Une preuve citée dans la page, avec sa part d'attribution (§10). */
export interface DebtCaseEvidence {
  id: string;
  /** Clé du ticket source ; vide quand la preuve est masquée (§18). */
  sourceKey: string;
  family: Family;
  familyLabel: string;
  costJp: number;
  /** Formule appliquée ; masquée quand le ticket source est hors droits. */
  formula: string;
  occurredAt: string;
  /** Part de cette preuve imputée à la dette (0 à 1). */
  share: number;
  basis: AttributionBasis;
  visible: boolean;
}

/** Méthode en vigueur sur le projet : ce qui a produit les chiffres. */
export interface DebtCaseMethod {
  windowDays: number;
  occupationCoefficient: number;
  minBaselineSample: number;
  /** Familles qui entrent dans l'addition (C5 exclue : c'est un délai). */
  billedFamilies: readonly Family[];
  limits: readonly string[];
}

/** La page d'argumentaire : tout ce qu'il faut pour prioriser, rien d'inventé. */
export interface DebtCaseData {
  projectKey: string;
  issueKey: string;
  summary: string;
  zone: string;
  /** Coût observé, fourchette basse et haute (§5, règle 2). */
  lowJp: number;
  highJp: number;
  byFamily: Record<Family, FamilyTotal>;
  /** Preuves principales, les plus coûteuses d'abord. */
  evidence: DebtCaseEvidence[];
  /** Preuves comptées dans l'addition mais masquées pour ce lecteur. */
  hiddenCount: number;
  /** Remboursement et retour (§11) ; `null` quand ce n'est pas chiffré. */
  repaymentJp: number | null;
  avoidableJp: number | null;
  roiLow: number | null;
  roiHigh: number | null;
  paybackDays: number | null;
  method: DebtCaseMethod;
}

/** GET `get-debt-case` : l'argumentaire d'une dette, chiffres et limites compris. */
export async function getDebtCase(payload: JsonPayload): Promise<ActionEnvelope<DebtCaseData>> {
  return run(() => buildDebtCase(requireText(payload, 'issueKey')));
}

/**
 * Construit la page d'argumentaire d'un ticket de dette.
 *
 * Jette un motif actionnable (ticket inconnu, pas une dette, aucune addition) ;
 * l'action et le résolveur l'enveloppent chacun à leur façon.
 */
export async function buildDebtCase(issueKey: string): Promise<DebtCaseData> {
  const located = await locateDebt(issueKey);
  const projectId = located.project.projectId;
  const bill = await billOf(projectId, issueKey);
  const [stored, attributions] = await Promise.all([
    evidenceOfBill(projectId, bill),
    listAttributions(projectId),
  ]);
  const masked = maskEvidence(stored);
  const shares = sharesOf(attributions, bill.debtIssueId);
  return {
    projectKey: located.project.projectKey,
    issueKey: bill.key,
    summary: located.debt.summary,
    zone: located.debt.zones[0] ?? 'non classé',
    lowJp: bill.lowJp,
    highJp: bill.highJp,
    byFamily: bill.byFamily,
    evidence: caseEvidence(masked.evidence, shares),
    hiddenCount: masked.hiddenCount,
    repaymentJp: bill.repaymentJp,
    avoidableJp: bill.avoidableJp,
    roiLow: bill.roiLow,
    roiHigh: bill.roiHigh,
    paybackDays: bill.paybackDays,
    method: caseMethod(located.project.settings),
  };
}

/** Parts imputées à cette dette, indexées par preuve. */
function sharesOf(attributions: readonly Attribution[], debtIssueId: string): Map<string, Attribution> {
  const shares = new Map<string, Attribution>();
  for (const attribution of attributions) {
    if (attribution.debtIssueId === debtIssueId) shares.set(attribution.evidenceId, attribution);
  }
  return shares;
}

/** Preuves citables de la page : facturables, les plus coûteuses d'abord. */
function caseEvidence(evidence: readonly Evidence[], shares: Map<string, Attribution>): DebtCaseEvidence[] {
  return evidence
    .filter((item) => BILLED_FAMILIES.includes(item.family))
    .slice()
    .sort((a, b) => b.costJp - a.costJp || a.id.localeCompare(b.id))
    .slice(0, CASE_EVIDENCE_LIMIT)
    .map((item) => toCaseEvidence(item, shares.get(item.id)));
}

/** Ce qui est lisible d'une preuve : son identité dépend de ses droits (§18). */
function toCaseEvidence(item: Evidence, attribution: Attribution | undefined): DebtCaseEvidence {
  return {
    id: item.id,
    sourceKey: item.visible === false ? '' : item.sourceKey,
    family: item.family,
    familyLabel: item.detail.familyLabel,
    costJp: item.costJp,
    formula: item.detail.formula,
    occurredAt: item.occurredAt,
    share: attribution?.share ?? 0,
    basis: attribution?.basis ?? 'inferred',
    visible: item.visible !== false,
  };
}

/** Méthode et limites, rappelées sur chaque page. */
function caseMethod(settings: ProjectSettings): DebtCaseMethod {
  return {
    windowDays: settings.windowDays,
    occupationCoefficient: settings.occupationCoefficient,
    minBaselineSample: settings.minBaselineSample,
    billedFamilies: BILLED_FAMILIES,
    limits: METHOD_LIMITS,
  };
}
