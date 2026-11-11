/**
 * Dépôts des additions par ticket de dette et des coûts par zone et par semaine.
 *
 * Une fonction par besoin, un aller-retour SQL par fonction, paramètres liés.
 * Aucune fonction ne jette pour une donnée absente : elle rend `null` ou `[]`.
 */

import type { DebtBill, Family, ZoneCost } from '../../../core/types';
import { UNCLASSIFIED_ZONE } from '../../../core/zones';
import type { SqlValue } from '../query';
import { insertRows, onDuplicateUpdate, projectOfIssue, selectRows } from '../query';
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
] as const;

function debtBillValues(bill: DebtBill): SqlValue[] {
  return [
    bill.debtIssueId,
    projectOfIssue(bill.debtIssueId),
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
  ];
}

/** Enregistre (ou remplace) l'addition d'un ticket de dette (DT-06). */
export async function upsertBill(bill: DebtBill): Promise<void> {
  await insertRows({
    table: 'debt_bill',
    columns: DEBT_BILL_COLUMNS,
    rows: [bill],
    toValues: debtBillValues,
    onDuplicate: onDuplicateUpdate(DEBT_BILL_COLUMNS, ['debt_issue_id']),
  });
}

/** Additions d'un projet, la plus lourde d'abord (DT-07). */
export async function listBills(projectId: string): Promise<DebtBill[]> {
  const rows = await selectRows<DebtBillRow>(
    'SELECT * FROM debt_bill WHERE project_id = ? ORDER BY low_jp DESC, issue_key',
    [projectId],
  );
  return rows.map(toDebtBill);
}

/** Addition d'un ticket de dette, ou `null` si elle n'est pas encore calculée. */
export async function getBill(debtIssueId: string): Promise<DebtBill | null> {
  const rows = await selectRows<DebtBillRow>('SELECT * FROM debt_bill WHERE debt_issue_id = ? LIMIT 1', [
    debtIssueId,
  ]);
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

/** Écrit un lot de cases zone × semaine (une seule requête). */
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

/** Coûts par zone sur les semaines demandées, séries alignées sur `weeks`. */
export async function listZoneWeeks(projectId: string, weeks: string[]): Promise<ZoneCost[]> {
  if (weeks.length === 0) return [];
  const ordered = [...new Set(weeks)].sort();
  const placeholders = ordered.map(() => '?').join(', ');
  const rows = await selectRows<ZoneWeekRow>(
    `SELECT zw.zone, zw.week, zw.cost_jp, zw.by_family, zw.team, s.project_key
       FROM zone_week zw
       LEFT JOIN settings s ON s.project_id = zw.project_id
      WHERE zw.project_id = ? AND zw.week IN (${placeholders})
      ORDER BY zw.zone, zw.week`,
    [projectId, ...ordered],
  );
  return buildZoneCosts(rows, ordered);
}

function buildZoneCosts(rows: ZoneWeekRow[], weeks: string[]): ZoneCost[] {
  const accumulators = new Map<string, ZoneAccumulator>();
  for (const row of rows) {
    let accumulator = accumulators.get(row.zone);
    if (!accumulator) {
      accumulator = {
        zone: row.zone,
        projectKey: toText(row.project_key),
        totalJp: 0,
        byFamily: zeroFamilyNumbers(),
        byWeek: new Map<string, number>(),
      };
      accumulators.set(row.zone, accumulator);
    }
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
