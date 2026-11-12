import type { DebtBill, IssueFact, IssueLink, ProjectSettings, RelevanceScore } from '../core/types';
import { addDays } from '../core/time';
import {
  listDebtIssues,
  listIssuesInWindow,
  listRejections,
  listScores,
  listStatusSpans,
  purgeProject,
  replaceAttributions,
  replaceBaselines,
  replaceEvidence,
  saveScores,
  upsertBills,
  upsertZoneWeek,
} from '../platform/db/index';
import { ensureDebtCostField, writeDebtCost } from '../platform/field';
import { fetchLinksBatch } from '../platform/jira';
import type { ScoreCache } from '../platform/llm';
import { listConfirmations } from './confirmations';
import type { Deadline } from './deadline';
import { clearInvalidBefore, listInvalid } from './invalidation';
import { jsmIncidentFacts } from './jsm';
import { createCallGuard, LLM_CALLS_PER_MINUTE } from './llmGuard';
import { requireSettings } from './projects';
import type { Prepared, RecomputeInput, RecomputeResult } from './recompute';
import { debtFieldValues, finish, prepare } from './recompute';
import { scoreCandidates } from './relevance';
import { groupSpans } from './spans';
import { purgeDisappearedZones } from './zoneLifecycle';

/**
 * Le recalcul d'**un** projet : lire, calculer, enregistrer, publier (§15).
 *
 * Il est appelé par le consommateur de file (un message par projet, C34) et par
 * l'outil d'exploitation. Deux gardes le bornent : la garde de durée rend la
 * main proprement avant la limite Forge de 900 s, et le garde de débit espace
 * les appels au modèle (§17).
 *
 * Un projet marqué `demoData` n'est **jamais** recalculé (B16) : le jeu
 * d'exemple serait rescoré, et le champ « Coût de la dette » écrirait des
 * chiffres fictifs sur de vrais tickets.
 */

/** Nombre de tickets dont on relit les liens chez Jira à chaque nuit. */
const MAX_LINK_ISSUES = 300;

/** Bilan du calcul d'un projet. */
export interface ProjectRecalc {
  projectId: string;
  evidence: number;
  bills: number;
  fieldUpdated: number;
  /** Marques « à recalculer » en attente au début du passage (B20). */
  pending?: number;
  /** Mis en file plutôt que calculé (C34). */
  queued?: boolean;
  /** Motif d'un projet non recalculé : jeu d'exemple, temps écoulé. */
  skipped?: string;
  error?: string;
}

/** Motif d'un projet à écarter du calcul et de toute écriture Jira. */
export function skipReason(settings: ProjectSettings): string | null {
  return settings.demoData ? 'demo-data' : null;
}

/**
 * Faits du projet : la fenêtre d'analyse **plus** ses tickets de dette, quelle
 * que soit leur date (A6).
 *
 * Sans cela, la dette ouverte il y a un an — le héros du §7.1 — n'a ni addition
 * ni champ rafraîchi : elle est hors de la fenêtre de 90 jours. Les preuves,
 * elles, restent bornées à la fenêtre (c'est le rôle des familles).
 *
 * TODO(integration) : `listDebtIssues` (`platform/db/repos/issues.ts`) ne rend
 * pas la `description`, que `listIssuesInWindow` rattache à ses dettes. Une
 * dette hors fenêtre arrive donc sans texte, et le score de pertinence du
 * modèle compare un titre seul. Rattacher les descriptions aux deux lectures
 * supprimerait cette asymétrie.
 */
export function mergeFacts(windowFacts: readonly IssueFact[], debts: readonly IssueFact[]): IssueFact[] {
  const merged = new Map<string, IssueFact>();
  for (const fact of windowFacts) merged.set(fact.issueId, fact);
  for (const debt of debts) {
    if (!merged.has(debt.issueId)) merged.set(debt.issueId, debt);
  }
  return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
}

/** Options du recalcul : échéance et garde de débit. */
export interface RecalcOptions {
  deadline?: Deadline;
}

/** Lecture, calcul, enregistrement, publication : la chaîne d'un projet. */
export async function recalcProject(
  projectId: string,
  now: string,
  options: RecalcOptions = {},
): Promise<ProjectRecalc> {
  const settings = await requireSettings(projectId);
  const skipped = skipReason(settings);
  if (skipped) return { projectId, evidence: 0, bills: 0, fieldUpdated: 0, skipped };
  const pending = await listInvalid(projectId);
  if (options.deadline?.expired()) return timedOut(projectId, pending.length);
  const input = await gatherInput(projectId, settings, now);
  const prepared = prepare(input);
  const scores = await scoreProject(projectId, prepared, options.deadline);
  // Les scores obtenus sont déjà en cache : s'arrêter ici ne perd rien (C34).
  if (options.deadline?.expired()) return timedOut(projectId, pending.length);
  const result = finish({ ...input, scores }, prepared);
  await persist(projectId, result, now, settings);
  const fieldUpdated = await writeFields(settings, result.bills);
  return {
    projectId,
    evidence: result.evidence.length,
    bills: result.bills.length,
    fieldUpdated,
    pending: pending.length,
  };
}

/** Bilan d'un projet arrêté par la garde de durée (C34). */
function timedOut(projectId: string, pending: number): ProjectRecalc {
  return {
    projectId,
    evidence: 0,
    bills: 0,
    fieldUpdated: 0,
    pending,
    skipped: 'temps écoulé',
  };
}

/** Tout ce que le calcul doit lire : fenêtre, dettes, JSM, historique, liens. */
async function gatherInput(
  projectId: string,
  settings: ProjectSettings,
  now: string,
): Promise<RecomputeInput> {
  const from = addDays(now, -settings.windowDays);
  const [windowFacts, debts, extraFacts] = await Promise.all([
    listIssuesInWindow(projectId, from),
    listDebtIssues(projectId),
    jsmIncidentFacts(settings),
  ]);
  const facts = mergeFacts(windowFacts, debts);
  return {
    projectId,
    settings,
    facts,
    extraFacts,
    // Les liens des incidents JSM comptent aussi : c'est souvent le lien qui
    // rattache l'incident à la dette du projet (§7.1, fourchette basse).
    links: await linksOf([...facts, ...extraFacts]),
    spansByIssue: groupSpans(await listStatusSpans(projectId, facts.map((fact) => fact.issueId))),
    scores: [],
    rejections: await listRejections(projectId),
    confirmations: await listConfirmations(projectId),
    now,
  };
}

/**
 * Liens Jira des tickets du projet, lus en une recherche paginée (C28).
 *
 * Les liens ne sont pas une table du §16 : ils se relisent chez Jira, au nom de
 * l'app, une fois par nuit. Le plafond borne la taille de la requête ; au-delà,
 * les tickets les plus anciens gardent leurs attributions de la veille.
 */
async function linksOf(facts: readonly IssueFact[]): Promise<IssueLink[]> {
  const keys = facts.slice(0, MAX_LINK_ISSUES).map((fact) => fact.key);
  if (keys.length === 0) return [];
  const byKey = await fetchLinksBatch(keys);
  const links: IssueLink[] = [];
  for (const key of keys) {
    const found = byKey.get(key);
    if (found) links.push(...found);
  }
  return links;
}

/**
 * Scores du modèle, avec le cache persistant (C30) et le garde de débit (C31).
 *
 * Le cache est lu avant, écrit après : un couple dont les textes n'ont pas
 * changé n'est jamais repayé (§18 « les scores sont mis en cache et ne sont
 * recalculés que si un texte change »).
 */
async function scoreProject(
  projectId: string,
  prepared: Prepared,
  deadline?: Deadline,
): Promise<RelevanceScore[]> {
  const cache = await loadCache(projectId);
  const guard = createCallGuard(LLM_CALLS_PER_MINUTE);
  const scores = await scoreCandidates(prepared.evidence, prepared.debts, cache, { guard, deadline });
  await saveScores(
    projectId,
    scores.map((score) => ({
      fingerprint: score.fingerprint,
      relevance: score.relevance,
      rationale: score.rationale,
    })),
  );
  return scores;
}

/** Cache des scores d'un projet, préchargé en mémoire (C30). */
async function loadCache(projectId: string): Promise<ScoreCache> {
  const stored = await listScores(projectId);
  const cache: ScoreCache = new Map();
  for (const [fingerprint, entry] of stored) {
    cache.set(fingerprint, { relevance: entry.relevance, rationale: entry.rationale });
  }
  return cache;
}

/**
 * Enregistre les résultats, puis ne nettoie que les marques **traitées** (B20) :
 * une modification survenue pendant le recalcul garde sa marque et sera reprise
 * au tour suivant. La purge du lot C borne ensuite le stockage (§17 : 1 Gio).
 */
async function persist(
  projectId: string,
  result: RecomputeResult,
  now: string,
  settings: ProjectSettings,
): Promise<void> {
  await replaceEvidence(projectId, result.evidence);
  await replaceAttributions(projectId, result.attributions);
  await upsertBills(projectId, result.bills);
  await replaceBaselines(projectId, result.baselines);
  await upsertZoneWeek(result.zoneWeeks);
  await purgeDisappearedZones(projectId, settings, now);
  await clearInvalidBefore(projectId, now);
  await purgeProject(projectId, { now, deadDays: settings.deadDays });
}

/** Écrit la fourchette basse dans le champ « Coût de la dette » (DT-11). */
export async function writeFields(settings: ProjectSettings, bills: readonly DebtBill[]): Promise<number> {
  if (bills.length === 0) return 0;
  if (skipReason(settings)) return 0;
  const setup = await ensureDebtCostField(settings.projectKey);
  if (!setup.ok || !setup.fieldId) return 0;
  const { keys, values } = debtFieldValues([...bills]);
  const outcome = await writeDebtCost(keys, values, setup.fieldId);
  return outcome.updated.length;
}
