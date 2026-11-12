import type { Request } from '@forge/resolver';
import type { DebtCaseData } from '../mcp/debtCase';
import { buildDebtCase } from '../mcp/debtCase';
import { getIssueFact } from '../platform/db/index';
import type { Failure } from '../jobs/support';
import { guard, optionalString, payloadOf } from '../jobs/support';

/**
 * §7.6 (item E68) : la page d'argumentaire d'une dette.
 *
 * Le même contenu que l'outil MCP `get-debt-case`, construit par la même
 * fonction (`buildDebtCase`) : une seule implémentation par logique (§18).
 * L'écran et l'agent lisent donc exactement les mêmes chiffres — coût en
 * fourchette, preuves principales, remboursement, retour et limites de la
 * méthode.
 *
 * Clé attendue : `issueKey` (la clé Jira, ex. `PAY-77`). `debtIssueId` est
 * accepté par tolérance, comme les autres écrans qui raisonnent en identifiant.
 */

/** Écran « argumentaire » : la page d'une dette, chiffres et limites compris. */
export async function getDebtCase(request: Request<unknown>): Promise<DebtCaseData | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const issueKey = optionalString(payload, 'issueKey') ?? (await keyOfIssueId(payload));
    if (!issueKey) {
      throw new Error('champ « issueKey » manquant ou vide : la clé du ticket de dette (ex. PAY-77)');
    }
    return buildDebtCase(issueKey);
  });
}

/** Clé Jira d'un ticket visé par son identifiant ; `undefined` s'il est inconnu. */
async function keyOfIssueId(payload: Record<string, unknown>): Promise<string | undefined> {
  const issueId = optionalString(payload, 'debtIssueId');
  if (!issueId) return undefined;
  const fact = await getIssueFact(issueId);
  if (!fact) throw new Error(`ticket ${issueId} inconnu : lancer l'initialisation`);
  return fact.key;
}
