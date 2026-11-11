import type {
  DebtBill,
  IssueFact,
  IssueLink,
  ProjectSettings,
  Repayment,
  StatusSpan,
} from '../core/types';
import { REPAYMENT_WEEKS, buildRepayment, isRepaymentStale } from '../core/repayment';
import { addDays, weeksBetween } from '../core/time';
import {
  listDebtIssues,
  listIssuesInWindow,
  listRejections,
  listRepayments,
  listStatusSpans,
  listZoneWeeks,
  replaceAttributions,
  replaceBaselines,
  replaceEvidence,
  upsertBill,
  upsertRepayment,
  upsertZoneWeek,
} from '../platform/db/index';
import { ensureDebtCostField, writeDebtCost } from '../platform/field';
import { fetchLinks } from '../platform/jira';
import { listConfirmations } from './confirmations';
import { clearInvalid } from './invalidation';
import { listProjectIds, requireSettings } from './projects';
import type { RecomputeInput, RecomputeResult } from './recompute';
import { debtFieldValues, finish, prepare } from './recompute';
import { scoreCandidates } from './relevance';
import { ensureReady } from './schema';
import { groupSpans } from './spans';
import { messageOf, nowIso } from './support';
import { zoneWeekly } from './zoneCosts';

/**
 * `scheduledTrigger` (§15) : le calcul lourd, une fois par nuit.
 *
 * Tout est découpé pour qu'aucune fonction ne fasse deux métiers : lire
 * (`gatherInput`), calculer (`recomputeAll`), enregistrer (`persist`), publier
 * (`writeFields`, `publishRepayments`). Une erreur sur un projet n'empêche pas
 * les autres d'être traités : chaque projet rend son bilan.
 */

/** Nombre de tickets dont on relit les liens chez Jira à chaque nuit. */
const MAX_LINK_ISSUES = 300;

/** Bilan du calcul d'un projet. */
export interface ProjectRecalc {
  projectId: string;
  evidence: number;
  bills: number;
  fieldUpdated: number;
  error?: string;
}

/** Bilan du recalcul nocturne, rendu au manifeste et aux journaux. */
export interface NightlyResult {
  ok: boolean;
  projects: ProjectRecalc[];
  startedAt: string;
  finishedAt: string;
}

/** Bilan des bulletins de remboursement (§11). */
export interface RepaymentResult {
  ok: boolean;
  projects: Array<{ projectId: string; published: number; error?: string }>;
  at: string;
}

/**
 * Recalcule preuves, attributions, additions et classement de tous les projets,
 * écrit le champ des tickets de dette et l'instantané hebdomadaire.
 */
export async function nightlyRecalc(): Promise<NightlyResult> {
  await ensureReady();
  const startedAt = nowIso();
  const projects: ProjectRecalc[] = [];
  for (const projectId of await listProjectIds()) {
    projects.push(await recalcSafely(projectId, startedAt));
  }
  return { ok: projects.every((item) => !item.error), projects, startedAt, finishedAt: nowIso() };
}

/** Un projet isolé : son échec est un bilan, jamais une exception. */
async function recalcSafely(projectId: string, now: string): Promise<ProjectRecalc> {
  try {
    return await recalcProject(projectId, now);
  } catch (error) {
    return { projectId, evidence: 0, bills: 0, fieldUpdated: 0, error: messageOf(error) };
  }
}

/** Lecture, calcul, enregistrement, publication : la chaîne d'un projet. */
async function recalcProject(projectId: string, now: string): Promise<ProjectRecalc> {
  const settings = await requireSettings(projectId);
  const input = await gatherInput(projectId, settings, now);
  const prepared = prepare(input);
  const scores = await scoreCandidates(prepared.evidence, prepared.debts, new Map());
  const result = finish({ ...input, scores }, prepared);
  await persist(projectId, result);
  const fieldUpdated = await writeFields(settings, result.bills);
  return { projectId, evidence: result.evidence.length, bills: result.bills.length, fieldUpdated };
}

/** Tout ce que le calcul doit lire : fenêtre, historique, liens, rejets. */
async function gatherInput(
  projectId: string,
  settings: ProjectSettings,
  now: string,
): Promise<RecomputeInput> {
  const from = addDays(now, -settings.windowDays);
  const facts = await listIssuesInWindow(projectId, from);
  return {
    projectId,
    settings,
    facts,
    links: await linksOf(facts),
    spansByIssue: groupSpans(await listStatusSpans(projectId)),
    scores: [],
    rejections: await listRejections(projectId),
    confirmations: await listConfirmations(projectId),
    now,
  };
}

/**
 * Liens Jira des tickets de la fenêtre.
 *
 * Les liens ne sont pas une table du §16 : ils se relisent chez Jira, au nom de
 * l'app, une fois par nuit. Le plafond borne le nombre d'appels REST ; au-delà,
 * les tickets les plus anciens gardent leurs attributions de la veille.
 */
async function linksOf(facts: IssueFact[]): Promise<IssueLink[]> {
  const links: IssueLink[] = [];
  for (const fact of facts.slice(0, MAX_LINK_ISSUES)) {
    const found = await fetchLinks(fact.issueId);
    if (found) links.push(...found);
  }
  return links;
}

/** Remplace les résultats enregistrés, puis efface les marques « à recalculer ». */
async function persist(projectId: string, result: RecomputeResult): Promise<void> {
  await replaceEvidence(projectId, result.evidence);
  await replaceAttributions(projectId, result.attributions);
  for (const bill of result.bills) await upsertBill(bill);
  await replaceBaselines(projectId, result.baselines);
  await upsertZoneWeek(result.zoneWeeks);
  await clearInvalid(projectId);
}

/** Écrit la fourchette basse dans le champ « Coût de la dette » (DT-11). */
async function writeFields(settings: ProjectSettings, bills: DebtBill[]): Promise<number> {
  if (bills.length === 0) return 0;
  const setup = await ensureDebtCostField(settings.projectKey);
  if (!setup.ok || !setup.fieldId) return 0;
  const { keys, values } = debtFieldValues(bills);
  const outcome = await writeDebtCost(keys, values, setup.fieldId);
  return outcome.updated.length;
}

/**
 * Publie les bulletins des dettes closes (§11), et rafraîchit ceux qui sont
 * périmés. Un bulletin n'est jamais une preuve de causalité : les limites
 * voyagent avec lui (`core/repayment.ts`).
 */
export async function publishRepayments(): Promise<RepaymentResult> {
  await ensureReady();
  const at = nowIso();
  const projects: RepaymentResult['projects'] = [];
  for (const projectId of await listProjectIds()) {
    try {
      projects.push({ projectId, published: await publishProject(projectId, at) });
    } catch (error) {
      projects.push({ projectId, published: 0, error: messageOf(error) });
    }
  }
  return { ok: projects.every((item) => !item.error), projects, at };
}

/** Bulletins d'un projet : seules les dettes closes en ont un. */
async function publishProject(projectId: string, now: string): Promise<number> {
  await requireSettings(projectId);
  const debts = (await listDebtIssues(projectId)).filter((debt) => debt.closedAt !== null);
  if (debts.length === 0) return 0;
  const published = await listRepayments(projectId);
  const spansByIssue = groupSpans(await listStatusSpans(projectId));
  let count = 0;
  for (const debt of debts) {
    const existing = published.find((item) => item.debtIssueId === debt.issueId) ?? null;
    if (existing && existing.publishedAt !== null && !isRepaymentStale(debt, existing, now)) continue;
    const repayment = await repaymentFor(projectId, debt, spansByIssue.get(debt.issueId) ?? [], now);
    if (!repayment) continue;
    await upsertRepayment(repayment);
    count += 1;
  }
  return count;
}

/** Construit le bulletin d'une dette close, ou `null` si rien n'est mesurable. */
async function repaymentFor(
  projectId: string,
  debt: IssueFact,
  spans: StatusSpan[],
  now: string,
): Promise<Repayment | null> {
  const closedAt = debt.closedAt;
  const zone = debt.zones[0] ?? '';
  if (!closedAt || zone.length === 0) return null;
  const start = workStartOf(debt, spans);
  const weeks = weeksBetween(addDays(start, -7 * REPAYMENT_WEEKS), addDays(closedAt, 7 * REPAYMENT_WEEKS));
  const costs = await listZoneWeeks(projectId, weeks);
  const series = zoneWeekly(costs.find((cost) => cost.zone === zone), weeks);
  return { ...buildRepayment(debt, series, closedAt, start), publishedAt: now };
}

/** Début du travail sur la dette : premier passage en cours, sinon création. */
function workStartOf(debt: IssueFact, spans: StatusSpan[]): string {
  const started = spans.find((span) => span.category === 'inprogress');
  return started?.startedAt ?? debt.createdAt;
}
