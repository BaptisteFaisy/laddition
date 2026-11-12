/**
 * Surface publique des actions Rovo / MCP (§13).
 *
 * La table des actions (clés, verbes, handlers, entrées lues) vit dans
 * `registry.ts` : c'est elle que le manifeste doit refléter, et c'est elle que
 * `manifest.test.ts` vérifie (item E77). Ce fichier n'ajoute que l'invocation
 * par clé et les ré-exports utilisés par `src/index.tsx` et par les résolveurs.
 */

import type { ActionEnvelope, JsonPayload } from './result';
import { ACTIONS } from './registry';

/**
 * Exécute une action par sa clé. Une clé inconnue rend une enveloppe d'échec
 * plutôt qu'une exception : un agent qui se trompe de nom reçoit un message.
 */
export async function invokeAction(key: string, payload: JsonPayload): Promise<ActionEnvelope<unknown>> {
  const spec = ACTIONS[key];
  if (!spec) {
    const known = Object.keys(ACTIONS).join(', ');
    return { ok: false, error: `action inconnue : « ${key} » — actions disponibles : ${known}` };
  }
  return spec.handler(payload);
}

export * from './registry';

export {
  DEFAULT_RANKING_LIMIT,
  MAX_RANKING_LIMIT,
  MCP_ACTOR,
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './actions';
export { CASE_EVIDENCE_LIMIT, METHOD_LIMITS, buildDebtCase, getDebtCase } from './debtCase';
export { listZoneEvidence } from './zoneEvidence';
export { listProjects } from './projectList';
export { listInitializedProjects, projectKeyOf, projectOf, resolveProject } from './project';
export { maskEvidence, MASKED_FORMULA } from './masking';
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
  ZoneTrend,
} from './actions';
export type { DebtCaseData, DebtCaseEvidence, DebtCaseMethod } from './debtCase';
export type { ZoneEvidenceData, ZoneEvidenceRow } from './zoneEvidence';
export type { ListProjectsData } from './projectList';
export type { ProjectContext, ProjectSummary } from './project';
export type { MaskedEvidence } from './masking';
export type { Action, ActionEnvelope, AppliedNumber, JsonPayload } from './result';
