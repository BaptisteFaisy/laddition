/**
 * Dépôts des preuves, des parts imputées et des rejets de rapprochement.
 *
 * Une fonction par besoin, paramètres liés, colonnes explicites.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 *
 * Les remplacements (`replaceEvidence`, `replaceAttributions`) passent par
 * l'écriture en deux temps de `query.ts` : sans transaction (§17), un projet
 * n'est jamais laissé sans preuves (C35).
 */

import type { Attribution, Evidence, Rejection } from '../../../core/types';
import type { SqlValue } from '../query';
import { insertRows, onDuplicateUpdate, projectIdsOfIssues, replaceRows, selectAllBatched } from '../query';
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

const EVIDENCE_SELECT = EVIDENCE_COLUMNS.join(', ');

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
  const rows = await selectAllBatched<EvidenceRow>(
    `SELECT ${EVIDENCE_SELECT} FROM evidence
      WHERE project_id = ?
      ORDER BY occurred_at DESC, evidence_id`,
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

/** Lecture : `project_id` sert de filtre, pas de projection. */
const ATTRIBUTION_SELECT = ATTRIBUTION_COLUMNS.filter((column) => column !== 'project_id').join(', ');

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
  const rows = await selectAllBatched<AttributionRow>(
    `SELECT ${ATTRIBUTION_SELECT} FROM attribution
      WHERE project_id = ?
      ORDER BY debt_issue_id, evidence_id`,
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

const REJECTION_SELECT = REJECTION_COLUMNS.filter((column) => column !== 'project_id').join(', ');

function rejectionValues(rejection: Rejection, projectId: string): SqlValue[] {
  return [
    rejection.evidenceId,
    rejection.debtIssueId,
    projectId,
    rejection.rejectedBy,
    toDbDateRequired(rejection.at),
  ];
}

/**
 * Enregistre des rejets d'un projet, en écriture groupée (C36 : même motif que
 * les additions — le projet est connu, aucune sous-requête par ligne).
 */
export async function insertRejections(projectId: string, rejections: readonly Rejection[]): Promise<void> {
  if (rejections.length === 0) return;
  await insertRows({
    table: 'rejection',
    columns: REJECTION_COLUMNS,
    rows: rejections,
    toValues: (item) => rejectionValues(item, projectId),
    onDuplicate: onDuplicateUpdate(REJECTION_COLUMNS, ['evidence_id', 'debt_issue_id']),
  });
}

/**
 * Enregistre un rejet : le rapprochement ne sera plus proposé (§7.4).
 *
 * `projectId` évite une lecture ; absent, il est retrouvé en une requête sur
 * `issue_fact`, jamais par une sous-requête dans l'`INSERT`.
 */
export async function insertRejection(rejection: Rejection, projectId?: string): Promise<void> {
  const resolved = projectId ?? (await projectIdsOfIssues([rejection.debtIssueId])).get(rejection.debtIssueId);
  if (resolved === undefined) throw new Error(`rejet sans projet connu : ${rejection.debtIssueId}`);
  await insertRejections(resolved, [rejection]);
}

/** Rejets enregistrés d'un projet, à exclure des propositions. */
export async function listRejections(projectId: string): Promise<Rejection[]> {
  const rows = await selectAllBatched<RejectionRow>(
    `SELECT ${REJECTION_SELECT} FROM rejection
      WHERE project_id = ?
      ORDER BY rejected_at DESC, evidence_id`,
    [projectId],
  );
  return rows.map(toRejection);
}
