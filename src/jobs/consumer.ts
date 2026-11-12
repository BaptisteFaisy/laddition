import { QueueResponse } from '@forge/events';
import { route } from '@forge/api';
import type { BootstrapProgress, ProjectSettings } from '../core/types';
import { bootstrapProgress as readProgress, updateBootstrapProgress } from '../platform/db/index';
import type { JiraIssueJson } from '../platform/jira';
import { jiraSendJson, searchIssues } from '../platform/jira';
import type { BatchState, BatchTotals } from './bootstrapState';
import { readBatch, resetBatches, sumBatches, writeBatch } from './bootstrapState';
import { storeIssue, storeIssues } from './issueSync';
import { requireSettings } from './projects';
import type { ProjectRecalc } from './recalc';
import { isRecalcPayload, pushQueueMessage, runRecalcMessage } from './recalcQueue';
import { ensureReady } from './schema';
import { eventBody, messageOf, nowIso, requireString } from './support';

/**
 * `consumer` (§15) : les travaux lourds, un message à la fois.
 *
 * Deux sortes de messages, aiguillées sur le champ `kind` :
 * - `recalc` : le recalcul d'**un** projet (C34), sous garde de durée ;
 * - le reste : un lot d'initialisation de 50 tickets (DT-12).
 *
 * Un lot est **rejiable sans double compte** (B25) : son état vit dans
 * `bootstrap_batch`, et la progression du projet est la somme de ses lots, pas
 * une accumulation. Les échecs par ticket sont comptés et leur motif remonte
 * dans `BootstrapProgress.error` (B26), et les rejeux sont bornés : ni boucle
 * infinie, ni chaîne de messages qui se démultiplie.
 */

/** Taille d'un lot : 50 tickets, historique compris. */
export const BATCH_SIZE = 50;

/** Profondeur d'historique initialisée à l'installation (DT-12). */
export const BOOTSTRAP_DAYS = 180;

/** Rejeux d'un même lot avant abandon (§24 : reprise sur erreur, pas acharnement). */
export const MAX_BATCH_ATTEMPTS = 3;

/** Lots maximum par initialisation : borne la chaîne de messages (B26). */
export const MAX_BOOTSTRAP_BATCHES = 400;

/** Corps d'un message de file d'initialisation. */
export interface BootstrapPayload {
  projectId: string;
  /** Jeton de la page suivante ; absent pour la première. */
  nextPageToken?: string;
}

/** Bilan d'un lot. */
export interface BatchResult {
  ok: boolean;
  projectId: string;
  done: number;
  failed: number;
  finished: boolean;
  error?: string;
}

/** Ce que le consommateur rend au runtime Forge. */
export type QueueMessageResult = BatchResult | ProjectRecalc | QueueResponse;

/** Décision prise pour un lot, d'après son état et la page lue. */
export interface BatchPlan {
  /** Le lot doit être relu et enregistré (faux s'il l'a déjà été). */
  ingest: boolean;
  /** Le lot suivant doit être mis en file (faux s'il l'a déjà été). */
  push: boolean;
  /** Nombre de tentatives de ce lot, rejeu compris. */
  attempts: number;
  /** Motif d'un abandon ; absent si le lot continue. */
  stop?: string;
}

/** Ce qu'il faut savoir de la page pour décider. */
export interface BatchPlanOptions {
  finished: boolean;
  hasNext: boolean;
  maxAttempts: number;
  /** Lots déjà enregistrés pour ce projet, celui-ci compris. */
  batches: number;
  maxBatches: number;
}

/**
 * Décide ce qu'un lot doit faire. Fonction pure : c'est elle qui garantit
 * l'idempotence (un lot déjà joué n'est ni ré-enregistré ni re-poussé) et la
 * borne des rejeux.
 */
export function planBatch(state: BatchState | null, options: BatchPlanOptions): BatchPlan {
  const attempts = (state?.attempts ?? 0) + 1;
  if (attempts > options.maxAttempts) {
    return {
      ingest: false,
      push: false,
      attempts,
      stop: `lot abandonné après ${options.maxAttempts} tentatives`,
    };
  }
  const chainHasRoom = options.batches < options.maxBatches;
  const push = !options.finished && options.hasNext && !(state?.pushed ?? false) && chainHasRoom;
  return { ingest: !(state?.ingested ?? false), push, attempts };
}

/** JQL de l'initialisation : le projet, sur la fenêtre d'historique, du plus ancien au plus récent. */
export function bootstrapJql(settings: ProjectSettings): string {
  return `project = "${settings.projectKey}" AND created >= -${BOOTSTRAP_DAYS}d ORDER BY created ASC`;
}

/** Champs lus pour un ticket d'initialisation (ceux de `toIssueFact`). */
export const BOOTSTRAP_FIELDS: readonly string[] = [
  'summary',
  'description',
  'issuetype',
  'project',
  'status',
  'created',
  'resolutiondate',
  'labels',
  'components',
  'timeoriginalestimate',
  'timetracking',
  'aggregatetimespent',
];

/**
 * Traite un message de la file : un recalcul de projet, ou un lot
 * d'initialisation. En cas d'erreur passagère, demande le rejeu du message.
 */
export async function bootstrapBatch(event: unknown): Promise<QueueMessageResult> {
  const body = eventBody(event);
  if (isRecalcPayload(body)) return recalcMessage(body);
  let payload: BootstrapPayload;
  try {
    payload = bootstrapPayloadOf(body);
  } catch (error) {
    return { ok: false, projectId: '', done: 0, failed: 0, finished: false, error: messageOf(error) };
  }
  try {
    await ensureReady();
    return await runBatch(payload);
  } catch (error) {
    // Échec avant `writeBatch` (réglages absents, page Jira illisible, SQL en
    // panne) : la tentative est comptée quand même, plus de rejeu infini (B26).
    return countedFailure(payload, messageOf(error));
  }
}

/** Un message de recalcul : un projet, sous garde de durée (C34). */
async function recalcMessage(body: Record<string, unknown>): Promise<ProjectRecalc | QueueResponse> {
  try {
    await ensureReady();
    return await runRecalcMessage(requireString(body, 'projectId'), nowIso());
  } catch {
    return retryLater();
  }
}

/** Demande le rejeu du message courant (échec passager). */
function retryLater(): QueueResponse {
  const response = new QueueResponse();
  response.retry();
  return response;
}

/**
 * Échec **avant** `writeBatch` (B26) : la tentative est comptée et écrite dans
 * le registre des lots — sans cela, une exception dans `requireSettings` ou une
 * page Jira illisible repartait en rejeu sans jamais incrémenter `attempts`.
 * Au-delà de `MAX_BATCH_ATTEMPTS`, le lot part en lettre morte : son erreur
 * reste dans `bootstrap_batch` (registre) et remonte dans la barre de
 * progression (signal), et le message n'est plus rejoué.
 */
async function countedFailure(payload: BootstrapPayload, reason: string): Promise<QueueMessageResult> {
  const token = payload.nextPageToken ?? '';
  let state: BatchState;
  try {
    const previous = await readBatch(payload.projectId, token);
    const attempts = (previous?.attempts ?? 0) + 1;
    state = {
      projectId: payload.projectId,
      pageToken: token,
      done: previous?.done ?? 0,
      failed: previous?.failed ?? 0,
      attempts,
      ingested: previous?.ingested ?? false,
      pushed: previous?.pushed ?? false,
      finished: previous?.finished ?? false,
      error:
        attempts > MAX_BATCH_ATTEMPTS
          ? `lot abandonné après ${MAX_BATCH_ATTEMPTS} tentatives : ${reason}`
          : reason,
      updatedAt: nowIso(),
    };
    await writeBatch(state);
  } catch {
    // Le registre lui-même est inaccessible (SQL hors service) : rien à
    // compter, Forge rejoue le message.
    return retryLater();
  }
  if (state.attempts <= MAX_BATCH_ATTEMPTS) return retryLater();
  await advance(payload.projectId, await sumBatches(payload.projectId), state.finished, state);
  return {
    ok: false,
    projectId: payload.projectId,
    done: state.done,
    failed: state.failed,
    finished: state.finished,
    error: state.error ?? reason,
  };
}

/** Une page : lecture, enregistrement, progression, lot suivant. */
async function runBatch(payload: BootstrapPayload): Promise<BatchResult> {
  const settings = await requireSettings(payload.projectId);
  const token = payload.nextPageToken ?? '';
  const state = await readBatch(payload.projectId, token);
  if (state?.ingested && (state.pushed || state.finished)) return replayOf(payload.projectId, state);
  const page = await searchIssues(bootstrapJql(settings), BOOTSTRAP_FIELDS, BATCH_SIZE, payload.nextPageToken);
  if (!page) throw new Error('page Jira illisible');
  const finished = page.nextPageToken === null;
  const totals = await sumBatches(payload.projectId);
  const plan = planBatch(state, {
    finished,
    hasNext: !finished,
    maxAttempts: MAX_BATCH_ATTEMPTS,
    batches: totals.batches + (state ? 0 : 1),
    maxBatches: MAX_BOOTSTRAP_BATCHES,
  });
  const counts = plan.ingest ? await ingest(page.issues, settings) : countsOf(state);
  const error = plan.stop ?? counts.error;
  const next = stateOf(payload, token, state, plan, counts, error, finished);
  await writeBatch(next);
  await advance(payload.projectId, await sumBatches(payload.projectId), finished && !plan.stop, next);
  if (plan.push && page.nextPageToken) await enqueueNext(payload.projectId, page.nextPageToken);
  return {
    ok: !error,
    projectId: payload.projectId,
    done: counts.done,
    failed: counts.failed,
    finished,
    ...(error ? { error } : {}),
  };
}

/** Un message déjà joué : rien à relire chez Jira, la progression est resservie. */
async function replayOf(projectId: string, state: BatchState): Promise<BatchResult> {
  await advance(projectId, await sumBatches(projectId), state.finished, state);
  return {
    ok: state.error === null,
    projectId,
    done: state.done,
    failed: state.failed,
    finished: state.finished,
    ...(state.error ? { error: state.error } : {}),
  };
}

/** Compte rendu d'un lot déjà enregistré, relu tel quel. */
function countsOf(state: BatchState | null): IngestCounts {
  return { done: state?.done ?? 0, failed: state?.failed ?? 0, error: state?.error ?? null };
}

/** État du lot après ce passage : les marques acquises ne redescendent jamais. */
function stateOf(
  payload: BootstrapPayload,
  token: string,
  previous: BatchState | null,
  plan: BatchPlan,
  counts: IngestCounts,
  error: string | null | undefined,
  finished: boolean,
): BatchState {
  return {
    projectId: payload.projectId,
    pageToken: token,
    done: counts.done,
    failed: counts.failed,
    attempts: plan.attempts,
    ingested: plan.ingest || (previous?.ingested ?? false),
    pushed: plan.push || (previous?.pushed ?? false),
    finished,
    error: error ?? null,
    updatedAt: nowIso(),
  };
}

/** Bilan de l'enregistrement d'un lot : les échecs portent leur motif (B26). */
export interface IngestCounts {
  done: number;
  failed: number;
  error: string | null;
}

/**
 * Enregistre chaque ticket du lot.
 *
 * Le lot est d'abord enregistré d'un coup (liens et règle JQL lus une seule
 * fois, C28) ; si l'ensemble échoue, on retombe sur un enregistrement ticket
 * par ticket pour isoler le fautif : un ticket illisible n'arrête pas le lot,
 * et son motif est retenu — plus de rejeu muet (B26).
 */
export async function ingest(
  issues: readonly JiraIssueJson[],
  settings: ProjectSettings,
): Promise<IngestCounts> {
  try {
    const result = await storeIssues([...issues], settings);
    return { done: result.facts.length, failed: issues.length - result.facts.length, error: null };
  } catch {
    return ingestOneByOne(issues, settings);
  }
}

/** Repli : un ticket à la fois, pour compter et nommer les échecs. */
async function ingestOneByOne(
  issues: readonly JiraIssueJson[],
  settings: ProjectSettings,
): Promise<IngestCounts> {
  let done = 0;
  let failed = 0;
  let error: string | null = null;
  for (const issue of issues) {
    try {
      await storeIssue(issue, settings);
      done += 1;
    } catch (issueError) {
      failed += 1;
      error ??= messageOf(issueError);
    }
  }
  return { done, failed, error };
}

/**
 * Barre de progression (DT-12) : les totaux viennent de la **somme des lots**,
 * jamais d'une accumulation — rejouer un lot ne change pas le total (B25).
 */
export function progressFrom(
  projectId: string,
  totals: BatchTotals,
  previous: BootstrapProgress | null,
  finished: boolean,
  at: string,
): BootstrapProgress {
  return {
    projectId,
    total: finished ? previous?.total ?? totals.done : Math.max(previous?.total ?? 0, totals.done),
    done: totals.done,
    failed: totals.failed,
    startedAt: previous?.startedAt ?? at,
    updatedAt: at,
    finished,
    error: totals.error,
    attempts: totals.attempts,
  };
}

/** Écrit la barre de progression du projet. */
async function advance(
  projectId: string,
  totals: BatchTotals,
  finished: boolean,
  batch: BatchState,
): Promise<void> {
  const previous = await readProgress(projectId);
  const progress = progressFrom(projectId, totals, previous, finished, batch.updatedAt || nowIso());
  await updateBootstrapProgress(progress);
}

/** Repousse le lot suivant : l'initialisation avance d'elle-même. */
async function enqueueNext(projectId: string, nextPageToken: string): Promise<void> {
  await pushQueueMessage({ projectId, nextPageToken });
}

/** Démarre l'initialisation d'un projet (bouton « Initialiser », DT-12). */
export async function startBootstrap(projectId: string): Promise<BootstrapProgress> {
  await ensureReady();
  const settings = await requireSettings(projectId);
  const at = nowIso();
  const total = await countIssues(settings);
  await resetBatches(projectId);
  const progress = progressFrom(projectId, { done: 0, failed: 0, batches: 0, error: null, attempts: 0 }, null, false, at);
  await updateBootstrapProgress({ ...progress, total });
  await enqueueNext(projectId, '');
  return { ...progress, total };
}

/** Nombre de tickets à initialiser, pour le dénominateur de la barre. */
async function countIssues(settings: ProjectSettings): Promise<number> {
  const sent = await jiraSendJson<{ count?: number }>(
    'POST',
    route`/rest/api/3/search/approximate-count`,
    { jql: bootstrapJql(settings) },
    'countBootstrapIssues',
  );
  const count = sent.data?.count;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

/** Payload du message ; un message sans projet est une erreur de configuration. */
function bootstrapPayloadOf(body: Record<string, unknown>): BootstrapPayload {
  const nextPageToken = body['nextPageToken'];
  const payload: BootstrapPayload = { projectId: requireString(body, 'projectId') };
  if (typeof nextPageToken === 'string' && nextPageToken.length > 0) payload.nextPageToken = nextPageToken;
  return payload;
}
