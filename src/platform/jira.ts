/**
 * Adaptateur REST Jira — I/O typées uniquement, aucun calcul métier.
 *
 * Contexte d'appel (§15) :
 *  - tout part avec `asApp()` (contexte d'installation), y compris la lecture
 *    du catalogue de statuts et la pagination de l'historique ;
 *  - `fetchComments` et `visibleKeysForUser` sont les seules lectures marquées
 *    `AS USER` : un commentaire peut être invisible pour l'app, et la
 *    visibilité d'un ticket est une affaire de lecteur (§18). Sans contexte
 *    utilisateur (job planifié), `asUser()` rend une erreur : la fonction rend
 *    alors `null`, et le repli au nom de l'app est explicite.
 *
 * Débit : un 429 ou un 503 est repris, au plus trois tentatives, en honorant
 * `Retry-After` (C32). Jamais de boucle infinie.
 *
 * Aucune fonction ne jette : chaque appel est enveloppé, journalise un message
 * court (jamais un contenu de ticket) et rend `null`. Aucune sortie réseau hors
 * Atlassian : seuls `requestJira` du produit sont utilisés.
 */
import { asApp, asUser, route } from '@forge/api';
import type { RequestInit, Route } from '@forge/api';
import type { HistoryEntry } from '../core/duration';
import type { IssueLink, StatusCategory } from '../core/types';
import type {
  ChangelogPage,
  CommentPage,
  JiraFieldMeta,
  JiraIssueJson,
  JiraStatus,
  SearchResponse,
} from './jira-types';
import {
  buildStatusCatalog, commentAuthorIds, historyItemsOf, keyInJql, linksOfIssue, quoteKey,
  setServiceFieldIds, toHistoryEntries,
} from './jira-types';
import { logShort, shortError } from './log';

export type { JiraFields, JiraIssueJson, JiraNamed, JiraStatus } from './jira-types';
export { historyItemsOf, isDebtIssue, toIssueFact, withVisibility } from './jira-types';

/** Contexte d'appel : au nom de l'app (installation) ou du lecteur (§18). */
type JiraContext = 'app' | 'user';

/** Taille de page demandée à Jira (100 = maximum de l'API REST v3). */
const PAGE_SIZE = 100;

/** Garde-fou de pagination : on ne boucle jamais indéfiniment. */
const MAX_PAGES = 40;

/** Statuts qui méritent un nouvel essai : 429 (débit) et 503 (indisponible). */
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/** Nombre maximal de tentatives : un essai, deux reprises (C32). */
const MAX_ATTEMPTS = 3;

/** Attente de base du repli exponentiel, et son plafond. */
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

/**
 * Champs demandés pour un ticket : le strict nécessaire au calcul.
 *
 * `assignee` sert au décompte des intervenants (C1), `issuelinks` à la
 * détection du post-mortem et aux attributions. Les identifiants des champs
 * « services affectés » du site s'ajoutent à la volée (§17, V4).
 */
const ISSUE_FIELDS: readonly string[] = [
  'summary', 'description', 'issuetype', 'project', 'created', 'resolutiondate',
  'status', 'labels', 'components', 'timeoriginalestimate', 'timetracking',
  'aggregatetimespent', 'assignee', 'reporter', 'parent', 'issuelinks',
];

/** Champs que l'adaptateur ajoute toujours : le calcul en a besoin partout. */
const ALWAYS_FIELDS: readonly string[] = ['assignee'];

/** Noms de champ JSM qui portent les services affectés d'un incident (§17, V4). */
const SERVICE_FIELD_NAMES: readonly string[] = [
  'affected services', 'affected service', 'services affected', 'service affected', 'incident services',
];

/** Une page de recherche : la clé de pagination vaut `null` en fin de liste. */
export interface SearchPage {
  issues: JiraIssueJson[];
  nextPageToken: string | null;
}

/** Résultat d'un envoi JSON : `ok` dit ce que le code HTTP a dit. */
export interface SendResult<T> {
  ok: boolean;
  data: T | null;
}

/** Historique d'un ticket, avec son marqueur de troncature (C41). */
export interface ChangelogRead {
  entries: HistoryEntry[];
  /** Vrai quand la pagination bornée a été atteinte : historique incomplet. */
  truncated: boolean;
}

/** Réponse HTTP Forge, réduite à ce que l'adaptateur lit. */
interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}

/* --- Outils HTTP partagés (réutilisés par field.ts) --- */

/**
 * Appel HTTP avec reprises bornées (C32).
 *
 * Un 429 ou un 503 est repris jusqu'à `MAX_ATTEMPTS` tentatives : on attend
 * `Retry-After` quand Jira l'envoie, sinon un repli exponentiel plafonné. Une
 * exception n'est reprise que si l'appelant le demande — hors contexte
 * utilisateur, `asUser()` échoue toujours, le reprendre ne servirait à rien.
 */
async function requestWithRetry(
  send: () => Promise<HttpResponse>,
  what: string,
  retryErrors = true,
): Promise<HttpResponse | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await send();
      if (!RETRY_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) return response;
      const wait = retryDelayMs(retryAfterOf(response), attempt);
      logShort(`${what}: HTTP ${response.status}, reprise dans ${wait} ms`);
      await sleep(wait);
    } catch (error) {
      if (!retryErrors || attempt === MAX_ATTEMPTS) {
        logShort(`${what}: ${shortError(error)}`);
        return null;
      }
      const wait = backoffMs(attempt);
      logShort(`${what}: ${shortError(error)}, reprise dans ${wait} ms`);
      await sleep(wait);
    }
  }
  return null;
}

/** Attente avant reprise : `Retry-After` s'il est là, sinon repli exponentiel. */
export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && retryAfter.trim().length > 0 && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_BACKOFF_MS);
  }
  return backoffMs(attempt);
}

/** Repli exponentiel : 500 ms, 1 s, 2 s… plafonné à 8 s. */
export function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

/** En-tête `Retry-After` ; `null` s'il est absent ou illisible. */
function retryAfterOf(response: HttpResponse): string | null {
  try {
    return response.headers.get('Retry-After');
  } catch {
    return null;
  }
}

/** Attente bornée ; ne jette jamais. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Corps JSON d'une réponse : `null` si le code n'est pas bon ou le corps illisible. */
async function readJson<T>(response: HttpResponse | null, what: string): Promise<T | null> {
  if (!response) return null;
  if (!response.ok) {
    logShort(`${what}: HTTP ${response.status}`);
    return null;
  }
  try {
    const text = await response.text();
    if (text.trim().length === 0) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    logShort(`${what}: ${shortError(error)}`);
    return null;
  }
}

/** Requête Jira dans le contexte demandé. */
function requestIn(context: JiraContext, url: Route, init: RequestInit): Promise<HttpResponse> {
  return context === 'user' ? asUser().requestJira(url, init) : asApp().requestJira(url, init);
}

/**
 * GET JSON au nom de l'app par défaut. Rend `null` en cas d'échec HTTP, de
 * corps illisible ou d'exception : l'appelant décide du repli, l'adaptateur ne
 * jette pas.
 */
export async function jiraGetJson<T>(url: Route, what: string, context: JiraContext = 'app'): Promise<T | null> {
  const response = await requestWithRetry(
    () => requestIn(context, url, { headers: { Accept: 'application/json' } }),
    what,
    context === 'app',
  );
  return readJson<T>(response, what);
}

/**
 * POST / PUT JSON au nom de l'app par défaut. Tolère `204 No Content`
 * (écriture sans corps) : `ok` vaut alors `true` et `data` vaut `null`.
 */
export async function jiraSendJson<T>(
  method: string,
  url: Route,
  payload: unknown,
  what: string,
  context: JiraContext = 'app',
): Promise<SendResult<T>> {
  const response = await requestWithRetry(
    () => requestIn(context, url, { method, headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    what,
    context === 'app',
  );
  if (!response) return { ok: false, data: null };
  if (!response.ok) {
    logShort(`${what}: HTTP ${response.status}`);
    return { ok: false, data: null };
  }
  try {
    const text = await response.text();
    if (text.trim().length === 0) return { ok: true, data: null };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    logShort(`${what}: ${shortError(error)}`);
    return { ok: false, data: null };
  }
}

/* --- Recherche et lecture de tickets --- */

/** Champs demandés : ceux de l'appelant, plus ceux dont le calcul a besoin. */
async function wantedFields(fields: readonly string[]): Promise<string[]> {
  const serviceFields = await serviceFieldIds();
  return Array.from(new Set([...fields, ...ALWAYS_FIELDS, ...serviceFields]));
}

/**
 * Recherche JQL paginée par `nextPageToken` (`POST /rest/api/3/search/jql`).
 *
 * Rend `null` si la page n'a pas pu être lue : c'est à l'appelant de décider
 * s'il arrête ou s'il garde les pages déjà obtenues. Au nom de l'utilisateur
 * (`context: 'user'`), Jira ne rend que les tickets que le lecteur peut voir :
 * c'est la base du masquage du §18.
 */
export async function searchIssues(
  jql: string,
  fields: readonly string[],
  maxResults: number,
  nextPageToken?: string,
  context: JiraContext = 'app',
): Promise<SearchPage | null> {
  const body: Record<string, unknown> = {
    jql,
    fields: context === 'app' ? await wantedFields(fields) : [...fields],
    maxResults: Math.max(1, Math.min(maxResults, PAGE_SIZE)),
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const sent = await jiraSendJson<SearchResponse>('POST', route`/rest/api/3/search/jql`, body, 'searchIssues', context);
  if (!sent.ok || !sent.data) return null;
  return { issues: sent.data.issues ?? [], nextPageToken: sent.data.nextPageToken ?? null };
}

/** Un ticket complet (champs du calcul + `expand=changelog`). */
export async function fetchIssue(key: string): Promise<JiraIssueJson | null> {
  const fields = [...ISSUE_FIELDS, ...(await serviceFieldIds())].join(',');
  return jiraGetJson<JiraIssueJson>(
    route`/rest/api/3/issue/${key}?expand=changelog&fields=${fields}`,
    `fetchIssue ${key}`,
  );
}

/**
 * Historique de statuts d'un ticket, paginé depuis `startAt`, converti en
 * `HistoryEntry` de `core/duration.ts` (une entrée par changement de statut).
 *
 * Rend `null` si le catalogue de statuts est illisible : sans lui, aucune
 * catégorie n'est fiable et le calcul retombe sur l'approximation (§19).
 * `truncated` signale que la pagination bornée a été atteinte : l'historique
 * est incomplet et le fait porte alors `historyTruncated` (C41).
 */
export async function fetchHistory(issueIdOrKey: string, startAt = 0): Promise<ChangelogRead | null> {
  const categories = await loadStatusCategories();
  if (!categories) {
    logShort(`fetchHistory ${issueIdOrKey}: catalogue de statuts indisponible`);
    return null;
  }
  const entries: HistoryEntry[] = [];
  let cursor = startAt;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await jiraGetJson<ChangelogPage>(
      route`/rest/api/3/issue/${issueIdOrKey}/changelog?startAt=${cursor}&maxResults=${PAGE_SIZE}`,
      `changelog ${issueIdOrKey}`,
    );
    if (!data) return page === 0 ? null : { entries, truncated: true };
    const histories = historyItemsOf(data);
    for (const history of histories) entries.push(...toHistoryEntries(history, categories));
    cursor += histories.length;
    if (data.isLast === true || histories.length === 0) return { entries, truncated: false };
    if (data.total !== undefined && cursor >= data.total) return { entries, truncated: false };
  }
  logShort(`fetchHistory ${issueIdOrKey}: historique tronqué à ${MAX_PAGES} pages`);
  return { entries, truncated: true };
}

/** Historique seul ; le marqueur de troncature se lit par `fetchHistory`. */
export async function fetchChangelog(issueIdOrKey: string, startAt = 0): Promise<HistoryEntry[] | null> {
  const read = await fetchHistory(issueIdOrKey, startAt);
  return read ? read.entries : null;
}

/** Liens d'un ticket, orientés depuis ce ticket (`fromIssueId` = lui). */
export async function fetchLinks(issueIdOrKey: string): Promise<IssueLink[] | null> {
  const data = await jiraGetJson<JiraIssueJson>(
    route`/rest/api/3/issue/${issueIdOrKey}?fields=issuelinks`,
    `fetchLinks ${issueIdOrKey}`,
  );
  return data ? linksOfIssue(data) : null;
}

/**
 * Liens d'un lot de tickets, lus en une recherche JQL paginée (C28).
 *
 * Une requête `key in (…)` avec `fields=issuelinks` remplace N lectures
 * unitaires : sur un lot de 50 tickets, 50 appels deviennent une ou deux
 * pages. `fetchLinks` reste le chemin unitaire (trigger sur un seul ticket).
 */
export async function fetchLinksBatch(issueKeys: readonly string[]): Promise<Map<string, IssueLink[]>> {
  const links = new Map<string, IssueLink[]>();
  const keys = issueKeys.filter((key) => key.trim().length > 0);
  if (keys.length === 0) return links;
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const found = await searchIssues(keyInJql(keys), ['issuelinks'], keys.length, token);
    if (!found) break;
    for (const issue of found.issues) {
      const list = linksOfIssue(issue);
      if (list.length > 0) links.set(issue.key, list);
    }
    token = found.nextPageToken ?? undefined;
    if (!token) break;
  }
  return links;
}

/* --- Commentaires et intervenants (C1) --- */

/**
 * Auteurs distincts des commentaires (comptage des intervenants, C1).
 *
 * `AS USER` : seuls les commentaires visibles par le lecteur sont comptés, et
 * ce sont des `accountId` — jamais des noms (§18). Rend `null` hors contexte
 * utilisateur (job planifié, trigger système) : le repli est alors la lecture
 * au nom de l'app, `fetchCommentsAsApp`.
 */
export async function fetchComments(issueIdOrKey: string): Promise<string[] | null> {
  return readCommentAuthors(issueIdOrKey, 'user');
}

/** Mêmes auteurs, lus au nom de l'app : c'est le contexte du calcul nocturne. */
export async function fetchCommentsAsApp(issueIdOrKey: string): Promise<string[] | null> {
  return readCommentAuthors(issueIdOrKey, 'app');
}

/** Auteurs distincts, paginés, dans le contexte demandé. */
async function readCommentAuthors(issueIdOrKey: string, context: JiraContext): Promise<string[] | null> {
  const authors = new Set<string>();
  let startAt = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await readCommentPage(issueIdOrKey, startAt, context);
    if (!data) return page === 0 ? null : Array.from(authors);
    const comments = data.comments ?? [];
    for (const accountId of commentAuthorIds(data)) authors.add(accountId);
    startAt += comments.length;
    if (comments.length === 0) break;
    if (data.total !== undefined && startAt >= data.total) break;
  }
  return Array.from(authors);
}

/** Une page de commentaires, lue dans le contexte demandé. */
async function readCommentPage(
  issueIdOrKey: string,
  startAt: number,
  context: JiraContext,
): Promise<CommentPage | null> {
  const url = route`/rest/api/3/issue/${issueIdOrKey}/comment?startAt=${startAt}&maxResults=${PAGE_SIZE}`;
  return jiraGetJson<CommentPage>(url, `fetchComments ${issueIdOrKey}`, context);
}

/* --- Services affectés, post-mortem, visibilité, règle de dette --- */

/** Identifiants des champs « services affectés » du site, résolus une fois. */
let serviceFieldCache: string[] | null = null;

/**
 * Identifiants des champs Jira portant les services affectés d'un incident.
 *
 * Le nom du champ est stable (« Affected services »), pas son identifiant
 * (`customfield_xxxxx`) : on le résout par le catalogue des champs, une fois
 * par invocation. Site sans ce champ — le cas du site de démo, où V4 est non
 * concluant — la liste est vide : `affectedServices` reste vide et la cascade
 * du §8 rattache l'incident par son composant Jira.
 */
export async function serviceFieldIds(): Promise<string[]> {
  if (serviceFieldCache) return serviceFieldCache;
  const fields = await jiraGetJson<JiraFieldMeta[]>(route`/rest/api/3/field`, 'serviceFieldIds');
  if (!fields) return [];
  const ids: string[] = [];
  for (const field of fields) {
    const name = (field.name ?? '').trim().toLowerCase();
    if (field.id && SERVICE_FIELD_NAMES.includes(name)) ids.push(field.id);
  }
  serviceFieldCache = ids;
  setServiceFieldIds(ids);
  return ids;
}

/**
 * Types des tickets liés à un ticket (détection du post-mortem, C1).
 *
 * Un lien Jira ne porte pas le type du ticket lié : on lit les tickets liés
 * par JQL (`issue in linkedIssues(…)`) et on regarde leur type.
 */
export async function fetchLinkedIssueTypes(issueKey: string): Promise<string[]> {
  const page = await searchIssues(`issue in linkedIssues(${quoteKey(issueKey)})`, ['issuetype'], PAGE_SIZE);
  if (!page) return [];
  return page.issues.map((issue) => issue.fields?.issuetype?.name ?? '').filter((name) => name.length > 0);
}

/**
 * Clés des tickets que le lecteur courant peut ouvrir (§18).
 *
 * La recherche au nom de l'utilisateur ne rend que les tickets qu'il voit :
 * l'absence d'une clé dans le résultat vaut « masqué ». Rend `null` si la
 * recherche n'a pas abouti — le doute ne masque rien, il laisse les faits tels
 * quels.
 */
export async function visibleKeysForUser(issueKeys: readonly string[]): Promise<Set<string> | null> {
  const keys = issueKeys.filter((key) => key.trim().length > 0);
  if (keys.length === 0) return new Set<string>();
  const page = await searchIssues(keyInJql(keys), ['issuetype'], keys.length, undefined, 'user');
  if (!page) return null;
  return new Set(page.issues.map((issue) => issue.key));
}

/**
 * Clés des tickets désignés par la règle JQL du projet (DT-01).
 *
 * La règle est une requête : c'est elle qui décide, jamais un moteur de
 * requête réécrit ici. Une seule recherche par lot, paginée.
 */
export async function debtJqlKeys(jql: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const query = jql.trim();
  if (query.length === 0) return keys;
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const found = await searchIssues(query, ['issuetype'], PAGE_SIZE, token);
    if (!found) {
      logShort('debtJqlKeys: requête illisible, aucun ticket marqué');
      break;
    }
    for (const issue of found.issues) keys.add(issue.key);
    token = found.nextPageToken ?? undefined;
    if (!token) break;
  }
  return keys;
}

/* --- Détails internes --- */

/** Catalogue `statut → catégorie`, chargé une fois par invocation. */
let statusCatalog: Map<string, StatusCategory> | null = null;

async function loadStatusCategories(): Promise<Map<string, StatusCategory> | null> {
  if (statusCatalog) return statusCatalog;
  const statuses = await jiraGetJson<JiraStatus[]>(route`/rest/api/3/status`, 'statusCatalog');
  if (!statuses) return null;
  statusCatalog = buildStatusCatalog(statuses);
  return statusCatalog;
}
