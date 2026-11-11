import type { Request } from '@forge/resolver';
import type { Attribution, CostContext, RelevanceScore } from '../core/types';
import {
  getIssueFact,
  insertRejection,
  listAttributions,
  listBaselines,
  listDebtIssues,
  listEvidence,
  listRejections,
  listStatusSpans,
  replaceAttributions,
  upsertBill,
} from '../platform/db/index';
import { addConfirmation, listConfirmations, removeConfirmation } from '../jobs/confirmations';
import { requireSettings } from '../jobs/projects';
import type { RecomputeInput } from '../jobs/recompute';
import { finish } from '../jobs/recompute';
import { removeRejection } from '../jobs/rejections';
import { groupSpans } from '../jobs/spans';
import type { Failure } from '../jobs/support';
import { guard, nowIso, payloadOf, requireString } from '../jobs/support';

/**
 * DT-10 : confirmer ou rejeter un rapprochement.
 *
 * Une décision humaine est écrite tout de suite, puis les additions du projet
 * sont reconstruites à partir des résultats déjà en base : rien n'est relu chez
 * Jira et aucune famille n'est recalculée. Le calcul nocturne reprendra la
 * décision telle quelle, puisqu'elle vit hors des résultats
 * (`jobs/confirmations.ts`, table `rejection`).
 */

/** Bilan d'une décision ; `bills` dit combien d'additions ont été réécrites. */
export interface DecisionResult {
  ok: true;
  evidenceId: string;
  debtIssueId: string;
  bills: number;
}

/** Confirme un rapprochement : la preuve compte dans la fourchette basse (§10). */
export function confirmEvidence(request: Request<unknown>): Promise<DecisionResult | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const evidenceId = requireString(payload, 'evidenceId');
    const debtIssueId = requireString(payload, 'debtIssueId');
    const projectId = await projectOf(debtIssueId, payload);
    await addConfirmation(projectId, { evidenceId, debtIssueId, by: actorOf(request), at: nowIso() });
    await removeRejection(projectId, evidenceId, debtIssueId);
    return { ok: true, evidenceId, debtIssueId, bills: await rebuild(projectId, nowIso()) };
  });
}

/** Rejette un rapprochement : il ne sera plus jamais proposé (§7.4). */
export function rejectEvidence(request: Request<unknown>): Promise<DecisionResult | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const evidenceId = requireString(payload, 'evidenceId');
    const debtIssueId = requireString(payload, 'debtIssueId');
    const projectId = await projectOf(debtIssueId, payload);
    await insertRejection({ evidenceId, debtIssueId, rejectedBy: actorOf(request), at: nowIso() });
    await removeConfirmation(projectId, evidenceId, debtIssueId);
    return { ok: true, evidenceId, debtIssueId, bills: await rebuild(projectId, nowIso()) };
  });
}

/** Auteur de la décision : l'identifiant du compte qui a cliqué, jamais un nom. */
function actorOf(request: Request<unknown>): string {
  const accountId = request.context?.['accountId'];
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : 'inconnu';
}

/** Projet du ticket visé : ses faits, à défaut le payload. */
async function projectOf(debtIssueId: string, payload: Record<string, unknown>): Promise<string> {
  const fact = await getIssueFact(debtIssueId);
  if (fact) return fact.projectId;
  const direct = payload['projectId'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  throw new Error(`ticket ${debtIssueId} inconnu : lancer l'initialisation`);
}

/**
 * Rejoue l'attribution et les additions d'un projet, sans relire Jira.
 *
 * Le socle (preuves, tickets de dette) est repris tel quel de la base : aucune
 * famille n'est recalculée, seul l'appariement change. Les scores du modèle ne
 * sont pas redemandés non plus — ceux déjà obtenus sont relus des attributions
 * enregistrées, ce qui laisse les autres rapprochements stables.
 */
async function rebuild(projectId: string, now: string): Promise<number> {
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
    links: [],
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
  for (const bill of result.bills) await upsertBill(bill);
  return result.bills.length;
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
