/**
 * Injection du jeu d'exemple (DT-13, §22).
 *
 * `buildSampleData(now)` rend les sept tables que les dépôts savent écrire :
 * faits, séjours, liens, preuves, attributions, coûts de zone et bulletins.
 * Rien n'est inventé : les preuves viennent de `collectEvidence`, les parts de
 * `attributeEvidence`, les coûts de `weeklyZoneCosts`. Le jeu d'exemple est donc
 * une **exécution de la méthode**, pas une maquette de chiffres.
 */

import type {
  Attribution,
  CostContext,
  Evidence,
  Family,
  IssueFact,
  IssueLink,
  ProjectSettings,
  RelevanceScore,
  Rejection,
  Repayment,
  StatusSpan,
  ZoneCost,
} from '../core/types.ts';
import { attributeEvidence } from '../core/attribution.ts';
import type { Confirmation } from '../core/attribution.ts';
import { computeBaselines } from '../core/baseline.ts';
import { collectEvidence } from '../core/families/index.ts';
import { buildRepayment } from '../core/repayment.ts';
import { addDays, round2, weeksBetween } from '../core/time.ts';
import { UNCLASSIFIED_ZONE } from '../core/zones.ts';
import { emptyFamilies, weeklyZoneCosts, zoneWeekly } from '../jobs/zoneCosts.ts';
import type { ZoneWeekInput } from '../platform/db/repos/bills.ts';
import {
  SAMPLE_CONFIRMATION_RULES,
  SAMPLE_NOW,
  SAMPLE_PROJECT_ID,
  SAMPLE_PROJECT_KEY,
  SAMPLE_REJECTION_RULES,
  SAMPLE_REPAID_DEBT_KEY,
  SAMPLE_SCORE_RULES,
  issueIdOf,
  sampleFacts,
  sampleLinks,
  sampleRepaymentPlan,
  sampleSettings,
  sampleSpans,
} from './dataset.ts';

/** Les sept tables écrites par l'injection du jeu d'exemple. */
export interface SampleData {
  facts: IssueFact[];
  spans: StatusSpan[];
  links: IssueLink[];
  evidence: Evidence[];
  attributions: Attribution[];
  zones: ZoneCost[];
  repayment: Repayment[];
}

/** Ce qu'il faut pour rejouer un calcul sur le jeu d'exemple (aucune I/O). */
export function sampleContext(now: string = SAMPLE_NOW): CostContext {
  return baseOf(now).ctx;
}

/** Réglages du projet d'exemple, utiles aux écrans et aux actions MCP. */
export function sampleProjectSettings(): ProjectSettings {
  return sampleSettings();
}

/** Vrai quand la clé désigne le projet fictif (bandeau « données d'exemple »). */
export function isSampleProject(projectKey: string): boolean {
  return projectKey.trim().toUpperCase() === SAMPLE_PROJECT_KEY;
}

/** Identifiant interne d'un ticket du jeu, utile aux dépôts et aux tests. */
export function sampleIssueId(key: string): string {
  return issueIdOf(key);
}

/** Construit les sept tables du jeu d'exemple à l'instant `now`. */
export function buildSampleData(now: string = SAMPLE_NOW): SampleData {
  const base = baseOf(now);
  const debts = base.facts.filter((fact) => fact.isDebt);
  const evidence = collectEvidence(base.facts, base.ctx, base.links);
  const attributions = attributeEvidence(
    evidence,
    debts,
    scoreRulesOf(evidence, debts),
    rejectionRulesOf(evidence, debts, now),
    base.settings,
    base.links,
    confirmationRulesOf(evidence, debts),
  );
  const weeks = weeksBetween(addDays(now, -base.settings.windowDays), now);
  const rows = weeklyZoneCosts(evidence, SAMPLE_PROJECT_ID, base.settings.teamByZone);
  const zones = aggregateZones(rows, weeks);
  return {
    facts: base.facts,
    spans: base.spans,
    links: base.links,
    evidence,
    attributions,
    zones,
    repayment: publishedRepayments(debts, zones, weeks, now),
  };
}

/** Contexte de calcul partagé par toutes les constructions du jeu. */
interface SampleBase {
  facts: IssueFact[];
  spans: StatusSpan[];
  links: IssueLink[];
  settings: ProjectSettings;
  ctx: CostContext;
}

/** Faits, séjours, liens et contexte, construits une fois. */
function baseOf(now: string): SampleBase {
  const facts = sampleFacts(now);
  const spans = sampleSpans(facts, now);
  const settings = sampleSettings();
  const spansByIssue = groupSpans(spans);
  const baselines = computeBaselines(facts, spansByIssue, settings, now);
  return { facts, spans, links: sampleLinks(), settings, ctx: { settings, now, baselines, spansByIssue } };
}

/** Séjours indexés par ticket, comme les attend le domaine. */
function groupSpans(spans: StatusSpan[]): Map<string, StatusSpan[]> {
  const byIssue = new Map<string, StatusSpan[]>();
  for (const span of spans) {
    const list = byIssue.get(span.issueId);
    if (list) list.push(span);
    else byIssue.set(span.issueId, [span]);
  }
  return byIssue;
}

/** Une zone en cours d'agrégation. */
interface ZoneAccumulator {
  zone: string;
  totalJp: number;
  byFamily: Record<Family, number>;
  byWeek: Map<string, number>;
  team?: string;
}

/**
 * Agrège les cases zone × semaine en coûts de zone (§16).
 *
 * Même règle que `listZoneWeeks` (`platform/db/repos/bills.ts`) : séries
 * alignées sur les semaines demandées, et `unclassifiedShare` — la part du coût
 * sans zone — portée par le projet entier, jamais répartie sur les zones.
 */
function aggregateZones(rows: ZoneWeekInput[], weeks: string[]): ZoneCost[] {
  const accumulators = new Map<string, ZoneAccumulator>();
  for (const row of rows) {
    const entry = accumulators.get(row.zone) ?? newEntry(row);
    entry.totalJp += row.costJp;
    entry.byWeek.set(row.week, (entry.byWeek.get(row.week) ?? 0) + row.costJp);
    for (const family of Object.keys(entry.byFamily) as Family[]) {
      entry.byFamily[family] += row.byFamily[family];
    }
    if (row.team !== undefined) entry.team = row.team;
    accumulators.set(row.zone, entry);
  }
  const share = unclassifiedShareOf(accumulators);
  return [...accumulators.values()]
    .map((entry) => toZoneCost(entry, weeks, share))
    .sort(compareZones);
}

/** Accumulateur vide d'une zone. */
function newEntry(row: ZoneWeekInput): ZoneAccumulator {
  const entry: ZoneAccumulator = { zone: row.zone, totalJp: 0, byFamily: emptyFamilies(), byWeek: new Map() };
  if (row.team !== undefined) entry.team = row.team;
  return entry;
}

/** Part du coût portée par la seule zone « non classé » (§8). */
function unclassifiedShareOf(accumulators: Map<string, ZoneAccumulator>): number {
  let total = 0;
  for (const entry of accumulators.values()) total += entry.totalJp;
  if (total <= 0) return 0;
  return round2((accumulators.get(UNCLASSIFIED_ZONE)?.totalJp ?? 0) / total);
}

/** Ligne d'affichage d'une zone. */
function toZoneCost(entry: ZoneAccumulator, weeks: string[], share: number): ZoneCost {
  const cost: ZoneCost = {
    zone: entry.zone,
    projectKey: SAMPLE_PROJECT_KEY,
    totalJp: round2(entry.totalJp),
    byFamily: roundFamilies(entry.byFamily),
    weeklyJp: weeks.map((week) => round2(entry.byWeek.get(week) ?? 0)),
    unclassifiedShare: share,
  };
  if (entry.team !== undefined) cost.team = entry.team;
  return cost;
}

/** Ventilation par famille, arrondie au centième. */
function roundFamilies(byFamily: Record<Family, number>): Record<Family, number> {
  const rounded = emptyFamilies();
  for (const family of Object.keys(rounded) as Family[]) rounded[family] = round2(byFamily[family]);
  return rounded;
}

/** Coût décroissant, puis zone alphabétique : ordre stable à l'écran. */
function compareZones(a: ZoneCost, b: ZoneCost): number {
  if (b.totalJp !== a.totalJp) return b.totalJp - a.totalJp;
  return a.zone.localeCompare(b.zone, 'fr');
}

/** Dette visée par une règle, ou `null` si la clé est inconnue. */
function debtOf(debts: IssueFact[], debtKey: string): IssueFact | null {
  return debts.find((debt) => debt.key === debtKey) ?? null;
}

/**
 * Preuve visée par une règle : la preuve du ticket source dans la zone de la
 * dette. Un ticket partagé entre deux zones a deux preuves ; on ne rapproche
 * que celle de la zone concernée (§8, §10).
 */
function evidenceOf(evidence: Evidence[], sourceKey: string, debt: IssueFact | null): Evidence | null {
  const zone = debt?.zones[0];
  const found = evidence.find(
    (item) => item.sourceKey === sourceKey && (zone === undefined || item.zone === zone),
  );
  return found ?? null;
}

/** Empreinte de cache d'un couple preuve / dette (§18). */
function fingerprintOf(sourceKey: string, debtKey: string): string {
  return `${sourceKey}|${debtKey}`;
}

/** Notes du modèle, résolues en identifiants de preuves réels. */
function scoreRulesOf(evidence: Evidence[], debts: IssueFact[]): RelevanceScore[] {
  const scores: RelevanceScore[] = [];
  for (const rule of SAMPLE_SCORE_RULES) {
    const debt = debtOf(debts, rule.debtKey);
    const item = evidenceOf(evidence, rule.sourceKey, debt);
    if (!debt || !item) continue;
    scores.push({
      evidenceId: item.id,
      debtIssueId: debt.issueId,
      relevance: rule.relevance,
      rationale: rule.rationale,
      fingerprint: fingerprintOf(rule.sourceKey, rule.debtKey),
    });
  }
  return scores;
}

/** Confirmations humaines, résolues en identifiants de preuves réels. */
function confirmationRulesOf(evidence: Evidence[], debts: IssueFact[]): Confirmation[] {
  const confirmations: Confirmation[] = [];
  for (const rule of SAMPLE_CONFIRMATION_RULES) {
    const debt = debtOf(debts, rule.debtKey);
    const item = evidenceOf(evidence, rule.sourceKey, debt);
    if (!debt || !item) continue;
    confirmations.push({ evidenceId: item.id, debtIssueId: debt.issueId, by: rule.by });
  }
  return confirmations;
}

/** Rejets connus, résolus en identifiants de preuves réels. */
function rejectionRulesOf(evidence: Evidence[], debts: IssueFact[], now: string): Rejection[] {
  const rejections: Rejection[] = [];
  for (const rule of SAMPLE_REJECTION_RULES) {
    const debt = debtOf(debts, rule.debtKey);
    const item = evidenceOf(evidence, rule.sourceKey, debt);
    if (!debt || !item) continue;
    rejections.push({
      evidenceId: item.id,
      debtIssueId: debt.issueId,
      rejectedBy: rule.rejectedBy,
      at: addDays(now, -2),
    });
  }
  return rejections;
}

/**
 * Bulletins de remboursement publiés (§11). Le jeu n'en contient qu'un : celui
 * de la dette close, publié après huit semaines d'observation.
 */
function publishedRepayments(
  debts: IssueFact[],
  zones: ZoneCost[],
  weeks: string[],
  now: string,
): Repayment[] {
  const debt = debtOf(debts, SAMPLE_REPAID_DEBT_KEY);
  if (!debt || debt.resolvedAt === null) return [];
  const plan = sampleRepaymentPlan(debt.resolvedAt, now);
  const zone = debt.zones[0] ?? UNCLASSIFIED_ZONE;
  const series = zoneWeekly(
    zones.find((cost) => cost.zone === zone),
    weeks,
  );
  const bulletin = buildRepayment(debt, series, debt.resolvedAt, plan.workStartAt);
  return [{ ...bulletin, publishedAt: plan.publishedAt }];
}
