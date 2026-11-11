import { runStatement } from '../platform/db/query.ts';

/**
 * Rejets de rapprochement : écriture par le dépôt (`insertRejection`), retrait ici.
 *
 * Un rejet se retire quand un humain confirme finalement le rapprochement : la
 * même décision ne peut pas être à la fois « rejeté » et « confirmé ». Le
 * dépôt du §16 ne fournit que l'insertion et la lecture ; la suppression est
 * une instruction, elle n'a pas besoin d'un fichier de plus côté plateforme.
 *
 * TODO(integration) : déplacer vers `platform/db/repos/costs.ts` quand les
 * décisions y seront regroupées.
 */
export async function removeRejection(
  projectId: string,
  evidenceId: string,
  debtIssueId: string,
): Promise<void> {
  await runStatement('DELETE FROM rejection WHERE project_id = ? AND evidence_id = ? AND debt_issue_id = ?', [
    projectId,
    evidenceId,
    debtIssueId,
  ]);
}
