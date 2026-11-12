import type { Attribution, DebtBill, Evidence, IssueFact, IssueLink, ProjectSettings, RelevanceScore } from '../core/types';
import { addDays } from '../core/time';
import {
  listAttributions,
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
import { clearInvalidBefore, listInvalid, marksAfter } from './invalidation';
import { jsmIncidentFacts } from './jsm';
import { createCallGuard, LLM_CALLS_PER_MINUTE } from './llmGuard';
import { requireSettings } from './projects';
import type { Prepared, RecomputeInput, RecomputeResult } from './recompute';
import { debtFieldValues, finish, prepare } from './recompute';
import { scoreCandidates } from './relevance';
import type { ScoredCandidates } from './relevance';
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

/** Nombre de tickets dont on relit les liens chez Jira à chaque nuit (les plus récents). */
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

/** Options du recalcul : échéance, garde de débit et remise en file. */
export interface RecalcOptions {
  deadline?: Deadline;
  /**
   * Met un projet en file pour un nouveau recalcul (B20) : par défaut, la file
   * de l'app ; les tests en injectent un double.
   */
  enqueue?: (projectId: string) => Promise<void>;
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
  const gathered = await gatherInput(projectId, settings, now);
  const prepared = prepare(gathered.input);
  const scored = await scoreProject(projectId, prepared, options.deadline);
  // Les scores obtenus sont déjà en cache : s'arrêter ici ne perd rien (C34).
  if (options.deadline?.expired()) return timedOut(projectId, pending.length);
  const result = finish({ ...gathered.input, scores: scored.scores }, prepared, scored.truncated);
  const attributions = await carryBeyondAttributions(
    projectId,
    gathered.beyond,
    result.evidence,
    result.attributions,
  );
  await persist(projectId, { ...result, attributions }, now, settings);
  const fieldUpdated = await writeFields(settings, result.bills);
  // Une modification survenue pendant le calcul garde sa marque : on la
  // consomme en remettant le projet en file (B20).
  await consumeMarks(projectId, now, options.enqueue);
  return {
    projectId,
    evidence: result.evidence.length,
    bills: result.bills.length,
    fieldUpdated,
    pending: pending.length,
  };
}

/**
 * Consomme les marques nées **pendant** le recalcul (B20).
 *
 * `clearInvalidBefore` ne traite que les marques antérieures au calcul : celles
 * qui sont arrivées pendant attendraient la nuit suivante. Ici, elles
 * déclenchent un recalcul immédiat — le projet est remis en file.
 */
export async function consumeMarks(
  projectId: string,
  startedAt: string,
  enqueue: (projectId: string) => Promise<void> = defaultEnqueue,
): Promise<number> {
  const remaining = marksAfter(await listInvalid(projectId), startedAt);
  if (remaining.length === 0) return 0;
  await enqueue(projectId);
  return remaining.length;
}

/** Mise en file par défaut ; import tardif : `recalcQueue` importe ce module. */
async function defaultEnqueue(projectId: string): Promise<void> {
  const { enqueueRecalc } = await import('./recalcQueue');
  await enqueueRecalc(projectId);
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

/** Ce que le calcul lit, et les tickets dont les liens ne sont pas relus (C28). */
export interface GatheredInput {
  input: RecomputeInput;
  /** Tickets les plus anciens, hors du plafond de relecture des liens. */
  beyond: IssueFact[];
}

/** Tout ce que le calcul doit lire : fenêtre, dettes, JSM, historique, liens. */
async function gatherInput(
  projectId: string,
  settings: ProjectSettings,
  now: string,
): Promise<GatheredInput> {
  const from = addDays(now, -settings.windowDays);
  const [windowFacts, debts, extraFacts] = await Promise.all([
    listIssuesInWindow(projectId, from),
    listDebtIssues(projectId),
    jsmIncidentFacts(settings),
  ]);
  const facts = mergeFacts(windowFacts, debts);
  // Les liens des incidents JSM comptent aussi : c'est souvent le lien qui
  // rattache l'incident à la dette du projet (§7.1, fourchette basse).
  const { within, beyond } = splitByLinkCap([...facts, ...extraFacts]);
  return {
    beyond,
    input: {
      projectId,
      settings,
      facts,
      extraFacts,
      links: await linksOf(within),
      spansByIssue: groupSpans(await listStatusSpans(projectId, facts.map((fact) => fact.issueId))),
      scores: [],
      rejections: await listRejections(projectId),
      confirmations: await listConfirmations(projectId),
      now,
    },
  };
}

/**
 * Répartit les tickets autour du plafond de relecture des liens (C28).
 *
 * Les faits arrivent triés du plus ancien au plus récent (`mergeFacts`) : le
 * plafond garde les **plus récents** — les plus anciens gardent leurs
 * attributions enregistrées, rejouées par `carryBeyondAttributions` au lieu
 * d'être effacées.
 */
export function splitByLinkCap(facts: readonly IssueFact[]): { within: IssueFact[]; beyond: IssueFact[] } {
  const start = Math.max(0, facts.length - MAX_LINK_ISSUES);
  return { within: facts.slice(start), beyond: facts.slice(0, start) };
}

/**
 * Rejoue les attributions des tickets **hors plafond** (C28).
 *
 * `replaceAttributions` remplace toutes les parts du projet : sans ce rejeu,
 * les tickets dont les liens n'ont pas été relus perdraient leurs parts. On
 * relit donc les parts enregistrées et on les rend, sauf celles que le
 * calcul vient de refaire.
 */
export async function carryBeyondAttributions(
  projectId: string,
  beyond: readonly IssueFact[],
  evidence: readonly Evidence[],
  fresh: readonly Attribution[],
): Promise<Attribution[]> {
  if (beyond.length === 0) return [...fresh];
  const issueIds = new Set(beyond.map((fact) => fact.issueId));
  const evidenceIds = new Set(
    evidence.filter((item) => issueIds.has(item.sourceIssueId)).map((item) => item.id),
  );
  const computed = new Set(fresh.map((item) => `${item.evidenceId}|${item.debtIssueId}`));
  const stored = await listAttributions(projectId);
  const carried = stored.filter(
    (item) =>
      (issueIds.has(item.debtIssueId) || evidenceIds.has(item.evidenceId)) &&
      !computed.has(`${item.evidenceId}|${item.debtIssueId}`),
  );
  return [...fresh, ...carried];
}

/**
 * Liens Jira des tickets du projet, lus en une recherche paginée (C28).
 *
 * Les liens ne sont pas une table du §16 : ils se relisent chez Jira, au nom de
 * l'app, une fois par nuit. Le plafond borne la taille de la requête : il est
 * appliqué en amont (`splitByLinkCap`), et les tickets écartés gardent leurs
 * attributions enregistrées (rejeu par `carryBeyondAttributions`).
 */
async function linksOf(facts: readonly IssueFact[]): Promise<IssueLink[]> {
  const keys = facts.map((fact) => fact.key);
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
): Promise<ScoredCandidates> {
  const cache = await loadCache(projectId);
  const guard = createCallGuard(LLM_CALLS_PER_MINUTE);
  const scored = await scoreCandidates(prepared.evidence, prepared.debts, cache, { guard, deadline });
  await saveScores(
    projectId,
    scored.scores.map((score) => ({
      fingerprint: score.fingerprint,
      relevance: score.relevance,
      rationale: score.rationale,
    })),
  );
  return scored;
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
