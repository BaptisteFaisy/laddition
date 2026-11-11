import type { Request } from '@forge/resolver';
import { listBills } from '../platform/db/index';
import { projectIdByKey, listProjectIds } from '../jobs/projects';
import type { Failure } from '../jobs/support';
import { guard, payloadOf } from '../jobs/support';

/**
 * DT-19 : fonction JQL « dettes les plus coûteuses ».
 *
 * JQL ne sait pas classer par un champ calculé sans le champ lui-même : la
 * fonction rend donc la liste explicite des clés, triée par coût décroissant,
 * et Jira l'utilise comme n'importe quel prédicat.
 *
 * TODO(integration) : confirmer la forme exacte attendue par le module
 * `jira:jqlFunction` (`{ jql }` ci-dessous) lors du premier `forge deploy`.
 */

/** Plafond de la liste rendue : une JQL trop longue est refusée par Jira. */
const MAX_KEYS = 50;

/** Clé JQL : les dettes les plus coûteuses du projet, plafonnées. */
export async function jqlTopDebts(request: Request<unknown>): Promise<{ jql: string } | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const projectKey = typeof payload['projectKey'] === 'string' ? payload['projectKey'] : '';
    const projectId = projectKey ? await projectIdByKey(projectKey) : (await listProjectIds())[0] ?? null;
    if (!projectId) throw new Error('aucun projet réglé : ouvrir l\'écran Réglages');
    const bills = await listBills(projectId);
    const keys = bills
      .slice()
      .sort((a, b) => b.lowJp - a.lowJp)
      .slice(0, MAX_KEYS)
      .map((bill) => bill.key);
    if (keys.length === 0) return { jql: 'issue in (EMPTY)' };
    return { jql: `issue in (${keys.map(quoteKey).join(', ')})` };
  });
}

/** Clé de ticket entre guillemets, comme l'attend JQL. */
function quoteKey(key: string): string {
  return `"${key.replace(/"/g, '\\"')}"`;
}
