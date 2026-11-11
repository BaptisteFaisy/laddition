import { Queue, QueueResponse } from '@forge/events';
import { route } from '@forge/api';
import type { BootstrapProgress, ProjectSettings } from '../core/types';
import {
  bootstrapProgress as readProgress,
  updateBootstrapProgress,
} from '../platform/db/index';
import type { JiraIssueJson } from '../platform/jira';
import { jiraSendJson, searchIssues } from '../platform/jira';
import { storeIssue } from './issueSync';
import { requireSettings } from './projects';
import { ensureReady } from './schema';
import { eventBody, messageOf, nowIso, requireString } from './support';

/**
 * `consumer` (§15) : l'initialisation de l'historique, par lots de 50.
 *
 * Chaque lot est un message de file : il traite une page Jira, enregistre les
 * faits et les durées, met à jour la barre de progression, puis repousse le lot
 * suivant. Rejouer un lot ne duplique rien (`upsert` sur `issue_fact`,
 * remplacement des séjours), et une erreur rejoue le lot au lieu de le perdre
 * (§24 « reprise sur erreur »).
 */

/** Nom de la file du module `consumer` (doit correspondre au manifeste). */
export const BOOTSTRAP_QUEUE = 'laddition-bootstrap';

/** Taille d'un lot : 50 tickets, historique compris. */
export const BATCH_SIZE = 50;

/** Profondeur d'historique initialisée à l'installation (DT-12). */
export const BOOTSTRAP_DAYS = 180;

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
 * Traite un lot : une page de 50 tickets, puis le lot suivant.
 * Rend un bilan ; en cas d'erreur passagère, demande le rejeu du message.
 */
export async function bootstrapBatch(event: unknown): Promise<BatchResult | QueueResponse> {
  let payload: BootstrapPayload;
  try {
    payload = payloadOfEvent(event);
  } catch (error) {
    return { ok: false, projectId: '', done: 0, failed: 0, finished: false, error: messageOf(error) };
  }
  try {
    await ensureReady();
    return await runBatch(payload);
  } catch {
    // Jira ou SQL indisponible : Forge rejoue ce lot, rien n'est perdu.
    return retryLater();
  }
}

/** Demande le rejeu du message courant (échec passager). */
function retryLater(): QueueResponse {
  const response = new QueueResponse();
  response.retry();
  return response;
}

/** Une page : lecture, enregistrement, progression, lot suivant. */
async function runBatch(payload: BootstrapPayload): Promise<BatchResult> {
  const settings = await requireSettings(payload.projectId);
  const page = await searchIssues(bootstrapJql(settings), BOOTSTRAP_FIELDS, BATCH_SIZE, payload.nextPageToken);
  if (!page) throw new Error('page Jira illisible');
  const counts = await ingest(page.issues, settings);
  const finished = page.nextPageToken === null;
  await advance(payload.projectId, counts, finished);
  if (!finished && page.nextPageToken) await enqueueNext(payload.projectId, page.nextPageToken);
  return { ok: true, projectId: payload.projectId, ...counts, finished };
}

/** Enregistre chaque ticket du lot ; un ticket en échec n'arrête pas le lot. */
async function ingest(
  issues: JiraIssueJson[],
  settings: ProjectSettings,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const issue of issues) {
    try {
      await storeIssue(issue, settings);
      done += 1;
    } catch {
      failed += 1;
    }
  }
  return { done, failed };
}

/** Met à jour la barre de progression (DT-12) ; le total se fige au dernier lot. */
async function advance(
  projectId: string,
  counts: { done: number; failed: number },
  finished: boolean,
): Promise<void> {
  const previous = await readProgress(projectId);
  const at = nowIso();
  const progress: BootstrapProgress = {
    projectId,
    total: finished ? previous?.total ?? counts.done : Math.max(previous?.total ?? 0, counts.done),
    done: (previous?.done ?? 0) + counts.done,
    failed: (previous?.failed ?? 0) + counts.failed,
    startedAt: previous?.startedAt ?? at,
    updatedAt: at,
    finished,
  };
  await updateBootstrapProgress(progress);
}

/** Repousse le lot suivant : l'initialisation avance d'elle-même. */
async function enqueueNext(projectId: string, nextPageToken: string): Promise<void> {
  const queue = new Queue<Record<string, unknown>>({ key: BOOTSTRAP_QUEUE });
  await queue.push({ body: { projectId, nextPageToken } });
}

/** Démarre l'initialisation d'un projet (bouton « Initialiser », DT-12). */
export async function startBootstrap(projectId: string): Promise<BootstrapProgress> {
  await ensureReady();
  const settings = await requireSettings(projectId);
  const at = nowIso();
  const total = await countIssues(settings);
  const progress: BootstrapProgress = {
    projectId,
    total,
    done: 0,
    failed: 0,
    startedAt: at,
    updatedAt: at,
    finished: false,
  };
  await updateBootstrapProgress(progress);
  await enqueueNext(projectId, '');
  return progress;
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
function payloadOfEvent(event: unknown): BootstrapPayload {
  const body = eventBody(event);
  const nextPageToken = body['nextPageToken'];
  const payload: BootstrapPayload = { projectId: requireString(body, 'projectId') };
  if (typeof nextPageToken === 'string' && nextPageToken.length > 0) payload.nextPageToken = nextPageToken;
  return payload;
}
