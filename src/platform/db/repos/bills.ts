/**
 * Dépôts des additions par ticket de dette et des coûts par zone et par semaine.
 *
 * Une fonction par besoin, paramètres liés, colonnes explicites.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 *
 * Écriture des additions (C36) : `upsertBills` écrit tout un projet en un seul
 * `INSERT` groupé par lot, avec l'identifiant du projet en valeur liée. Plus de
 * sous-requête `(SELECT project_id FROM issue_fact …)` répétée ligne par ligne.
 */

import type { DebtBill, Family, ZoneCost } from '../../../core/types';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { UNCLASSIFIED_ZONE } from '../../../core/zones';
import type { SqlValue } from '../query';
import { insertRows, onDuplicateUpdate, projectIdsOfIssues, selectRows } from '../query';
import type { DebtBillRow, ZoneWeekRow } from '../mappers';
import { toDebtBill } from '../mappers';
import {
  FAMILIES,
  toDbDateRequired,
  toFamilyNumbers,
  toJson,
  toNumber,
  toText,
  toTextOrNull,
  zeroFamilyNumbers,
} from '../rows';

/* ------------------------------------------------------------- debt_bill */

/** Colonnes écrites, dans l'ordre du DDL ; la source unique des sélections. */
const DEBT_BILL_COLUMNS = [
  'debt_issue_id',
  'project_id',
  'issue_key',
  'computed_at',
  'low_jp',
  'high_jp',
  'by_family',
  'evidence_ids',
  'hidden_count',
  'repayment_jp',
  'avoidable_jp',
  'roi_low',
  'roi_high',
  'payback_days',
  'blocked_reason',
] as const;

/** Lecture : `project_id` sert de filtre, pas de projection. */
const DEBT_BILL_SELECT = DEBT_BILL_COLUMNS.filter((column) => column !== 'project_id').join(', ');

function debtBillValues(bill: DebtBill, projectId: string): SqlValue[] {
  return [
    bill.debtIssueId,
    projectId,
    bill.key,
    toDbDateRequired(bill.computedAt),
    bill.lowJp,
    bill.highJp,
    toJson(bill.byFamily),
    toJson(bill.evidenceIds),
    bill.hiddenCount,
    bill.repaymentJp,
    bill.avoidableJp,
    bill.roiLow,
    bill.roiHigh,
    bill.paybackDays,
    bill.blockedReason ?? null,
  ];
}

/**
 * Enregistre (ou remplace) les additions d'un projet, en écriture groupée.
 *
 * C'est la voie normale du calcul nocturne : le projet est connu, une requête
 * suffit pour un lot de 200 additions (C36).
 */
export async function upsertBills(projectId: string, bills: readonly DebtBill[]): Promise<void> {
  if (bills.length === 0) return;
  await insertRows({
    table: 'debt_bill',
    columns: DEBT_BILL_COLUMNS,
    rows: bills,
    toValues: (bill) => debtBillValues(bill, projectId),
    onDuplicate: onDuplicateUpdate(DEBT_BILL_COLUMNS, ['debt_issue_id']),
  });
}

/**
 * Enregistre (ou remplace) l'addition d'un ticket de dette (DT-06).
 *
 * `projectId` évite une lecture ; absent, il est retrouvé en une requête sur
 * `issue_fact`. Une addition dont le ticket n'est pas synchronisé est une
 * anomalie d'appelant : elle est signalée, pas écrite avec un projet vide.
 */
export async function upsertBill(bill: DebtBill, projectId?: string): Promise<void> {
  await upsertBills(projectId ?? (await requireProjectId(bill)), [bill]);
}

/** Projet d'une addition, par identifiant puis par clé Jira. */
async function requireProjectId(bill: DebtBill): Promise<string> {
  const byId = await projectIdsOfIssues([bill.debtIssueId]);
  const found = byId.get(bill.debtIssueId) ?? (await projectIdByKey(bill.key));
  if (!found) throw new Error(`addition sans projet connu : ${bill.debtIssueId}`);
  return found;
}

/** Projet d'un ticket retrouvé par sa clé Jira (indexée). */
async function projectIdByKey(issueKey: string): Promise<string | null> {
  const rows = await selectRows<{ project_id: string }>(
    'SELECT project_id FROM issue_fact WHERE issue_key = ? LIMIT 1',
    [issueKey],
  );
  return rows[0]?.project_id ?? null;
}

/** Additions d'un projet, la plus lourde d'abord (DT-07). */
export async function listBills(projectId: string): Promise<DebtBill[]> {
  const rows = await selectRows<DebtBillRow>(
    `SELECT ${DEBT_BILL_SELECT} FROM debt_bill WHERE project_id = ? ORDER BY low_jp DESC, issue_key`,
    [projectId],
  );
  return rows.map(toDebtBill);
}

/** Addition d'un ticket de dette, ou `null` si elle n'est pas encore calculée. */
export async function getBill(debtIssueId: string): Promise<DebtBill | null> {
  const rows = await selectRows<DebtBillRow>(
    `SELECT ${DEBT_BILL_SELECT} FROM debt_bill WHERE debt_issue_id = ? LIMIT 1`,
    [debtIssueId],
  );
  const row = rows[0];
  return row ? toDebtBill(row) : null;
}

/* ------------------------------------------------------------- zone_week */

const ZONE_WEEK_COLUMNS = ['project_id', 'zone', 'week', 'cost_jp', 'by_family', 'team'] as const;

/** Une case zone × semaine, telle qu'écrite par le calcul des coûts. */
export interface ZoneWeekInput {
  projectId: string;
  zone: string;
  /** Lundi de la semaine ISO, `AAAA-MM-JJ` (`weekKey()` de `core/time.ts`). */
  week: string;
  costJp: number;
  byFamily: Record<Family, number>;
  team?: string;
}

/** Écrit un lot de cases zone × semaine (un `INSERT` groupé par lot). */
export async function upsertZoneWeek(rows: ZoneWeekInput[]): Promise<void> {
  if (rows.length === 0) return;
  await insertRows({
    table: 'zone_week',
    columns: ZONE_WEEK_COLUMNS,
    rows,
    toValues: (row) => [row.projectId, row.zone, row.week, row.costJp, toJson(row.byFamily), row.team ?? null],
    onDuplicate: onDuplicateUpdate(ZONE_WEEK_COLUMNS, ['project_id', 'zone', 'week']),
  });
}

interface ZoneAccumulator {
  zone: string;
  projectKey: string;
  totalJp: number;
  byFamily: Record<Family, number>;
  byWeek: Map<string, number>;
  team?: string;
}

/** Ligne zone × semaine, avec le seuil de références du projet (joint). */
interface ZoneWeekSampleRow extends ZoneWeekRow {
  min_baseline_sample: unknown;
}

/** La famille dont le coût dépend d'un échantillon de références (§9) : C3. */
const BASELINE_FAMILY: Family = 'C3';

/** Coûts par zone sur les semaines demandées, séries alignées sur `weeks`. */
export async function listZoneWeeks(projectId: string, weeks: string[]): Promise<ZoneCost[]> {
  if (weeks.length === 0) return [];
  const ordered = [...new Set(weeks)].sort();
  const placeholders = ordered.map(() => '?').join(', ');
  const rows = await selectRows<ZoneWeekSampleRow>(
    `SELECT zw.zone, zw.week, zw.cost_jp, zw.by_family, zw.team, s.project_key, s.min_baseline_sample
       FROM zone_week zw
       LEFT JOIN settings s ON s.project_id = zw.project_id
      WHERE zw.project_id = ? AND zw.week IN (${placeholders})
      ORDER BY zw.zone, zw.week`,
    [projectId, ...ordered],
  );
  return withInsufficientFamilies(buildZoneCosts(rows, ordered), rows, projectId);
}

function buildZoneCosts(rows: ZoneWeekRow[], weeks: string[]): ZoneCost[] {
  const accumulators = new Map<string, ZoneAccumulator>();
  for (const row of rows) {
    const accumulator = accumulatorOf(accumulators, row);
    const costJp = toNumber(row.cost_jp);
    accumulator.totalJp += costJp;
    accumulator.byWeek.set(row.week, (accumulator.byWeek.get(row.week) ?? 0) + costJp);
    const families = toFamilyNumbers(row.by_family);
    for (const family of FAMILIES) accumulator.byFamily[family] += families[family];
    const team = toTextOrNull(row.team);
    if (team !== null) accumulator.team = team;
  }
  const grandTotal = [...accumulators.values()].reduce((sum, item) => sum + item.totalJp, 0);
  const unclassified = accumulators.get(UNCLASSIFIED_ZONE)?.totalJp ?? 0;
  const unclassifiedShare = grandTotal > 0 ? unclassified / grandTotal : 0;
  return [...accumulators.values()].map((item) => toZoneCost(item, weeks, unclassifiedShare));
}

/** Accumulateur d'une zone, créé à la première ligne rencontrée. */
function accumulatorOf(accumulators: Map<string, ZoneAccumulator>, row: ZoneWeekRow): ZoneAccumulator {
  const existing = accumulators.get(row.zone);
  if (existing) return existing;
  const created: ZoneAccumulator = {
    zone: row.zone,
    projectKey: toText(row.project_key),
    totalJp: 0,
    byFamily: zeroFamilyNumbers(),
    byWeek: new Map<string, number>(),
  };
  accumulators.set(row.zone, created);
  return created;
}

function toZoneCost(accumulator: ZoneAccumulator, weeks: string[], unclassifiedShare: number): ZoneCost {
  const cost: ZoneCost = {
    zone: accumulator.zone,
    projectKey: accumulator.projectKey,
    totalJp: accumulator.totalJp,
    byFamily: accumulator.byFamily,
    weeklyJp: weeks.map((week) => accumulator.byWeek.get(week) ?? 0),
    unclassifiedShare,
  };
  if (accumulator.team !== undefined) cost.team = accumulator.team;
  return cost;
}

/* ------------------------------------------- familles non chiffrables (item 56, §9) */

/**
 * Drapeau `insufficientByFamily` (item 56) : C3 est marqué non chiffrable sur
 * une zone quand ses tickets de référence distincts sont moins nombreux que le
 * seuil du projet (`minBaselineSample`, §9). Le drapeau est calculé là où
 * `ZoneCost` est construit — c'est là que l'écran vient le lire.
 */
async function withInsufficientFamilies(
  costs: ZoneCost[],
  rows: ZoneWeekSampleRow[],
  projectId: string,
): Promise<ZoneCost[]> {
  const min = minBaselineSampleOf(rows);
  const refs = await baselineReferenceCounts(projectId);
  return costs.map((cost) => {
    const count = refs.get(cost.zone) ?? 0;
    const usesBaseline = count > 0 || cost.byFamily[BASELINE_FAMILY] !== 0;
    if (!usesBaseline || count >= min) return cost;
    return { ...cost, insufficientByFamily: { ...cost.insufficientByFamily, [BASELINE_FAMILY]: true } };
  });
}

/** Seuil de références du projet, lu dans la jointure ; à défaut le réglage par défaut. */
function minBaselineSampleOf(rows: ZoneWeekSampleRow[]): number {
  for (const row of rows) {
    const sample = toNumber(row.min_baseline_sample, 0);
    if (sample > 0) return sample;
  }
  return DEFAULT_SETTINGS.minBaselineSample;
}

/** Nombre de tickets de référence C3 distincts par zone. */
async function baselineReferenceCounts(projectId: string): Promise<Map<string, number>> {
  const rows = await selectRows<{ zone: string; source_issue_id: unknown }>(
    'SELECT zone, source_issue_id FROM evidence WHERE project_id = ? AND family = ?',
    [projectId, BASELINE_FAMILY],
  );
  const byZone = new Map<string, Set<string>>();
  for (const row of rows) {
    const sources = byZone.get(row.zone) ?? new Set<string>();
    sources.add(toText(row.source_issue_id));
    byZone.set(row.zone, sources);
  }
  return new Map([...byZone].map(([zone, sources]) => [zone, sources.size]));
}
