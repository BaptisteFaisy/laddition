/**
 * Lignes SQL et leur projection vers les types de `src/core/types.ts`.
 *
 * Les lignes sont décrites en `snake_case` (le nom des colonnes), les objets
 * rendus en `camelCase` (le contrat du domaine). Toute conversion de valeur
 * passe par `rows.ts` : aucune règle de lecture n'est écrite deux fois.
 */

import type {
  Attribution,
  AttributionBasis,
  Baseline,
  BootstrapProgress,
  CostMethod,
  DebtBill,
  DebtRule,
  DebtRuleKind,
  Evidence,
  EvidenceDetail,
  Family,
  FamilyTotal,
  IssueFact,
  ProjectSettings,
  Rejection,
  Repayment,
  SizeClass,
  StatusCategory,
  StatusSpan,
  ZoneMode,
} from '../../core/types.ts';
import { makeSettings } from '../../core/settings.ts';
import {
  FAMILIES,
  parseJson,
  pickOne,
  toBool,
  toIso,
  toNumber,
  toNumberOrNull,
  toStringArray,
  toText,
  toTextOrNull,
} from './rows.ts';

const STATUS_CATEGORIES: readonly StatusCategory[] = ['todo', 'inprogress', 'done'];
const SIZE_CLASSES: readonly SizeClass[] = ['xs', 's', 'm', 'l', 'xl', 'unknown'];
const COST_METHODS: readonly CostMethod[] = ['logged', 'computed', 'approximated'];
const ATTRIBUTION_BASES: readonly AttributionBasis[] = ['link', 'confirmed', 'inferred'];
const DEBT_RULE_KINDS: readonly DebtRuleKind[] = ['issueType', 'label', 'jql'];
const ZONE_MODES: readonly ZoneMode[] = ['component', 'compass', 'service', 'label'];

/* ------------------------------------------------------------------ lignes */

export interface IssueFactRow {
  issue_id: string;
  project_id: string;
  project_key: string;
  issue_key: string;
  issue_type: string;
  is_bug: unknown;
  is_incident: unknown;
  is_debt: unknown;
  zones: unknown;
  created_at: unknown;
  resolved_at: unknown;
  closed_at: unknown;
  size: unknown;
  estimate_jp: unknown;
  logged_seconds: unknown;
  labels: unknown;
  components: unknown;
  affected_services: unknown;
  has_post_mortem: unknown;
  participants: unknown;
  visible: unknown;
  summary: unknown;
  description: unknown;
}

export interface StatusSpanRow {
  issue_id: string;
  category: unknown;
  started_at: unknown;
  ended_at: unknown;
}

export interface EvidenceRow {
  evidence_id: string;
  project_id: string;
  zone: string;
  family: unknown;
  source_issue_id: string;
  source_key: string;
  occurred_at: unknown;
  cost_jp: unknown;
  method: unknown;
  insufficient: unknown;
  visible: unknown;
  detail: unknown;
}

export interface AttributionRow {
  evidence_id: string;
  debt_issue_id: string;
  share: unknown;
  basis: unknown;
  relevance: unknown;
  rationale: unknown;
}

export interface RejectionRow {
  evidence_id: string;
  debt_issue_id: string;
  rejected_by: unknown;
  rejected_at: unknown;
}

export interface DebtBillRow {
  debt_issue_id: string;
  issue_key: string;
  computed_at: unknown;
  low_jp: unknown;
  high_jp: unknown;
  by_family: unknown;
  evidence_ids: unknown;
  hidden_count: unknown;
  repayment_jp: unknown;
  avoidable_jp: unknown;
  roi_low: unknown;
  roi_high: unknown;
  payback_days: unknown;
}

export interface ZoneWeekRow {
  zone: string;
  week: string;
  cost_jp: unknown;
  by_family: unknown;
  team: unknown;
  project_key: unknown;
}

export interface BaselineRow {
  issue_type: string;
  size_class: unknown;
  median_days: unknown;
  sample_size: unknown;
  computed_at: unknown;
}

export interface RepaymentRow {
  debt_issue_id: string;
  issue_key: string;
  zone: string;
  closed_at: unknown;
  before_rate: unknown;
  after_rate: unknown;
  weeks_before: unknown;
  weeks_after: unknown;
  caveats: unknown;
  published_at: unknown;
}

export interface SettingsRow {
  project_id: string;
  project_key: string;
  debt_rule: unknown;
  zone_mode: unknown;
  zone_label_field: unknown;
  hours_per_day: unknown;
  days_per_week: unknown;
  window_days: unknown;
  dead_days: unknown;
  occupation_coefficient: unknown;
  persistence_factor: unknown;
  min_baseline_sample: unknown;
  clip_percentile: unknown;
  max_incident_people: unknown;
  post_mortem_bonus_jp: unknown;
  relevance_floor: unknown;
  phantom_threshold_jp: unknown;
  jsm_project_keys: unknown;
  team_by_zone: unknown;
  day_rate_eur: unknown;
  demo_data: unknown;
}

export interface BootstrapProgressRow {
  project_id: string;
  total: unknown;
  done: unknown;
  failed: unknown;
  started_at: unknown;
  updated_at: unknown;
  finished: unknown;
}

/* --------------------------------------------------------------- projection */

/** Ligne `issue_fact` → fait de ticket. */
export function toIssueFact(row: IssueFactRow): IssueFact {
  const fact: IssueFact = {
    issueId: row.issue_id,
    key: row.issue_key,
    projectId: row.project_id,
    projectKey: row.project_key,
    type: row.issue_type,
    isBug: toBool(row.is_bug),
    isIncident: toBool(row.is_incident),
    isDebt: toBool(row.is_debt),
    zones: toStringArray(row.zones),
    createdAt: toIso(row.created_at) ?? '',
    resolvedAt: toIso(row.resolved_at),
    closedAt: toIso(row.closed_at),
    size: pickOne(row.size, SIZE_CLASSES, 'unknown'),
    estimateJp: toNumberOrNull(row.estimate_jp),
    loggedSeconds: toNumberOrNull(row.logged_seconds),
    labels: toStringArray(row.labels),
    components: toStringArray(row.components),
    affectedServices: toStringArray(row.affected_services),
    hasPostMortem: toBool(row.has_post_mortem),
    participants: toNumber(row.participants),
    visible: toBool(row.visible, true),
    summary: toText(row.summary),
  };
  const description = toTextOrNull(row.description);
  if (description !== null) fact.description = description;
  return fact;
}

/** Ligne `status_span` → séjour de statut. */
export function toStatusSpan(row: StatusSpanRow): StatusSpan {
  return {
    issueId: row.issue_id,
    category: pickOne(row.category, STATUS_CATEGORIES, 'todo'),
    startedAt: toIso(row.started_at) ?? '',
    endedAt: toIso(row.ended_at),
  };
}

/** Ligne `evidence` → preuve, détail compris. */
export function toEvidence(row: EvidenceRow): Evidence {
  const evidence: Evidence = {
    id: row.evidence_id,
    zone: row.zone,
    family: pickOne(row.family, FAMILIES, 'C1'),
    sourceIssueId: row.source_issue_id,
    sourceKey: row.source_key,
    occurredAt: toIso(row.occurred_at) ?? '',
    costJp: toNumber(row.cost_jp),
    method: pickOne(row.method, COST_METHODS, 'computed'),
    visible: toBool(row.visible, true),
    detail: toEvidenceDetail(row.detail),
  };
  if (toBool(row.insufficient)) evidence.insufficient = true;
  return evidence;
}

/** Ligne `attribution` → part imputée à un ticket de dette. */
export function toAttribution(row: AttributionRow): Attribution {
  return {
    evidenceId: row.evidence_id,
    debtIssueId: row.debt_issue_id,
    share: toNumber(row.share),
    basis: pickOne(row.basis, ATTRIBUTION_BASES, 'inferred'),
    relevance: toNumber(row.relevance),
    rationale: toText(row.rationale),
  };
}

/** Ligne `rejection` → rejet de rapprochement. */
export function toRejection(row: RejectionRow): Rejection {
  return {
    evidenceId: row.evidence_id,
    debtIssueId: row.debt_issue_id,
    rejectedBy: toText(row.rejected_by),
    at: toIso(row.rejected_at) ?? '',
  };
}

/** Ligne `debt_bill` → addition d'un ticket de dette. */
export function toDebtBill(row: DebtBillRow): DebtBill {
  return {
    debtIssueId: row.debt_issue_id,
    key: row.issue_key,
    computedAt: toIso(row.computed_at) ?? '',
    lowJp: toNumber(row.low_jp),
    highJp: toNumber(row.high_jp),
    byFamily: toFamilyTotals(row.by_family),
    evidenceIds: toStringArray(row.evidence_ids),
    hiddenCount: toNumber(row.hidden_count),
    repaymentJp: toNumberOrNull(row.repayment_jp),
    avoidableJp: toNumberOrNull(row.avoidable_jp),
    roiLow: toNumberOrNull(row.roi_low),
    roiHigh: toNumberOrNull(row.roi_high),
    paybackDays: toNumberOrNull(row.payback_days),
  };
}

/** Ligne `baseline` → référence de la famille C3. */
export function toBaseline(row: BaselineRow): Baseline {
  return {
    issueType: row.issue_type,
    sizeClass: pickOne(row.size_class, SIZE_CLASSES, 'unknown'),
    medianDays: toNumber(row.median_days),
    sampleSize: toNumber(row.sample_size),
    computedAt: toIso(row.computed_at) ?? '',
  };
}

/** Ligne `repayment` → bulletin avant/après. */
export function toRepayment(row: RepaymentRow): Repayment {
  return {
    debtIssueId: row.debt_issue_id,
    key: row.issue_key,
    zone: row.zone,
    closedAt: toIso(row.closed_at) ?? '',
    beforeRate: toNumber(row.before_rate),
    afterRate: toNumber(row.after_rate),
    weeksBefore: toNumber(row.weeks_before),
    weeksAfter: toNumber(row.weeks_after),
    caveats: toStringArray(row.caveats),
    publishedAt: toIso(row.published_at),
  };
}

/** Ligne `bootstrap_progress` → état de l'initialisation. */
export function toBootstrapProgress(row: BootstrapProgressRow): BootstrapProgress {
  return {
    projectId: row.project_id,
    total: toNumber(row.total),
    done: toNumber(row.done),
    failed: toNumber(row.failed),
    startedAt: toIso(row.started_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
    finished: toBool(row.finished),
  };
}

/**
 * Ligne `settings` → réglages complets.
 *
 * La fusion avec les défauts passe par `makeSettings()` : bornage et valeurs
 * par défaut restent l'affaire de `core/`, jamais de la couche SQL.
 */
export function toProjectSettings(row: SettingsRow): ProjectSettings {
  return makeSettings(row.project_id, row.project_key, {
    debtRule: toDebtRule(row.debt_rule),
    zoneMode: pickOne(row.zone_mode, ZONE_MODES, 'component'),
    zoneLabelField: toTextOrNull(row.zone_label_field) ?? undefined,
    hoursPerDay: toNumber(row.hours_per_day, 7),
    daysPerWeek: toNumber(row.days_per_week, 5),
    windowDays: toNumber(row.window_days, 90),
    deadDays: toNumber(row.dead_days, 180),
    occupationCoefficient: toNumber(row.occupation_coefficient, 0.5),
    persistenceFactor: toNumber(row.persistence_factor, 0.7),
    minBaselineSample: toNumber(row.min_baseline_sample, 5),
    clipPercentile: toNumber(row.clip_percentile, 95),
    maxIncidentPeople: toNumber(row.max_incident_people, 6),
    postMortemBonusJp: toNumber(row.post_mortem_bonus_jp, 0.5),
    relevanceFloor: toNumber(row.relevance_floor, 0.3),
    phantomThresholdJp: toNumber(row.phantom_threshold_jp, 10),
    jsmProjectKeys: toStringArray(row.jsm_project_keys),
    teamByZone: toStringRecord(row.team_by_zone),
    dayRateEur: toNumberOrNull(row.day_rate_eur) ?? undefined,
    demoData: toBool(row.demo_data),
  });
}

/* ----------------------------------------------------------------- détails */

/** Règle de désignation des tickets de dette, stockée en JSON. */
function toDebtRule(value: unknown): DebtRule {
  const raw = parseJson<Record<string, unknown>>(value, {});
  return {
    kind: pickOne(raw['kind'], DEBT_RULE_KINDS, 'label'),
    value: toText(raw['value'], 'tech-debt'),
  };
}

/** Détail d'une preuve, affiché au clic (§18). */
function toEvidenceDetail(value: unknown): EvidenceDetail {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const detail: EvidenceDetail = {
    durationDays: toNumber(raw['durationDays']),
    method: pickOne(raw['method'], COST_METHODS, 'computed'),
    formula: toText(raw['formula']),
    inputs: toInputRecord(raw['inputs']),
    familyLabel: toText(raw['familyLabel']),
  };
  const sourceSummary = toTextOrNull(raw['sourceSummary']);
  if (sourceSummary !== null) detail.sourceSummary = sourceSummary;
  return detail;
}

/** Entrées de formule : uniquement des scalaires affichables. */
function toInputRecord(value: unknown): Record<string, number | string | boolean | null> {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (item === null || typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean') {
      out[key] = item;
    }
  }
  return out;
}

/** Ventilation par famille d'une addition, familles manquantes à zéro. */
function toFamilyTotals(value: unknown): Record<Family, FamilyTotal> {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const out = {} as Record<Family, FamilyTotal>;
  for (const family of FAMILIES) {
    const item = parseJson<Record<string, unknown>>(raw[family], {});
    out[family] = {
      lowJp: toNumber(item['lowJp']),
      highJp: toNumber(item['highJp']),
      evidenceCount: toNumber(item['evidenceCount']),
      insufficient: toBool(item['insufficient']),
    };
  }
  return out;
}

/** Correspondance zone → équipe (réglages). */
function toStringRecord(value: unknown): Record<string, string> {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}
