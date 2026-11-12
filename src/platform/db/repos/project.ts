/**
 * Dépôts des références C3, des bulletins, des réglages et de l'initialisation.
 *
 * Une fonction par besoin, paramètres liés, colonnes explicites.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 */

import type { Baseline, BootstrapProgress, ProjectSettings, Repayment } from '../../../core/types';
import type { SqlValue } from '../query';
import {
  insertRows,
  onDuplicateUpdate,
  projectIdsOfIssues,
  replaceRows,
  selectAllBatched,
  selectRows,
} from '../query';
import type { BaselineRow, BootstrapProgressRow, RepaymentRow, SettingsRow } from '../mappers';
import { toBaseline, toBootstrapProgress, toProjectSettings, toRepayment } from '../mappers';
import { toDbBool, toDbDate, toDbDateRequired, toJson, toTextOrNull } from '../rows';

/* ------------------------------------------------------------- baseline */

const BASELINE_COLUMNS = [
  'project_id',
  'issue_type',
  'size_class',
  'median_days',
  'sample_size',
  'computed_at',
] as const;

/** Lecture : `project_id` sert de filtre, pas de projection. */
const BASELINE_SELECT = BASELINE_COLUMNS.filter((column) => column !== 'project_id').join(', ');

function baselineValues(baseline: Baseline, projectId: string): SqlValue[] {
  return [
    projectId,
    baseline.issueType,
    baseline.sizeClass,
    baseline.medianDays,
    baseline.sampleSize,
    toDbDateRequired(baseline.computedAt),
  ];
}

/** Remplace les références C3 d'un projet (médianes par type et taille). */
export async function replaceBaselines(projectId: string, baselines: Baseline[]): Promise<void> {
  await replaceRows({
    table: 'baseline',
    columns: BASELINE_COLUMNS,
    rows: baselines,
    toValues: (item) => baselineValues(item, projectId),
    onDuplicate: onDuplicateUpdate(BASELINE_COLUMNS, ['project_id', 'issue_type', 'size_class']),
    where: 'project_id = ?',
    whereParams: [projectId],
  });
}

/** Références C3 enregistrées d'un projet. */
export async function listBaselines(projectId: string): Promise<Baseline[]> {
  const rows = await selectAllBatched<BaselineRow>(
    `SELECT ${BASELINE_SELECT} FROM baseline
      WHERE project_id = ?
      ORDER BY issue_type, size_class`,
    [projectId],
  );
  return rows.map(toBaseline);
}

/* ------------------------------------------------------------- repayment */

const REPAYMENT_COLUMNS = [
  'debt_issue_id',
  'project_id',
  'issue_key',
  'zone',
  'closed_at',
  'before_rate',
  'after_rate',
  'weeks_before',
  'weeks_after',
  'caveats',
  'published_at',
] as const;

const REPAYMENT_SELECT = REPAYMENT_COLUMNS.filter((column) => column !== 'project_id').join(', ');

function repaymentValues(repayment: Repayment, projectId: string): SqlValue[] {
  return [
    repayment.debtIssueId,
    projectId,
    repayment.key,
    repayment.zone,
    toDbDateRequired(repayment.closedAt),
    repayment.beforeRate,
    repayment.afterRate,
    repayment.weeksBefore,
    repayment.weeksAfter,
    toJson(repayment.caveats),
    toDbDate(repayment.publishedAt),
  ];
}

/**
 * Enregistre les bulletins d'un projet, en écriture groupée (C36 : le projet
 * est connu, aucune sous-requête par ligne).
 */
export async function upsertRepayments(projectId: string, repayments: readonly Repayment[]): Promise<void> {
  if (repayments.length === 0) return;
  await insertRows({
    table: 'repayment',
    columns: REPAYMENT_COLUMNS,
    rows: repayments,
    toValues: (item) => repaymentValues(item, projectId),
    onDuplicate: onDuplicateUpdate(REPAYMENT_COLUMNS, ['debt_issue_id']),
  });
}

/**
 * Enregistre le bulletin de remboursement d'un ticket de dette (§11).
 *
 * `projectId` évite une lecture ; absent, il est retrouvé en une requête sur
 * `issue_fact`. Un bulletin dont le ticket n'est pas synchronisé est une
 * anomalie d'appelant : elle est signalée.
 */
export async function upsertRepayment(repayment: Repayment, projectId?: string): Promise<void> {
  const resolved = projectId ?? (await projectIdsOfIssues([repayment.debtIssueId])).get(repayment.debtIssueId);
  if (resolved === undefined) throw new Error(`bulletin sans projet connu : ${repayment.debtIssueId}`);
  await upsertRepayments(resolved, [repayment]);
}

/** Bulletins publiés ou en préparation d'un projet. */
export async function listRepayments(projectId: string): Promise<Repayment[]> {
  const rows = await selectAllBatched<RepaymentRow>(
    `SELECT ${REPAYMENT_SELECT} FROM repayment
      WHERE project_id = ?
      ORDER BY closed_at DESC, debt_issue_id`,
    [projectId],
  );
  return rows.map(toRepayment);
}

/* ------------------------------------------------------------- settings */

const SETTINGS_COLUMNS = [
  'project_id',
  'project_key',
  'debt_rule',
  'zone_mode',
  'zone_label_field',
  'hours_per_day',
  'days_per_week',
  'window_days',
  'dead_days',
  'occupation_coefficient',
  'persistence_factor',
  'min_baseline_sample',
  'clip_percentile',
  'max_incident_people',
  'post_mortem_bonus_jp',
  'relevance_floor',
  'phantom_threshold_jp',
  'jsm_project_keys',
  'team_by_zone',
  'day_rate_eur',
  'story_point_field',
  'demo_data',
] as const;

const SETTINGS_SELECT = SETTINGS_COLUMNS.join(', ');

function settingsValues(settings: ProjectSettings): SqlValue[] {
  return [
    settings.projectId,
    settings.projectKey,
    toJson(settings.debtRule),
    settings.zoneMode,
    settings.zoneLabelField ?? null,
    settings.hoursPerDay,
    settings.daysPerWeek,
    settings.windowDays,
    settings.deadDays,
    settings.occupationCoefficient,
    settings.persistenceFactor,
    settings.minBaselineSample,
    settings.clipPercentile,
    settings.maxIncidentPeople,
    settings.postMortemBonusJp,
    settings.relevanceFloor,
    settings.phantomThresholdJp,
    toJson(settings.jsmProjectKeys),
    toJson(settings.teamByZone),
    settings.dayRateEur ?? null,
    settings.storyPointField ?? null,
    toDbBool(settings.demoData),
  ];
}

/** Réglages d'un projet, ou `null` avant la première visite de l'écran 6. */
export async function getSettings(projectId: string): Promise<ProjectSettings | null> {
  const rows = await selectRows<SettingsRow>(
    `SELECT ${SETTINGS_SELECT} FROM settings WHERE project_id = ? LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  return row ? toProjectSettings(row) : null;
}

/** Enregistre les réglages d'un projet (une ligne par projet). */
export async function saveSettings(settings: ProjectSettings): Promise<void> {
  await insertRows({
    table: 'settings',
    columns: SETTINGS_COLUMNS,
    rows: [settings],
    toValues: settingsValues,
    onDuplicate: onDuplicateUpdate(SETTINGS_COLUMNS, ['project_id']),
  });
}

/** Le champ Jira des story points, s'il est réglé (vide = pas de points). */
export async function storyPointFieldOf(projectId: string): Promise<string | null> {
  const settings = await getSettings(projectId);
  return toTextOrNull(settings?.storyPointField) ?? null;
}

/* ------------------------------------------------------------- bootstrap_progress */

const BOOTSTRAP_COLUMNS = [
  'project_id',
  'total',
  'done',
  'failed',
  'started_at',
  'updated_at',
  'finished',
  'error',
  'attempts',
] as const;

const BOOTSTRAP_SELECT = BOOTSTRAP_COLUMNS.join(', ');

function bootstrapValues(progress: BootstrapProgress): SqlValue[] {
  return [
    progress.projectId,
    progress.total,
    progress.done,
    progress.failed,
    toDbDateRequired(progress.startedAt),
    toDbDateRequired(progress.updatedAt),
    toDbBool(progress.finished),
    progress.error ?? null,
    progress.attempts ?? 0,
  ];
}

/** État de l'initialisation d'un projet, ou `null` si elle n'a pas commencé. */
export async function bootstrapProgress(projectId: string): Promise<BootstrapProgress | null> {
  const rows = await selectRows<BootstrapProgressRow>(
    `SELECT ${BOOTSTRAP_SELECT} FROM bootstrap_progress WHERE project_id = ? LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  return row ? toBootstrapProgress(row) : null;
}

/** Met à jour la progression de l'initialisation (lue par la barre, DT-12). */
export async function updateBootstrapProgress(progress: BootstrapProgress): Promise<void> {
  await insertRows({
    table: 'bootstrap_progress',
    columns: BOOTSTRAP_COLUMNS,
    rows: [progress],
    toValues: bootstrapValues,
    onDuplicate: onDuplicateUpdate(BOOTSTRAP_COLUMNS, ['project_id']),
  });
}
