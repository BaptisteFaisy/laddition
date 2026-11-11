/**
 * Dépôts des preuves, des parts imputées et des rejets de rapprochement.
 *
 * Une fonction par besoin, un aller-retour SQL par fonction, paramètres liés.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 */

import type { Attribution, Evidence, Rejection } from '../../../core/types';
import type { SqlValue } from '../query';
import { insertRows, onDuplicateUpdate, projectOfIssue, replaceRows, selectRows } from '../query';
import type { AttributionRow, EvidenceRow, RejectionRow } from '../mappers';
import { toAttribution, toEvidence, toRejection } from '../mappers';
import { toDbBool, toDbDateRequired, toJson } from '../rows';
/* ------------------------------------------------------------- evidence */


const EVIDENCE_COLUMNS = [
  'evidence_id',
  'project_id',
  'zone',
  'family',
  'source_issue_id',
  'source_key',
  'occurred_at',
  'cost_jp',
  'method',
  'insufficient',
  'visible',
  'detail',
] as const;

function evidenceValues(evidence: Evidence, projectId: string): SqlValue[] {
  return [
    evidence.id,
    projectId,
    evidence.zone,
    evidence.family,
    evidence.sourceIssueId,
    evidence.sourceKey,
    toDbDateRequired(evidence.occurredAt),
    evidence.costJp,
    evidence.method,
    toDbBool(evidence.insufficient),
    toDbBool(evidence.visible),
    toJson(evidence.detail),
  ];
}

/** Remplace toutes les preuves d'un projet (recalcul complet du lot). */
export async function replaceEvidence(projectId: string, evidence: Evidence[]): Promise<void> {
  await replaceRows({
    table: 'evidence',
    columns: EVIDENCE_COLUMNS,
    rows: evidence,
    toValues: (item) => evidenceValues(item, projectId),
    onDuplicate: onDuplicateUpdate(EVIDENCE_COLUMNS, ['evidence_id']),
    where: 'project_id = ?',
    whereParams: [projectId],
  });
}

/** Preuves enregistrées d'un projet, de la plus récente à la plus ancienne. */
export async function listEvidence(projectId: string): Promise<Evidence[]> {
  const rows = await selectRows<EvidenceRow>(
    'SELECT * FROM evidence WHERE project_id = ? ORDER BY occurred_at DESC, evidence_id',
    [projectId],
  );
  return rows.map(toEvidence);
}

/* ------------------------------------------------------------- attribution */


const ATTRIBUTION_COLUMNS = [
  'evidence_id',
  'debt_issue_id',
  'project_id',
  'share',
  'basis',
  'relevance',
  'rationale',
] as const;

function attributionValues(attribution: Attribution, projectId: string): SqlValue[] {
  return [
    attribution.evidenceId,
    attribution.debtIssueId,
    projectId,
    attribution.share,
    attribution.basis,
    attribution.relevance,
    attribution.rationale,
  ];
}

/** Remplace les parts imputées aux tickets de dette (§10). */
export async function replaceAttributions(projectId: string, attributions: Attribution[]): Promise<void> {
  await replaceRows({
    table: 'attribution',
    columns: ATTRIBUTION_COLUMNS,
    rows: attributions,
    toValues: (item) => attributionValues(item, projectId),
    onDuplicate: onDuplicateUpdate(ATTRIBUTION_COLUMNS, ['evidence_id', 'debt_issue_id']),
    where: 'project_id = ?',
    whereParams: [projectId],
  });
}

/** Parts imputées, relues par le calcul et par les écrans. */
export async function listAttributions(projectId: string): Promise<Attribution[]> {
  const rows = await selectRows<AttributionRow>(
    'SELECT * FROM attribution WHERE project_id = ? ORDER BY debt_issue_id, evidence_id',
    [projectId],
  );
  return rows.map(toAttribution);
}

/* ------------------------------------------------------------- rejection */


const REJECTION_COLUMNS = [
  'evidence_id',
  'debt_issue_id',
  'project_id',
  'rejected_by',
  'rejected_at',
] as const;

/** Enregistre un rejet : le rapprochement ne sera plus proposé (§7.4). */
export async function insertRejection(rejection: Rejection): Promise<void> {
  await insertRows({
    table: 'rejection',
    columns: REJECTION_COLUMNS,
    rows: [rejection],
    toValues: (item) => [
      item.evidenceId,
      item.debtIssueId,
      projectOfIssue(item.debtIssueId),
      item.rejectedBy,
      toDbDateRequired(item.at),
    ],
    onDuplicate: onDuplicateUpdate(REJECTION_COLUMNS, ['evidence_id', 'debt_issue_id']),
  });
}

/** Rejets enregistrés d'un projet, à exclure des propositions. */
export async function listRejections(projectId: string): Promise<Rejection[]> {
  const rows = await selectRows<RejectionRow>(
    'SELECT * FROM rejection WHERE project_id = ? ORDER BY rejected_at DESC',
    [projectId],
  );
  return rows.map(toRejection);
}
