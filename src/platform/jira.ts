/**
 * Adaptateur REST Jira — I/O typées uniquement, aucun calcul métier.
 *
 * Contexte d'appel (§15) :
 *  - tout part avec `asApp()` (contexte d'installation), y compris la lecture
 *    du catalogue de statuts et la pagination de l'historique ;
 *  - `fetchComments` est la seule lecture marquée `AS USER` : un commentaire
 *    peut être invisible pour l'app, et le décompte d'intervenants (C1) doit
 *    refléter ce que voit le lecteur. Sans contexte utilisateur (job planifié),
 *    `asUser()` rend une erreur : la fonction rend alors `null`.
 *
 * Aucune fonction ne jette : chaque appel est enveloppé, journalise un message
 * court (jamais un contenu de ticket) et rend `null`. Aucune sortie réseau hors
 * Atlassian : seuls `requestJira` du produit sont utilisés.
 */
import { asApp, asUser, route } from '@forge/api';
import type { Route } from '@forge/api';
import type { HistoryEntry } from '../core/duration';
import { secondsToJp } from '../core/time';
import type { IssueFact, IssueLink, ProjectSettings, StatusCategory } from '../core/types';
import type {
  ChangelogPage,
  CommentPage,
  JiraHistory,
  JiraHistoryItem,
  JiraIssueJson,
  JiraLink,
  JiraStatus,
  SearchResponse,
} from './jira-types';
import { logShort, shortError } from './log';

export type { JiraFields, JiraIssueJson, JiraNamed, JiraStatus } from './jira-types';

/** Taille de page demandée à Jira (100 = maximum de l'API REST v3). */
const PAGE_SIZE = 100;

/** Garde-fou de pagination : on ne boucle jamais indéfiniment. */
const MAX_PAGES = 40;

const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

/** Champs demandés pour un ticket : le strict nécessaire au calcul. */
const ISSUE_FIELDS: readonly string[] = [
  'summary',
  'description',
  'issuetype',
  'project',
  'created',
  'resolutiondate',
  'status',
  'labels',
  'components',
  'timeoriginalestimate',
  'timetracking',
  'aggregatetimespent',
  'assignee',
  'reporter',
  'parent',
  'issuelinks',
];

/** Blocs Atlassian Document Format qui doivent produire un saut de ligne. */
const ADF_BLOCKS: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'listItem',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'tableRow',
  'panel',
  'rule',
]);

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

// ---------------------------------------------------------------------------
// Outils HTTP partagés (réutilisés par field.ts)
// ---------------------------------------------------------------------------

/**
 * GET JSON au nom de l'app. Rend `null` en cas d'échec HTTP, de corps illisible
 * ou d'exception : l'appelant décide du repli, l'adaptateur ne jette pas.
 */
export async function jiraGetJson<T>(url: Route, what: string): Promise<T | null> {
  try {
    const response = await asApp().requestJira(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      logShort(`${what}: HTTP ${response.status}`);
      return null;
    }
    const text = await response.text();
    if (text.trim().length === 0) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    logShort(`${what}: ${shortError(error)}`);
    return null;
  }
}

/**
 * POST / PUT JSON au nom de l'app. Tolère `204 No Content` (écriture sans
 * corps) : `ok` vaut alors `true` et `data` vaut `null`.
 */
export async function jiraSendJson<T>(
  method: string,
  url: Route,
  payload: unknown,
  what: string,
): Promise<SendResult<T>> {
  try {
    const response = await asApp().requestJira(url, {
      method,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logShort(`${what}: HTTP ${response.status}`);
      return { ok: false, data: null };
    }
    const text = await response.text();
    if (text.trim().length === 0) return { ok: true, data: null };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    logShort(`${what}: ${shortError(error)}`);
    return { ok: false, data: null };
  }
}

// ---------------------------------------------------------------------------
// Recherche et lecture de tickets
// ---------------------------------------------------------------------------

/**
 * Recherche JQL paginée par `nextPageToken` (`POST /rest/api/3/search/jql`).
 * Rend `null` si la page n'a pas pu être lue : c'est à l'appelant de décider
 * s'il arrête ou s'il garde les pages déjà obtenues.
 */
export async function searchIssues(
  jql: string,
  fields: readonly string[],
  maxResults: number,
  nextPageToken?: string,
): Promise<SearchPage | null> {
  const body: Record<string, unknown> = {
    jql,
    fields: [...fields],
    maxResults: Math.max(1, Math.min(maxResults, PAGE_SIZE)),
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const sent = await jiraSendJson<SearchResponse>('POST', route`/rest/api/3/search/jql`, body, 'searchIssues');
  if (!sent.ok || !sent.data) return null;
  return { issues: sent.data.issues ?? [], nextPageToken: sent.data.nextPageToken ?? null };
}

/** Un ticket complet (champs du calcul + `expand=changelog`). */
export async function fetchIssue(key: string): Promise<JiraIssueJson | null> {
  const fields = ISSUE_FIELDS.join(',');
  return jiraGetJson<JiraIssueJson>(
    route`/rest/api/3/issue/${key}?expand=changelog&fields=${fields}`,
    `fetchIssue ${key}`,
  );
}

/**
 * Historique de statuts, paginé depuis `startAt`, converti en `HistoryEntry`
 * de `core/duration.ts` (une entrée par changement de statut, rien d'autre).
 * Rend `null` si le catalogue de statuts est illisible : sans lui, aucune
 * catégorie n'est fiable et le calcul doit retomber sur l'approximation (§19).
 */
export async function fetchChangelog(issueIdOrKey: string, startAt = 0): Promise<HistoryEntry[] | null> {
  const categories = await loadStatusCategories();
  if (!categories) {
    logShort(`fetchChangelog ${issueIdOrKey}: catalogue de statuts indisponible`);
    return null;
  }
  const entries: HistoryEntry[] = [];
  let cursor = startAt;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await jiraGetJson<ChangelogPage>(
      route`/rest/api/3/issue/${issueIdOrKey}/changelog?startAt=${cursor}&maxResults=${PAGE_SIZE}`,
      `changelog ${issueIdOrKey}`,
    );
    if (!data) return page === 0 ? null : entries;
    const histories = data.histories ?? [];
    for (const history of histories) entries.push(...toHistoryEntries(history, categories));
    cursor += histories.length;
    if (data.isLast === true || histories.length === 0) return entries;
    if (data.total !== undefined && cursor >= data.total) return entries;
  }
  logShort(`fetchChangelog ${issueIdOrKey}: pagination bornée à ${MAX_PAGES} pages`);
  return entries;
}

/** Liens d'un ticket, orientés depuis ce ticket (`fromIssueId` = lui). */
export async function fetchLinks(issueIdOrKey: string): Promise<IssueLink[] | null> {
  const data = await jiraGetJson<JiraIssueJson>(
    route`/rest/api/3/issue/${issueIdOrKey}?fields=issuelinks`,
    `fetchLinks ${issueIdOrKey}`,
  );
  if (!data) return null;
  return (data.fields?.issuelinks ?? []).flatMap((link) => toIssueLinks(data.id, link));
}

/**
 * Auteurs distincts des commentaires (comptage des intervenants, C1).
 * `AS USER` : seuls les commentaires visibles par le lecteur sont comptés.
 * Rend `null` hors contexte utilisateur (job planifié, trigger système).
 */
export async function fetchComments(issueIdOrKey: string): Promise<string[] | null> {
  const authors = new Set<string>();
  let startAt = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await readCommentPage(issueIdOrKey, startAt);
    if (!data) return page === 0 ? null : Array.from(authors);
    const comments = data.comments ?? [];
    for (const comment of comments) {
      const accountId = comment.author?.accountId;
      if (accountId) authors.add(accountId);
    }
    startAt += comments.length;
    if (comments.length === 0) break;
    if (data.total !== undefined && startAt >= data.total) break;
  }
  return Array.from(authors);
}

/** Une page de commentaires, lue au nom de l'utilisateur. */
async function readCommentPage(issueIdOrKey: string, startAt: number): Promise<CommentPage | null> {
  try {
    const response = await asUser().requestJira(
      route`/rest/api/3/issue/${issueIdOrKey}/comment?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) {
      logShort(`fetchComments ${issueIdOrKey}: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as CommentPage;
  } catch (error) {
    logShort(`fetchComments ${issueIdOrKey}: ${shortError(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mappage JSON → domaine
// ---------------------------------------------------------------------------

/**
 * Mappe un JSON Jira vers `IssueFact`. Les zones et la classe de taille sont
 * laissées vides (`zones: []`, `size: 'unknown'`) : c'est `zonesForIssue` et
 * `sizeClassOf` qui décident (§8, §9). Les services affectés et le
 * post-mortem viennent du graphe ou du calcul, jamais de l'adaptateur.
 */
export function toIssueFact(issueJson: JiraIssueJson, settings: ProjectSettings): IssueFact {
  const fields = issueJson.fields ?? {};
  const type = fields.issuetype?.name ?? 'Inconnu';
  const typeLower = type.toLowerCase();
  const resolvedAt = fields.resolutiondate ?? null;
  return {
    issueId: issueJson.id,
    key: issueJson.key,
    projectId: fields.project?.id ?? settings.projectId,
    projectKey: fields.project?.key ?? settings.projectKey,
    type,
    isBug: typeLower.includes('bug'),
    isIncident: typeLower.includes('incident'),
    isDebt: isDebtIssue(issueJson, settings),
    zones: [],
    createdAt: fields.created ?? '',
    resolvedAt,
    closedAt: isDone(fields.status) ? resolvedAt : null,
    size: 'unknown',
    estimateJp: secondsToJp(fields.timeoriginalestimate ?? null, settings.hoursPerDay),
    loggedSeconds: fields.timetracking?.timeSpentSeconds ?? fields.aggregatetimespent ?? null,
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((component) => component.name ?? '').filter(Boolean),
    affectedServices: [],
    hasPostMortem: false,
    participants: 0,
    visible: true,
    summary: fields.summary ?? '',
    description: descriptionText(fields.description),
  };
}

/**
 * Règle de dette du projet (DT-01) : type de ticket, étiquette, ou JQL.
 *
 * Pour `jql`, la requête est la règle : elle sélectionne les tickets, et
 * l'appelant marque les résultats (`debtJqlMatch`) au lieu de réévaluer du JQL
 * hors ligne — on ne réimplémente pas un moteur de requête ici.
 */
export function isDebtIssue(issueJson: JiraIssueJson, settings: ProjectSettings): boolean {
  const rule = settings.debtRule;
  const wanted = rule.value.trim();
  if (wanted.length === 0) return false;
  switch (rule.kind) {
    case 'issueType': {
      const issueType = issueJson.fields?.issuetype;
      const id = (issueType?.id ?? '').toLowerCase();
      const name = (issueType?.name ?? '').toLowerCase();
      return id === wanted.toLowerCase() || name === wanted.toLowerCase();
    }
    case 'label':
      return (issueJson.fields?.labels ?? []).some((label) => label.toLowerCase() === wanted.toLowerCase());
    case 'jql':
      return issueJson.debtJqlMatch === true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Détails internes
// ---------------------------------------------------------------------------

/** Catalogue `statut → catégorie`, chargé une fois par invocation. */
let statusCatalog: Map<string, StatusCategory> | null = null;

async function loadStatusCategories(): Promise<Map<string, StatusCategory> | null> {
  if (statusCatalog) return statusCatalog;
  const statuses = await jiraGetJson<JiraStatus[]>(route`/rest/api/3/status`, 'statusCatalog');
  if (!statuses) return null;
  statusCatalog = buildStatusCatalog(statuses);
  return statusCatalog;
}

/** Indexe les statuts par identifiant et par nom (minuscules). */
function buildStatusCatalog(statuses: JiraStatus[]): Map<string, StatusCategory> {
  const catalog = new Map<string, StatusCategory>();
  for (const status of statuses) {
    const category = toStatusCategory(status.statusCategory?.key);
    if (!category) continue;
    if (status.id) catalog.set(status.id, category);
    if (status.name) catalog.set(status.name.toLowerCase(), category);
  }
  return catalog;
}

/** Clé de catégorie Jira → catégorie du domaine. */
function toStatusCategory(key: string | undefined): StatusCategory | null {
  switch (key) {
    case 'new':
      return 'todo';
    case 'indeterminate':
      return 'inprogress';
    case 'done':
      return 'done';
    default:
      return null;
  }
}

/** Un changement de statut → une entrée d'historique exploitable. */
function toHistoryEntries(history: JiraHistory, catalog: Map<string, StatusCategory>): HistoryEntry[] {
  const created = history.created;
  if (!created) return [];
  const entries: HistoryEntry[] = [];
  for (const item of history.items ?? []) {
    if (item.field !== 'status') continue;
    entries.push({ created, field: 'status', toStatusCategory: lookupCategory(item, catalog) });
  }
  return entries;
}

/** Catégorie du statut d'arrivée : par identifiant, puis par nom. */
function lookupCategory(item: JiraHistoryItem, catalog: Map<string, StatusCategory>): StatusCategory | null {
  const byId = item.to ? catalog.get(item.to) : undefined;
  if (byId) return byId;
  const name = item.toString?.toLowerCase();
  return name ? catalog.get(name) ?? null : null;
}

/** Un lien Jira → zéro, une ou deux arêtes orientées depuis ce ticket. */
function toIssueLinks(fromIssueId: string, link: JiraLink): IssueLink[] {
  const fallback = link.type?.name ?? 'relates to';
  const links: IssueLink[] = [];
  const outward = link.outwardIssue;
  if (outward?.id && outward.key) {
    links.push({ fromIssueId, toIssueId: outward.id, toKey: outward.key, type: link.type?.outward ?? fallback });
  }
  const inward = link.inwardIssue;
  if (inward?.id && inward.key) {
    links.push({ fromIssueId, toIssueId: inward.id, toKey: inward.key, type: link.type?.inward ?? fallback });
  }
  return links;
}

/** Vrai quand le statut courant est dans la catégorie « terminé ». */
function isDone(status: JiraStatus | undefined): boolean {
  return toStatusCategory(status?.statusCategory?.key) === 'done';
}

/** Description ADF → texte brut, bornée en profondeur (les ADF sont profonds). */
function descriptionText(description: unknown): string | undefined {
  if (typeof description === 'string') return description.trim() || undefined;
  const text = adfToText(description, 0).replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 0 ? text : undefined;
}

function adfToText(node: unknown, depth: number): string {
  if (depth > 12 || node === null || typeof node !== 'object') return '';
  const record = node as { type?: string; text?: string; content?: unknown[] };
  if (record.type === 'text') return record.text ?? '';
  if (record.type === 'hardBreak') return '\n';
  const children = Array.isArray(record.content) ? record.content : [];
  const inner = children.map((child) => adfToText(child, depth + 1)).join('');
  return ADF_BLOCKS.has(record.type ?? '') ? `${inner}\n` : inner;
}
