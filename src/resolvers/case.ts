import type { Request } from '@forge/resolver';
import type { DebtBill } from '../core/types';
import type { DebtCaseData } from '../mcp/debtCase';
import { collectDebtCase } from '../mcp/debtCase';
import { getIssueFact } from '../platform/db/index';
import type { Argumentaire } from '../platform/llm';
import { writeArgumentaire } from '../platform/llm';
import type { Failure } from '../jobs/support';
import { guard, optionalString, payloadOf } from '../jobs/support';

/**
 * §7.6 (item E68) : la page d'argumentaire d'une dette.
 *
 * Le même contenu que l'outil MCP `get-debt-case`, construit par la même
 * fonction (`collectDebtCase`) : une seule implémentation par logique (§18).
 * L'écran et l'agent lisent donc exactement les mêmes chiffres — coût en
 * fourchette, preuves principales, remboursement, retour et limites de la
 * méthode.
 *
 * DT-17 : le texte rédigé vient de `writeArgumentaire()` (`platform/llm.ts`),
 * branchée ici. Son repli déterministe (le gabarit) prend le relais quand le
 * modèle échoue — l'écran ne rédige rien et ne calcule rien.
 *
 * Clé attendue : `issueKey` (la clé Jira, ex. `PAY-77`). `debtIssueId` est
 * accepté par tolérance, comme les autres écrans qui raisonnent en identifiant.
 */

/** Écran « argumentaire » : la page d'une dette, chiffres, texte et limites. */
export interface DebtCaseView extends DebtCaseData {
  /** L'addition calculée, réutilisée telle quelle par les écrans (bloc « retour »). */
  bill: DebtBill;
  /** Le texte rédigé d'une page ; `source` dit si le modèle a servi. */
  argumentaire: Argumentaire;
}

/** Résolveur : la page d'argumentaire d'une dette, chiffres **et** texte rédigé. */
export async function getDebtCase(request: Request<unknown>): Promise<DebtCaseView | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const issueKey = optionalString(payload, 'issueKey') ?? (await keyOfIssueId(payload));
    if (!issueKey) {
      throw new Error('champ « issueKey » manquant ou vide : la clé du ticket de dette (ex. PAY-77)');
    }
    const collected = await collectDebtCase(issueKey);
    const argumentaire = await writeArgumentaire(collected.bill, collected.evidence, collected.settings);
    return { ...collected.data, bill: collected.bill, argumentaire };
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
