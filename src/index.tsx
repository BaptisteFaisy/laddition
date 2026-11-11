import Resolver from '@forge/resolver';
import { RESOLVERS } from './resolvers/index';
import { bootstrapBatch } from './jobs/consumer';
import { nightlyRecalc, publishRepayments } from './jobs/scheduled';
import { issueCreated, issueUpdated, linkCreated, linkDeleted } from './jobs/triggers';
import { jqlTopDebts } from './resolvers/jql';
import { smokeTriggerHandler } from './jobs/smokeTrigger';
import {
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './mcp/actions';

/**
 * Point d'entrée Forge de « L'addition ».
 *
 * Trois surfaces, et rien d'autre :
 * - `resolver` : les clés appelées par les écrans (§14) ;
 * - les fonctions nommées que le manifeste appelle telles quelles : triggers
 *   Jira, `scheduledTrigger`, `consumer`, fonction JQL ;
 * - les huit actions Rovo / `rovo:mcp` (§13).
 *
 * Les noms exportés ici sont ceux du manifeste : les renommer casse le
 * déploiement sans erreur de compilation, d'où ce fichier unique et court.
 */

const resolverInstance = new Resolver();
for (const [key, handler] of Object.entries(RESOLVERS)) resolverInstance.define(key, handler);

/** Resolver des écrans, référencé par `handler: index.resolver`. */
export const resolver = resolverInstance.getDefinitions();

export default resolver;

/**
 * Triggers Jira (§15) : au fil de l'eau, sans calcul lourd.
 * `avi:jira:created:issue`, `avi:jira:updated:issue`,
 * `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink`.
 */
export { issueCreated, issueUpdated, linkCreated, linkDeleted };

/**
 * `scheduledTrigger` (§15) : recalcul nocturne et bulletins de remboursement.
 * Les deux sont exportés séparément pour que le manifeste choisisse lequel
 * tourne à quelle heure.
 */
export { nightlyRecalc, publishRepayments };

/** `consumer` (§15) : un lot de 50 tickets d'initialisation, `timeoutSeconds: 900`. */
export { bootstrapBatch };

/** `jira:jqlFunction` (DT-19) : les dettes les plus coûteuses du projet. */
export { jqlTopDebts };

/** `webtrigger` : diagnostic de bout en bout (SQL, REST Jira, domaine). */
export { smokeTriggerHandler };

/**
 * Actions Rovo et outils MCP (§13). Chacune a sa propre fonction dans le
 * manifeste : l'agent peut en invoquer une sans charger les autres.
 */
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
