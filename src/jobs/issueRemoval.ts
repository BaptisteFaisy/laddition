import { runStatement } from '../platform/db/query';

/**
 * Un ticket supprimé sort de la base (B23, `avi:jira:deleted:issue`).
 *
 * Sans ce nettoyage, un ticket effacé chez Jira continue d'alimenter
 * l'addition : ses preuves restent comptées, son addition reste classée, et
 * l'écran propose un ticket que plus personne ne peut ouvrir. Les enfants sont
 * effacés avant les parents (§17 : pas de clé étrangère).
 *
 * TODO(integration) : `deleteIssue` a sa place dans
 * `platform/db/repos/issues.ts`, à côté de `upsertIssueFacts` ; tant que le
 * dépôt ne l'expose pas, la suppression vit ici, en instructions bornées.
 */
export async function deleteIssue(issueId: string): Promise<void> {
  await runStatement(
    'DELETE FROM attribution WHERE evidence_id IN (SELECT evidence_id FROM evidence WHERE source_issue_id = ?)',
    [issueId],
  );
  await runStatement('DELETE FROM attribution WHERE debt_issue_id = ?', [issueId]);
  await runStatement('DELETE FROM evidence WHERE source_issue_id = ?', [issueId]);
  await runStatement('DELETE FROM repayment WHERE debt_issue_id = ?', [issueId]);
  await runStatement('DELETE FROM debt_bill WHERE debt_issue_id = ?', [issueId]);
  await runStatement('DELETE FROM status_span WHERE issue_id = ?', [issueId]);
  await runStatement('DELETE FROM issue_fact WHERE issue_id = ?', [issueId]);
}
