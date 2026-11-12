import { runStatement } from '../platform/db/query';

/**
 * Retire le bulletin d'une dette (§19 cas 8, B17).
 *
 * « Dette close puis rouverte : le bulletin de remboursement est retiré et
 * recalculé à la clôture suivante. » Le dépôt expose l'écriture et la lecture
 * des bulletins, pas leur suppression : comme pour les rejets
 * (`jobs/rejections.ts`), c'est ici, en une instruction.
 *
 * TODO(integration) : déplacer vers `platform/db/repos/project.ts` (avec
 * `upsertRepayments` et `listRepayments`) quand le dépôt regroupera les
 * écritures de bulletins.
 */
export async function removeRepayment(projectId: string, debtIssueId: string): Promise<void> {
  await runStatement('DELETE FROM repayment WHERE project_id = ? AND debt_issue_id = ?', [
    projectId,
    debtIssueId,
  ]);
}
