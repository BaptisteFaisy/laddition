import Resolver from '@forge/resolver';
import { RESOLVERS } from './resolvers/index.ts';
import { bootstrapBatch } from './jobs/consumer.ts';
import { nightlyRecalc, publishRepayments } from './jobs/scheduled.ts';
import { issueCreated, issueUpdated, linkCreated, linkDeleted } from './jobs/triggers.ts';
import { jqlTopDebts } from './resolvers/jql.ts';

/**
 * Point d'entrée Forge de « L'addition ».
 *
 * Deux surfaces, et rien d'autre :
 * - le resolver par défaut, qui expose les clés appelées par les écrans (§14) ;
 * - les fonctions nommées que le manifeste appelle telles quelles : triggers
 *   Jira, `scheduledTrigger`, `consumer`, fonction JQL.
 *
 * Les noms exportés ici sont ceux du manifeste : les renommer casse le
 * déploiement sans erreur de compilation, d'où ce fichier unique et court.
 */

/** Resolver des écrans : `new Resolver().define({...})`, une clé par écran. */
const resolver = new Resolver();
for (const [key, handler] of Object.entries(RESOLVERS)) resolver.define(key, handler);

export default resolver.getDefinitions();

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
