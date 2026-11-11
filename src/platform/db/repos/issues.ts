/**
 * Dépôts des faits de tickets et de leurs séjours de statut.
 *
 * Une fonction par besoin, un aller-retour SQL par fonction, paramètres liés.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 */

import type { IssueFact, StatusSpan } from '../../../core/types';
import type { SqlValue } from '../query';
import { insertRows, onDuplicateUpdate, replaceRows, selectRows } from '../query';
import type { IssueFactRow, StatusSpanRow } from '../mappers';
import { toIssueFact, toStatusSpan } from '../mappers';
import { toDbBool, toDbDate, toDbDateRequired, toJson } from '../rows';
/* ------------------------------------------------------------- issue_fact */


const ISSUE_FACT_COLUMNS = [
  'issue_id',
  'project_id',
  'project_key',
  'issue_key',
  'issue_type',
  'is_bug',
  'is_incident',
  'is_debt',
  'zones',
  'created_at',
  'resolved_at',
  'closed_at',
  'size',
  'estimate_jp',
  'logged_seconds',
  'labels',
  'components',
  'affected_services',
  'has_post_mortem',
  'participants',
  'visible',
  'summary',
  'description',
] as const;

function issueFactValues(fact: IssueFact): SqlValue[] {
  return [
    fact.issueId,
    fact.projectId,
    fact.projectKey,
    fact.key,
    fact.type,
    toDbBool(fact.isBug),
    toDbBool(fact.isIncident),
    toDbBool(fact.isDebt),
    toJson(fact.zones),
    toDbDateRequired(fact.createdAt),
    toDbDate(fact.resolvedAt),
    toDbDate(fact.closedAt),
    fact.size,
    fact.estimateJp,
    fact.loggedSeconds,
    toJson(fact.labels),
    toJson(fact.components),
    toJson(fact.affectedServices),
    toDbBool(fact.hasPostMortem),
    fact.participants,
    toDbBool(fact.visible),
    fact.summary,
    fact.description ?? null,
  ];
}

/** Insère ou rafraîchit des faits de tickets (un seul `INSERT` groupé). */
export async function upsertIssueFacts(facts: IssueFact[]): Promise<void> {
  if (facts.length === 0) return;
  await insertRows({
    table: 'issue_fact',
    columns: ISSUE_FACT_COLUMNS,
    rows: facts,
    toValues: issueFactValues,
    onDuplicate: onDuplicateUpdate(ISSUE_FACT_COLUMNS, ['issue_id']),
  });
}

/** Lit un fait de ticket, ou `null` s'il n'est pas encore synchronisé. */
export async function getIssueFact(issueId: string): Promise<IssueFact | null> {
  const rows = await selectRows<IssueFactRow>('SELECT * FROM issue_fact WHERE issue_id = ? LIMIT 1', [issueId]);
  const row = rows[0];
  return row ? toIssueFact(row) : null;
}

/**
 * Lit un fait de ticket par sa clé Jira (`PAY-77`).
 *
 * Sert aux outils MCP : un agent donne une clé, pas un identifiant de projet.
 * La clé est indexée (`idx_issue_fact_key`), la lecture est directe et ne
 * suppose rien du projet qui l'héberge.
 */
export async function getIssueFactByKey(issueKey: string): Promise<IssueFact | null> {
  const rows = await selectRows<IssueFactRow>('SELECT * FROM issue_fact WHERE issue_key = ? LIMIT 1', [issueKey]);
  const row = rows[0];
  return row ? toIssueFact(row) : null;
}

/** Tickets de dette désignés par la règle du projet (DT-01). */
export async function listDebtIssues(projectId: string): Promise<IssueFact[]> {
  const rows = await selectRows<IssueFactRow>(
    'SELECT * FROM issue_fact WHERE project_id = ? AND is_debt = 1 ORDER BY issue_key',
    [projectId],
  );
  return rows.map(toIssueFact);
}

/**
 * Tickets touchés par la fenêtre d'analyse : créés, ou clos, depuis `fromIso`.
 * Un ticket ancien mais fermé récemment compte : c'est là qu'est le coût.
 */
export async function listIssuesInWindow(projectId: string, fromIso: string): Promise<IssueFact[]> {
  const from = toDbDateRequired(fromIso);
  const rows = await selectRows<IssueFactRow>(
    `SELECT * FROM issue_fact
      WHERE project_id = ?
        AND (created_at >= ? OR COALESCE(resolved_at, closed_at, created_at) >= ?)
      ORDER BY created_at`,
    [projectId, from, from],
  );
  return rows.map(toIssueFact);
}

/* ------------------------------------------------------------- status_span */


const STATUS_SPAN_COLUMNS = ['issue_id', 'category', 'started_at', 'ended_at'] as const;

function statusSpanValues(span: StatusSpan): SqlValue[] {
  return [span.issueId, span.category, toDbDateRequired(span.startedAt), toDbDate(span.endedAt)];
}

/** Remplace l'historique de statuts d'un ticket (DT-03). */
export async function replaceStatusSpans(issueId: string, spans: StatusSpan[]): Promise<void> {
  await replaceRows({
    table: 'status_span',
    columns: STATUS_SPAN_COLUMNS,
    rows: spans,
    toValues: statusSpanValues,
    onDuplicate: onDuplicateUpdate(STATUS_SPAN_COLUMNS, ['issue_id', 'started_at']),
    where: 'issue_id = ?',
    whereParams: [issueId],
  });
}

/** Séjours de statut de tous les tickets d'un projet, joints sur `issue_fact`. */
export async function listStatusSpans(projectId: string): Promise<StatusSpan[]> {
  const rows = await selectRows<StatusSpanRow>(
    `SELECT ss.issue_id, ss.category, ss.started_at, ss.ended_at
       FROM status_span ss
       JOIN issue_fact f ON f.issue_id = ss.issue_id
      WHERE f.project_id = ?
      ORDER BY ss.issue_id, ss.started_at`,
    [projectId],
  );
  return rows.map(toStatusSpan);
}
