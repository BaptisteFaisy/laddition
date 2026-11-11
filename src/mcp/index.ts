/**
 * Table des actions exposées à Rovo et à `rovo:mcp` (§13).
 *
 * Une seule source de vérité : la clé du manifeste, le verbe et le handler sont
 * écrits ici. L'enregistrement Forge et le manifeste lisent cette table ;
 * personne ne redéclare une action ailleurs.
 */

import type { Action } from './result';
import {
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './actions';

/** Verbe d'une action : lecture seule, ou écriture. */
export type ActionVerb = 'GET' | 'UPDATE';

/** Une action du §13, telle que la déclare le manifeste. */
export interface ActionSpec {
  key: string;
  verb: ActionVerb;
  handler: Action;
}

/** Les huit actions du §13, dans l'ordre du cahier des charges. */
export const ACTIONS: Readonly<Record<string, ActionSpec>> = {
  'get-debt-ranking': { key: 'get-debt-ranking', verb: 'GET', handler: getDebtRanking },
  'get-debt-bill': { key: 'get-debt-bill', verb: 'GET', handler: getDebtBill },
  'get-zone-costs': { key: 'get-zone-costs', verb: 'GET', handler: getZoneCosts },
  'list-phantom-debt': { key: 'list-phantom-debt', verb: 'GET', handler: listPhantomDebt },
  'list-dead-debt': { key: 'list-dead-debt', verb: 'GET', handler: listDeadDebt },
  'get-repayment-report': { key: 'get-repayment-report', verb: 'GET', handler: getRepaymentReport },
  'draft-debt-ticket': { key: 'draft-debt-ticket', verb: 'GET', handler: draftDebtTicket },
  'confirm-evidence': { key: 'confirm-evidence', verb: 'UPDATE', handler: confirmEvidence },
};

/** Clés des actions, dans l'ordre de déclaration. */
export const ACTION_KEYS: readonly string[] = Object.keys(ACTIONS);

/**
 * Exécute une action par sa clé. Une clé inconnue rend une enveloppe d'échec
 * plutôt qu'une exception : un agent qui se trompe de nom reçoit un message.
 */
export async function invokeAction(
  key: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const spec = ACTIONS[key];
  if (!spec) return { ok: false, error: `action inconnue : « ${key} »` };
  return spec.handler(payload);
}

export {
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
};
export { agentDescription, agentForbiddenTopics, agentPrompt, agentStarters } from './agent';
export type {
  ConfirmEvidenceData,
  DeadDebtData,
  DebtBillData,
  DebtRankingData,
  DraftTicketData,
  PhantomDebtData,
  RepaymentData,
  ZoneCostData,
} from './actions';
export type { Action, ActionEnvelope, JsonPayload } from './result';
