/**
 * Dépôts des faits de tickets et de leurs séjours de statut.
 *
 * Trois règles de la couche (C33, §17, §18) :
 * - **colonnes explicites** : jamais de `SELECT *`, qui traîne le
 *   `MEDIUMTEXT` de `description` sur des milliers de lignes ;
 * - **prédicats indexables** : la fenêtre est écrite sans `COALESCE` sur une
 *   colonne indexée, chaque branche de l'alternative portant son index ;
 * - **lectures bornées** : chaque `SELECT` est paginé (5 s maximum par
 *   requête), et le résultat complet est assemblé lot par lot.
 *
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 */

import type { IssueFact, StatusSpan } from '../../../core/types';
import type { PageRequest, SqlValue } from '../query';
import {
  chunkList,
  DEFAULT_BATCH_SIZE,
  insertRows,
  onDuplicateUpdate,
  replaceRows,
  selectAllBatched,
  selectPage,
  selectRows,
} from '../query';
import type { IssueFactRow, StatusSpanRow } from '../mappers';
import { toIssueFact, toStatusSpan } from '../mappers';
import { toDbBool, toDbDate, toDbDateRequired, toJson } from '../rows';

/* ------------------------------------------------------------- issue_fact */

/** Colonnes écrites, dans l'ordre du DDL ; la source unique des sélections. */
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
  'story_points',
  'history_truncated',
  'visible',
  'summary',
  'description',
] as const;

/** Lecture d'une ligne unique : toutes les colonnes, `description` comprise. */
const ISSUE_FACT_ONE = ISSUE_FACT_COLUMNS.join(', ');

/** Lecture en masse : `description` écartée, seul le poids lourd du schéma. */
const ISSUE_FACT_BULK = ISSUE_FACT_COLUMNS.filter((column) => column !== 'description').join(', ');

/**
 * Prédicat de la fenêtre d'analyse, sans `COALESCE` (C33).
 *
 * `created_at >= ? OR COALESCE(resolved_at, closed_at, created_at) >= ?`
 * n'utilise aucun index : la fonction cache la colonne. La forme ci-dessous est
 * équivalente au cas par cas et chaque branche porte son index
 * (`idx_issue_fact_created`, `_resolved`, `_closed`).
 */
const WINDOW_PREDICATE =
  'created_at >= ? OR (resolved_at IS NOT NULL AND resolved_at >= ?) ' +
  'OR (resolved_at IS NULL AND closed_at IS NOT NULL AND closed_at >= ?)';

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
    fact.storyPoints ?? null,
    toDbBool(fact.historyTruncated),
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
  const rows = await selectRows<IssueFactRow>(
    `SELECT ${ISSUE_FACT_ONE} FROM issue_fact WHERE issue_id = ? LIMIT 1`,
    [issueId],
  );
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
  const rows = await selectRows<IssueFactRow>(
    `SELECT ${ISSUE_FACT_ONE} FROM issue_fact WHERE issue_key = ? LIMIT 1`,
    [issueKey],
  );
  const row = rows[0];
  return row ? toIssueFact(row) : null;
}

/** Tickets de dette désignés par la règle du projet (DT-01). */
export async function listDebtIssues(projectId: string): Promise<IssueFact[]> {
  const rows = await selectAllBatched<IssueFactRow>(
    `SELECT ${ISSUE_FACT_BULK} FROM issue_fact
      WHERE project_id = ? AND is_debt = 1
      ORDER BY issue_key, issue_id`,
    [projectId],
  );
  return rows.map(toIssueFact);
}

/**
 * Tickets touchés par la fenêtre d'analyse : créés, résolus ou clos depuis
 * `fromIso`. Un ticket ancien mais fermé récemment compte : c'est là qu'est le
 * coût.
 *
 * Lecture paginée : `page` demande une page précise, son absence demande tout
 * le résultat — mais dans les deux cas par lots bornés (C33), jamais une seule
 * requête sur des milliers de lignes.
 */
export async function listIssuesInWindow(
  projectId: string,
  fromIso: string,
  page?: PageRequest,
): Promise<IssueFact[]> {
  const from = toDbDateRequired(fromIso);
  const query = `SELECT ${ISSUE_FACT_BULK} FROM issue_fact
      WHERE project_id = ? AND (${WINDOW_PREDICATE})
      ORDER BY created_at, issue_id`;
  const params: SqlValue[] = [projectId, from, from, from];
  const rows = page
    ? await selectPage<IssueFactRow>(query, params, page)
    : await selectAllBatched<IssueFactRow>(query, params);
  const facts = rows.map(toIssueFact);
  await attachDebtDescriptions(facts);
  return facts;
}

/**
 * Rattache la `description` aux seuls tickets de dette.
 *
 * Elle ne sert qu'au score de pertinence (`jobs/relevance.ts`), qui compare le
 * texte d'une preuve au texte d'une dette : la lire pour chaque ticket de la
 * fenêtre serait du `MEDIUMTEXT` pour rien.
 */
async function attachDebtDescriptions(facts: IssueFact[]): Promise<void> {
  const debts = facts.filter((fact) => fact.isDebt);
  if (debts.length === 0) return;
  const byId = new Map(debts.map((debt) => [debt.issueId, debt]));
  for (const group of chunkList([...byId.keys()], DEFAULT_BATCH_SIZE)) {
    const placeholders = group.map(() => '?').join(', ');
    const rows = await selectRows<{ issue_id: string; description: unknown }>(
      `SELECT issue_id, description FROM issue_fact WHERE issue_id IN (${placeholders})`,
      [...group],
    );
    for (const row of rows) {
      const fact = byId.get(row.issue_id);
      const description = typeof row.description === 'string' ? row.description : null;
      if (fact && description !== null) fact.description = description;
    }
  }
}

/* ------------------------------------------------------------- status_span */

const STATUS_SPAN_COLUMNS = ['issue_id', 'category', 'started_at', 'ended_at'] as const;

const STATUS_SPAN_SELECT = 'ss.issue_id, ss.category, ss.started_at, ss.ended_at';

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

/**
 * Séjours de statut d'un projet.
 *
 * `issueIds` restreint la lecture aux tickets voulus — en pratique ceux de la
 * fenêtre (C33) — et évite alors la jointure avec `issue_fact` : la clé
 * primaire de `status_span` commence par `issue_id`. Sans `issueIds`, la
 * jointure reste, mais elle est paginée par lots bornés.
 */
export async function listStatusSpans(
  projectId: string,
  issueIds?: readonly string[],
): Promise<StatusSpan[]> {
  if (issueIds && issueIds.length > 0) return listSpansOfIssues(issueIds);
  const rows = await selectAllBatched<StatusSpanRow>(
    `SELECT ${STATUS_SPAN_SELECT}
       FROM status_span ss
       JOIN issue_fact f ON f.issue_id = ss.issue_id
      WHERE f.project_id = ?
      ORDER BY ss.issue_id, ss.started_at`,
    [projectId],
  );
  return rows.map(toStatusSpan);
}

/** Séjours de statut de tickets connus, par lots d'identifiants. */
async function listSpansOfIssues(issueIds: readonly string[]): Promise<StatusSpan[]> {
  const spans: StatusSpan[] = [];
  for (const group of chunkList(issueIds, DEFAULT_BATCH_SIZE)) {
    const placeholders = group.map(() => '?').join(', ');
    const rows = await selectRows<StatusSpanRow>(
      `SELECT issue_id, category, started_at, ended_at
         FROM status_span
        WHERE issue_id IN (${placeholders})
        ORDER BY issue_id, started_at`,
      [...group],
    );
    spans.push(...rows.map(toStatusSpan));
  }
  return spans;
}
