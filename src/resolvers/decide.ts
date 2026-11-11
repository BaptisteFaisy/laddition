import type { Request } from '@forge/resolver';
import { getIssueFact } from '../platform/db/index';
import { confirmMatch, rejectMatch } from '../jobs/decisions';
import type { DecisionOutcome } from '../jobs/decisions';
import type { Failure } from '../jobs/support';
import { guard, payloadOf, requireString } from '../jobs/support';

/**
 * DT-10 : confirmer ou rejeter un rapprochement depuis l'écran.
 *
 * Ce résolveur ne calcule rien : il retrouve le projet, identifie l'auteur de
 * la décision, puis délègue à `jobs/decisions.ts` — le même module que l'outil
 * MCP `confirm-evidence`, pour qu'un clic et un appel d'agent aient exactement
 * le même effet (§18 « une seule implémentation par logique »).
 */

/** Bilan d'une décision ; `bills` dit combien d'additions ont été réécrites. */
export type DecisionResult = DecisionOutcome & { ok: true };

/** Confirme un rapprochement : la preuve compte dans la fourchette basse (§10). */
export function confirmEvidence(request: Request<unknown>): Promise<DecisionResult | Failure> {
  return decide(request, confirmMatch);
}

/** Rejette un rapprochement : il ne sera plus jamais proposé (§7.4). */
export function rejectEvidence(request: Request<unknown>): Promise<DecisionResult | Failure> {
  return decide(request, rejectMatch);
}

/** Lecture du payload, puis décision déléguée au module partagé. */
function decide(
  request: Request<unknown>,
  apply: (projectId: string, evidenceId: string, debtIssueId: string, by: string) => Promise<DecisionOutcome>,
): Promise<DecisionResult | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const evidenceId = requireString(payload, 'evidenceId');
    const debtIssueId = requireString(payload, 'debtIssueId');
    const projectId = await projectOf(debtIssueId, payload);
    const outcome = await apply(projectId, evidenceId, debtIssueId, actorOf(request));
    return { ok: true, ...outcome };
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
