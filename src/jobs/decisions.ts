import type { Attribution, CostContext, Evidence, IssueFact, IssueLink, RelevanceScore } from '../core/types';
import { EXPLICIT_LINK_TYPES } from '../core/attribution';
import {
  insertRejection,
  listAttributions,
  listBaselines,
  listDebtIssues,
  listEvidence,
  listRejections,
  listStatusSpans,
  replaceAttributions,
  upsertBills,
} from '../platform/db/index';
import { addConfirmation, listConfirmations, removeConfirmation } from './confirmations';
import { removeRejection } from './rejections';
import { requireSettings } from './projects';
import type { RecomputeInput } from './recompute';
import { finish } from './recompute';
import { groupSpans } from './spans';
import { nowIso } from './support';

/**
 * DT-10 : confirmer ou rejeter un rapprochement — une seule implémentation.
 *
 * L'écran (résolveur) et l'agent Rovo (outil MCP) passent tous les deux par ici.
 * Avant cette factorisation, l'outil MCP réécrivait directement les parts sans
 * poser la **décision** : le recalcul nocturne, qui repart des décisions et non
 * des parts, l'effaçait. Une décision humaine doit survivre à la nuit (§10).
 */

/** Bilan d'une décision : ce qui a été tranché, et combien d'additions rebâties. */
export interface DecisionOutcome {
  evidenceId: string;
  debtIssueId: string;
  bills: number;
}

/** Confirme un rapprochement : la preuve entre dans la fourchette basse (§10). */
export async function confirmMatch(
  projectId: string,
  evidenceId: string,
  debtIssueId: string,
  by: string,
): Promise<DecisionOutcome> {
  await addConfirmation(projectId, { evidenceId, debtIssueId, by, at: nowIso() });
  await removeRejection(projectId, evidenceId, debtIssueId);
  return { evidenceId, debtIssueId, bills: await rebuild(projectId, nowIso()) };
}

/** Rejette un rapprochement : il n'est plus jamais proposé (§7.4). */
export async function rejectMatch(
  projectId: string,
  evidenceId: string,
  debtIssueId: string,
  by: string,
): Promise<DecisionOutcome> {
  await insertRejection({ evidenceId, debtIssueId, rejectedBy: by, at: nowIso() });
  await removeConfirmation(projectId, evidenceId, debtIssueId);
  return { evidenceId, debtIssueId, bills: await rebuild(projectId, nowIso()) };
}

/**
 * Rejoue l'attribution et les additions d'un projet, sans relire Jira.
 *
 * Le socle (preuves, tickets de dette) est repris tel quel de la base : aucune
 * famille n'est recalculée, seul l'appariement change. Les scores du modèle ne
 * sont pas redemandés non plus — ceux déjà obtenus sont relus des attributions
 * enregistrées, ce qui laisse les autres rapprochements stables.
 *
 * Les liens Jira ne se relisent pas non plus (des centaines d'appels REST pour
 * une décision) : ils sont **reconstruits** depuis les attributions `link`
 * enregistrées (`preserveLinks`). Sans cela, confirmer ou rejeter un
 * rapprochement effaçait toutes les attributions par lien et la fourchette
 * basse s'effondrait — la recette §20 n°1 cassée par la n°3 (B15).
 */
export async function rebuild(projectId: string, now: string): Promise<number> {
  const settings = await requireSettings(projectId);
  const [evidence, debts, attributions, rejections, confirmations, spans, baselines] = await Promise.all([
    listEvidence(projectId),
    listDebtIssues(projectId),
    listAttributions(projectId),
    listRejections(projectId),
    listConfirmations(projectId),
    listStatusSpans(projectId),
    listBaselines(projectId),
  ]);
  const input: RecomputeInput = {
    projectId,
    settings,
    facts: debts,
    links: preserveLinks(attributions, evidence, debts),
    spansByIssue: groupSpans(spans),
    scores: scoresOf(attributions),
    rejections,
    confirmations,
    now,
  };
  const ctx: CostContext = {
    settings,
    now,
    baselines: new Map(baselines.map((item) => [`${item.issueType}:${item.sizeClass}`, item])),
    spansByIssue: input.spansByIssue,
  };
  const result = finish(input, { ctx, evidence, debts });
  await replaceAttributions(projectId, result.attributions);
  await upsertBills(projectId, result.bills);
  return result.bills.length;
}

/** Forme de la justification écrite par le calcul pour un lien explicite. */
const LINK_RATIONALE = /^Lien Jira explicite \((.+)\)$/;

/**
 * Liens Jira reconstruits depuis les attributions `link` enregistrées.
 *
 * Une attribution `link` dit exactement ce que le lien disait : la preuve
 * (son ticket source) est reliée à la dette. Le type de lien est relu de la
 * justification ; illisible, on retombe sur `relates to`, qui appartient aux
 * types explicites du §10 — la part reste à 100 % dans la fourchette basse.
 */
export function preserveLinks(
  attributions: readonly Attribution[],
  evidence: readonly Evidence[],
  debts: readonly IssueFact[],
): IssueLink[] {
  const sourceByEvidence = new Map(evidence.map((item) => [item.id, item.sourceIssueId]));
  const keyByDebt = new Map(debts.map((debt) => [debt.issueId, debt.key]));
  const links: IssueLink[] = [];
  for (const attribution of attributions) {
    if (attribution.basis !== 'link') continue;
    const fromIssueId = sourceByEvidence.get(attribution.evidenceId);
    const toKey = keyByDebt.get(attribution.debtIssueId);
    if (!fromIssueId || !toKey) continue;
    links.push({
      fromIssueId,
      toIssueId: attribution.debtIssueId,
      toKey,
      type: linkTypeOf(attribution.rationale),
    });
  }
  return links;
}

/** Type de lien relu de la justification ; `relates to` par défaut. */
function linkTypeOf(rationale: string): string {
  const found = LINK_RATIONALE.exec(rationale.trim());
  const type = (found?.[1] ?? '').trim().toLowerCase();
  return EXPLICIT_LINK_TYPES.includes(type) ? type : 'relates to';
}

/** Scores déjà obtenus, réutilisés tels quels : aucune empreinte n'est inventée. */
function scoresOf(attributions: Attribution[]): RelevanceScore[] {
  return attributions
    .filter((item) => item.basis === 'inferred')
    .map((item) => ({
      evidenceId: item.evidenceId,
      debtIssueId: item.debtIssueId,
      relevance: item.relevance,
      rationale: item.rationale,
      fingerprint: `${item.evidenceId}|${item.debtIssueId}`,
    }));
}
