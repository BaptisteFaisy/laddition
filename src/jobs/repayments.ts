import type { IssueFact, Repayment, StatusSpan } from '../core/types';
import type { ZoneWeek } from '../core/repayment';
import { REPAYMENT_WEEKS, buildRepayment, isRepaymentStale, mergeMonthlyRepayments } from '../core/repayment';
import { addDays, weeksBetween } from '../core/time';
import { listDebtIssues, listRepayments, listStatusSpans, upsertRepayments } from '../platform/db/index';
import { listZoneWeeks } from '../platform/db/index';
import { postRepaymentComment, repaymentCommentText, withdrawalCommentText } from './repaymentComment';
import { removeRepayment } from './repaymentStore';
import { groupSpans } from './spans';
import { zoneWeekly } from './zoneCosts';

/**
 * Bulletins de remboursement (§11, §19 cas 8 et 9).
 *
 * Trois règles tiennent le bulletin droit :
 * - il est **publié** sur le ticket (B19, §7.5) : c'est là que le lecteur le
 *   rencontre, pas dans un écran que personne n'ouvre ;
 * - il est **retiré** quand la dette est rouverte (§19 cas 8, B17) : un bulletin
 *   qui décrit une clôture devenue caduc est pire que pas de bulletin ;
 * - plusieurs dettes closes sur la même zone le même mois donnent **un**
 *   bulletin commun (§19 cas 9, B18) : deux comparaisons quasi identiques
 *   n'apprennent rien de plus qu'une.
 */

/** Ce dont la publication a besoin : tout est injectable, donc testable. */
export interface RepaymentPorts {
  /** Tickets de dette du projet (tous, pas seulement ceux de la fenêtre). */
  listDebts(projectId: string): Promise<IssueFact[]>;
  /** Bulletins déjà enregistrés pour ce projet. */
  listPublished(projectId: string): Promise<Repayment[]>;
  /** Séjours de statut du projet, pour situer le début du travail. */
  listSpans(projectId: string): Promise<StatusSpan[]>;
  /** Coût hebdomadaire d'une zone, sur les semaines demandées. */
  zoneSeries(projectId: string, zone: string, weeks: string[]): Promise<ZoneWeek[]>;
  /** Enregistre les bulletins d'un projet. */
  save(projectId: string, repayments: readonly Repayment[]): Promise<void>;
  /** Retire un bulletin (dette rouverte). */
  remove(projectId: string, debtIssueId: string): Promise<void>;
  /** Publie un commentaire sur un ticket. */
  publish(issueKey: string, body: string): Promise<void>;
}

/** Bilan de la publication des bulletins d'un projet. */
export interface RepaymentOutcome {
  projectId: string;
  /** Bulletins publiés (un par ticket de la groupe). */
  published: number;
  /** Bulletins retirés (dettes rouvertes). */
  removed: number;
  /** Groupes zone × mois traités. */
  groups: number;
}

/**
 * Zone principale d'un ticket : la première zone réelle (§8), vide si aucune.
 *
 * TODO(integration) : `core/repayment.ts` a la même règle dans son
 * `primaryZone` privé (avec « non classé » pour repli). L'exporter dans le
 * domaine supprimerait cette seconde implémentation.
 */
export function primaryZoneOf(debt: IssueFact): string {
  for (const zone of debt.zones) {
    if (zone.trim().length > 0) return zone.trim();
  }
  return '';
}

/** Séparateur de la clé de groupe : aucun nom de zone ne le contient. */
const GROUP_SEPARATOR = '\u0000';

/** Clé de regroupement : zone et mois de clôture (§19 cas 9). */
export function zoneMonthKey(debt: IssueFact): string {
  return `${primaryZoneOf(debt)}${GROUP_SEPARATOR}${(debt.closedAt ?? '').slice(0, 7)}`;
}

/** Dettes closes groupées par zone et par mois, dans un ordre stable. */
export function groupByZoneMonth(debts: readonly IssueFact[]): IssueFact[][] {
  const groups = new Map<string, IssueFact[]>();
  for (const debt of debts) {
    if (debt.closedAt === null) continue;
    const key = zoneMonthKey(debt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(debt);
    else groups.set(key, [debt]);
  }
  return [...groups.values()].map((bucket) =>
    bucket.slice().sort((a, b) => a.key.localeCompare(b.key)),
  );
}

/**
 * Dettes rouvertes qui portent déjà un bulletin : leur bulletin doit être
 * retiré (§19 cas 8).
 */
export function reopenedWithBulletin(
  debts: readonly IssueFact[],
  published: readonly Repayment[],
): IssueFact[] {
  const withBulletin = new Set(published.map((item) => item.debtIssueId));
  return debts.filter((debt) => debt.closedAt === null && withBulletin.has(debt.issueId));
}

/** Publie (ou retire) les bulletins d'un projet. */
export async function publishProjectRepayments(
  projectId: string,
  now: string,
  ports: RepaymentPorts = defaultPorts,
): Promise<RepaymentOutcome> {
  const debts = await ports.listDebts(projectId);
  const published = await ports.listPublished(projectId);
  const removed = await removeStaleBulletins(projectId, debts, published, ports);
  const spans = groupSpans(await ports.listSpans(projectId));
  let count = 0;
  let groups = 0;
  for (const group of groupByZoneMonth(debts)) {
    const outcome = await publishGroup(projectId, group, published, spans, now, ports);
    count += outcome.published;
    groups += 1;
  }
  return { projectId, published: count, removed, groups };
}

/** Retire les bulletins des dettes rouvertes, et le dit sur le ticket. */
async function removeStaleBulletins(
  projectId: string,
  debts: readonly IssueFact[],
  published: readonly Repayment[],
  ports: RepaymentPorts,
): Promise<number> {
  let removed = 0;
  for (const debt of reopenedWithBulletin(debts, published)) {
    await ports.remove(projectId, debt.issueId);
    await ports.publish(debt.key, withdrawalCommentText(debt.key));
    removed += 1;
  }
  return removed;
}

/**
 * Publie le bulletin d'un groupe de dettes closes (même zone, même mois).
 *
 * Un groupe déjà publié et à jour n'est pas republié : le commentaire ne doit
 * pas s'empiler sur le ticket, la nuit après la nuit.
 */
async function publishGroup(
  projectId: string,
  group: readonly IssueFact[],
  published: readonly Repayment[],
  spans: Map<string, StatusSpan[]>,
  now: string,
  ports: RepaymentPorts,
): Promise<{ published: number }> {
  if (group.length === 0) return { published: 0 };
  if (isUpToDate(group, published, now)) return { published: 0 };
  const individuals: Repayment[] = [];
  for (const debt of group) {
    const repayment = await buildRepaymentFor(projectId, debt, spans.get(debt.issueId) ?? [], now, ports);
    if (repayment) individuals.push(repayment);
  }
  if (individuals.length === 0) return { published: 0 };
  const bulletin = mergeMonthlyRepayments(individuals)[0];
  if (!bulletin) return { published: 0 };
  const rows = group.map((debt) => ({ ...bulletin, debtIssueId: debt.issueId, key: debt.key, publishedAt: now }));
  await ports.save(projectId, rows);
  for (const debt of group) {
    const text = repaymentCommentText({ ...bulletin, debtIssueId: debt.issueId, key: debt.key });
    await ports.publish(debt.key, text);
  }
  return { published: group.length };
}

/** Vrai quand chaque dette du groupe a déjà un bulletin publié et à jour. */
function isUpToDate(
  group: readonly IssueFact[],
  published: readonly Repayment[],
  now: string,
): boolean {
  const byDebt = new Map(published.map((item) => [item.debtIssueId, item]));
  return group.every((debt) => {
    const item = byDebt.get(debt.issueId);
    if (!item || item.publishedAt === null) return false;
    return !isRepaymentStale(debt, item, now);
  });
}

/** Construit le bulletin d'une dette close, ou `null` si rien n'est mesurable. */
async function buildRepaymentFor(
  projectId: string,
  debt: IssueFact,
  spans: readonly StatusSpan[],
  now: string,
  ports: RepaymentPorts,
): Promise<Repayment | null> {
  const closedAt = debt.closedAt;
  const zone = primaryZoneOf(debt);
  if (!closedAt || zone.length === 0) return null;
  const start = workStartOf(debt, spans);
  const weeks = weeksBetween(addDays(start, -7 * REPAYMENT_WEEKS), addDays(closedAt, 7 * REPAYMENT_WEEKS));
  const series = await ports.zoneSeries(projectId, zone, weeks);
  return { ...buildRepayment(debt, series, closedAt, start), publishedAt: now };
}

/** Début du travail sur la dette : premier passage en cours, sinon création. */
function workStartOf(debt: IssueFact, spans: readonly StatusSpan[]): string {
  const started = spans.find((span) => span.category === 'inprogress');
  return started?.startedAt ?? debt.createdAt;
}

/** Le câblage réel : la base, les coûts de zone, et Jira. */
export const defaultPorts: RepaymentPorts = {
  listDebts: (projectId) => listDebtIssues(projectId),
  listPublished: (projectId) => listRepayments(projectId),
  listSpans: (projectId) => listStatusSpans(projectId),
  zoneSeries: async (projectId, zone, weeks) => {
    const costs = await listZoneWeeks(projectId, weeks);
    return zoneWeekly(costs.find((cost) => cost.zone === zone), weeks);
  },
  save: (projectId, repayments) => upsertRepayments(projectId, repayments),
  remove: (projectId, debtIssueId) => removeRepayment(projectId, debtIssueId),
  publish: async (issueKey, body) => {
    await postRepaymentComment(issueKey, body);
  },
};
