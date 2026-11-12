/**
 * Formes JSON de l'API REST Jira et lecteurs purs : aucune I/O ici, `jira.ts`
 * porte les appels réseau ; séparation = fichiers < 500 lignes, tests sans Forge.
 */

import type { HistoryEntry } from '../core/duration';
import { secondsToJp } from '../core/time';
import { parseStoryPoints } from '../core/units';
import type { IssueFact, IssueLink, ProjectSettings, StatusCategory } from '../core/types';

/* ------------------------------------------------------------------ formes */

export interface JiraNamed {
  id?: string;
  name?: string;
  key?: string;
}

/** Un utilisateur Jira : on ne connaît que l'`accountId`, jamais le nom (§18). */
export interface JiraUser {
  accountId?: string;
}

export interface JiraStatus {
  id?: string;
  name?: string;
  statusCategory?: { key?: string; name?: string };
}

export interface JiraFields {
  summary?: string;
  description?: unknown;
  issuetype?: JiraNamed;
  project?: JiraNamed;
  created?: string;
  resolutiondate?: string | null;
  status?: JiraStatus;
  labels?: string[];
  components?: JiraNamed[];
  timeoriginalestimate?: number | null;
  timetracking?: { timeSpentSeconds?: number | null } | null;
  aggregatetimespent?: number | null;
  assignee?: JiraUser | null;
  /** Affectations multiples (Jira Cloud), quand le site les propose. */
  assignees?: JiraUser[] | null;
  issuelinks?: JiraLink[];
  /** Champs personnalisés, dont l'identifiant du champ « coût de la dette ». */
  [fieldId: string]: unknown;
}

export interface JiraIssueJson {
  id: string;
  key: string;
  fields: JiraFields;
  changelog?: { histories?: JiraHistory[] };
  /**
   * Posé par l'appelant quand le ticket vient de la requête JQL de la règle
   * `jql` : c'est la requête elle-même qui décide, on ne réévalue pas du JQL
   * hors ligne (DT-01).
   */
  debtJqlMatch?: boolean;
}

export interface JiraHistoryItem {
  field?: string;
  to?: string | null;
  toString?: string | null;
}

export interface JiraHistory {
  id?: string;
  created?: string;
  items?: JiraHistoryItem[];
}

export interface JiraLink {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: { id?: string; key?: string };
  outwardIssue?: { id?: string; key?: string };
}

/**
 * Une page de `GET /rest/api/3/issue/{key}/changelog`. L'API paginée répond
 * `values`, le changelog embarqué (`?expand=changelog`) répond `histories` :
 * les deux formes sont acceptées (constat du 11/11 sur one-atlas-cndz,
 * ITO-9641 — n'en lire qu'une faisait des historiques vides sur un vrai site).
 */
export interface ChangelogPage {
  values?: JiraHistory[];
  histories?: JiraHistory[];
  total?: number;
  isLast?: boolean;
  startAt?: number;
  maxResults?: number;
  nextPage?: string;
}

/** Un commentaire, réduit à son auteur. */
export interface JiraComment {
  author?: JiraUser | null;
}

/** Une page de `GET /rest/api/3/issue/{key}/comment`. */
export interface CommentPage {
  comments?: JiraComment[];
  total?: number;
  startAt?: number;
  maxResults?: number;
}

/** Réponse de `POST /rest/api/3/search/jql`. */
export interface SearchResponse {
  issues?: JiraIssueJson[];
  nextPageToken?: string | null;
}

/** Un champ du site (`GET /rest/api/3/field`). */
export interface JiraFieldMeta {
  id?: string;
  name?: string;
}

/* --------------------------------------------------------------- constantes */

/** Blocs Atlassian Document Format qui doivent produire un saut de ligne. */
const ADF_BLOCKS: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList',
  'blockquote', 'codeBlock', 'tableRow', 'panel', 'rule',
]);

/** Types de lien Jira qui désignent un post-mortem (JSM : « Post-incident review »). */
const POST_MORTEM_LINK_NAMES: ReadonlySet<string> = new Set(['postincidentreview', 'postincident', 'postmortem', 'review']);

/** Motif des types de ticket qui portent un post-mortem (« [System] Post-incident review »). */
const POST_MORTEM_TYPE = /post[\s-]?(incident|it)?[\s-]?(review|mortem)|postmortem/i;

/** Clé de projet Jira : deux à douze caractères, majuscules (G87). */
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,10}$/;

/** Forme d'une clé de ticket : projet + numéro. */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,19}-\d{1,10}$/;

/* --------------------------------------------------- mappage JSON → domaine */

/** Ce que l'appelant sait et que le JSON seul ne dit pas : intervenants et
 * post-mortem demandent des lectures complémentaires, faites par l'adaptateur. */
export interface IssueFactExtras {
  /** Auteurs de commentaires vus par le lecteur (décompte des intervenants, C1). */
  commentAuthors?: readonly string[];
  /** Identifiants des champs Jira portant les services affectés (JSM). */
  serviceFieldIds?: readonly string[];
  /** Liens connus du ticket : charge utile ou lecture en lot (C28). */
  links?: readonly (JiraLink | IssueLink)[];
  /** Un post-mortem est lié au ticket (lu par une requête dédiée). */
  postMortem?: boolean;
}

/**
 * Mappe un JSON Jira vers `IssueFact`. Zones et classe de taille restent vides
 * (`zonesForIssue`, `sizeClassOf` décident, §8/§9) ; plafond C1 au domaine.
 */
export function toIssueFact(
  issueJson: JiraIssueJson,
  settings: ProjectSettings,
  extras: IssueFactExtras = {},
): IssueFact {
  const fields = issueJson.fields ?? {};
  const type = fields.issuetype?.name ?? 'Inconnu';
  const resolvedAt = fields.resolutiondate ?? null;
  const links = extras.links ?? fields.issuelinks ?? [];
  return {
    issueId: issueJson.id,
    key: issueJson.key,
    projectId: fields.project?.id ?? settings.projectId,
    projectKey: fields.project?.key ?? settings.projectKey,
    type,
    isBug: isBugIssue(fields),
    isIncident: isIncidentIssue(fields),
    isDebt: isDebtIssue(issueJson, settings),
    zones: [],
    createdAt: fields.created ?? '',
    resolvedAt,
    closedAt: isDone(fields.status) ? resolvedAt : null,
    size: 'unknown',
    estimateJp: secondsToJp(fields.timeoriginalestimate ?? null, settings.hoursPerDay),
    storyPoints: parseStoryPoints(fields[settings.storyPointField?.trim() ?? '']),
    loggedSeconds: fields.timetracking?.timeSpentSeconds ?? fields.aggregatetimespent ?? null,
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((component) => component.name ?? '').filter(Boolean),
    affectedServices: affectedServicesOf(fields, extras.serviceFieldIds ?? knownServiceFieldIds()),
    hasPostMortem: extras.postMortem ?? postMortemFromLinks(links),
    participants: participantIdsOf(fields, extras.commentAuthors ?? []).length,
    visible: true,
    summary: fields.summary ?? '',
    description: descriptionText(fields.description),
  };
}

/**
 * Règle de dette du projet (DT-01) : type de ticket, étiquette, ou JQL. Pour
 * `jql`, l'appelant marque les résultats (`debtJqlMatch`) au lieu de réévaluer
 * du JQL hors ligne — on ne réimplémente pas un moteur de requête ici.
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

/** Vrai quand le type de ticket désigne un bug (famille C2). */
export function isBugIssue(fields: JiraFields): boolean {
  return (fields.issuetype?.name ?? '').toLowerCase().includes('bug');
}

/** Vrai quand le type de ticket désigne un incident JSM (famille C1). */
export function isIncidentIssue(fields: JiraFields): boolean {
  return (fields.issuetype?.name ?? '').toLowerCase().includes('incident');
}

/* ------------------------------------------------------------ intervenants */

/** Identifiants des personnes affectées au ticket (les assignés). */
export function assigneeIdsOf(fields: JiraFields): string[] {
  const ids: string[] = [];
  const single = fields.assignee?.accountId;
  if (single) ids.push(single);
  for (const user of fields.assignees ?? []) {
    const id = user?.accountId;
    if (id) ids.push(id);
  }
  return ids;
}

/** Intervenants distincts : assignés et auteurs de commentaires (§9 C1). Le
 * plafond (`maxIncidentPeople`) est posé par le domaine : ici on compte. */
export function participantIdsOf(fields: JiraFields, commentAuthors: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const id of assigneeIdsOf(fields)) ids.add(id);
  for (const id of commentAuthors) if (id) ids.add(id);
  return Array.from(ids);
}

/** Auteurs d'une page de commentaires : des `accountId`, jamais des noms (§18). */
export function commentAuthorIds(page: CommentPage): string[] {
  const ids: string[] = [];
  for (const comment of page.comments ?? []) {
    const accountId = comment.author?.accountId;
    if (accountId) ids.push(accountId);
  }
  return ids;
}

/* ------------------------------------------------------- services affectés */

/** Noms des services affectés, lus dans la valeur d'un champ Jira. */
export function serviceNamesOf(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const name = serviceNameOf(item);
    if (name) names.push(name);
  }
  return names;
}

/** Nom lisible d'une valeur de service (objet nommé, ou texte). */
function serviceNameOf(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null;
  if (item === null || typeof item !== 'object') return null;
  const record = item as { name?: unknown; value?: unknown; serviceName?: unknown };
  for (const candidate of [record.name, record.value, record.serviceName]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

/**
 * Services affectés d'un incident (JSM).
 *
 * Le champ JSM porte un identifiant propre au site (`customfield_xxxxx`) :
 * l'adaptateur le résout par son nom (§17, V4) et le transmet ici — ou
 * l'enregistre par `setServiceFieldIds`, ce qui vaut pour tous les appelants.
 * Site sans ce champ — le cas du site de démo, où V4 est non concluant — la
 * liste est vide et la cascade du §8 rattache l'incident par son composant.
 */
export function affectedServicesOf(fields: JiraFields, fieldIds: readonly string[]): string[] {
  const names: string[] = [];
  for (const id of fieldIds) names.push(...serviceNamesOf(fields[id]));
  return Array.from(new Set(names));
}

/**
 * Champs « services affectés » du site, enregistrés par l'adaptateur : seul
 * état de ce module, un fait du site (pas une donnée de calcul), qui sert de
 * défaut à `toIssueFact`.
 */
let resolvedServiceFieldIds: readonly string[] = [];

/** Enregistre les champs « services affectés » résolus sur le site. */
export function setServiceFieldIds(ids: readonly string[]): void {
  resolvedServiceFieldIds = ids;
}

/** Champs « services affectés » connus du site. */
export function knownServiceFieldIds(): readonly string[] {
  return resolvedServiceFieldIds;
}

/* ------------------------------------------------------------- post-mortem */

/** Nom normalisé : minuscules, sans séparateur (« Post-incident review »). */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Vrai quand le type de lien désigne un post-mortem. */
export function isPostMortemLinkName(name: string | undefined): boolean {
  if (!name) return false;
  return POST_MORTEM_LINK_NAMES.has(normalizeName(name));
}

/** Vrai quand une phrase de lien mentionne un post-mortem (« is review of »). */
export function mentionsPostMortem(phrase: string | undefined): boolean {
  if (!phrase) return false;
  const normalized = normalizeName(phrase);
  return normalized.includes('postincidentreview') || normalized.includes('postmortem');
}

/** Vrai quand le type de ticket désigne un post-mortem (« [System] Post-incident review »). */
export function isPostMortemTypeName(name: string | undefined): boolean {
  if (!name) return false;
  return POST_MORTEM_TYPE.test(name);
}

/** Vrai quand un des liens du ticket renvoie vers un post-mortem. */
export function postMortemFromLinks(links: readonly (JiraLink | IssueLink)[]): boolean {
  for (const link of links) {
    const type = link.type;
    if (typeof type === 'string') {
      if (isPostMortemLinkName(type) || mentionsPostMortem(type)) return true;
      continue;
    }
    if (isPostMortemLinkName(type?.name)) return true;
    if (mentionsPostMortem(type?.outward) || mentionsPostMortem(type?.inward)) return true;
  }
  return false;
}

/* ------------------------------------------------------------- visibilité */

/**
 * Applique la visibilité du lecteur aux faits (§18).
 *
 * Le calcul nocturne tourne au nom de l'app : un ticket y est toujours
 * visible. C'est à la lecture, côté écran, qu'on demande à Jira ce que le
 * lecteur peut ouvrir ; les tickets absents sont **comptés mais masqués**.
 */
export function withVisibility(facts: IssueFact[], visibleKeys: ReadonlySet<string>): IssueFact[] {
  return facts.map((fact) => (visibleKeys.has(fact.key) ? fact : { ...fact, visible: false }));
}

/* -------------------------------------------------------------------- JQL */

/** Vrai quand la clé de projet est sûre à mettre dans un JQL (G87). */
export function isSafeProjectKey(key: string): boolean {
  return PROJECT_KEY.test(key.trim());
}

/** Valeur JQL citée : les guillemets sont retirés, jamais concaténés (G87). */
export function quoteKey(key: string): string {
  return `"${key.replace(/"/g, '')}"`;
}

/** JQL « ces clés de tickets » ; les clés qui ne sont pas des tickets sont écartées. */
export function keyInJql(keys: readonly string[]): string {
  const safe = keys.filter((key) => ISSUE_KEY.test(key.trim()));
  return `key in (${safe.map((key) => quoteKey(key.trim())).join(', ')})`;
}

/** JQL du projet, clé validée ; `null` si la clé n'est pas sûre (G87). */
export function projectJql(projectKey: string, extra = ''): string | null {
  if (!isSafeProjectKey(projectKey)) return null;
  const scoped = `project = ${quoteKey(projectKey.trim())}`;
  return extra.trim().length > 0 ? `${scoped} AND (${extra.trim()})` : scoped;
}

/* ------------------------------------------------- historique et statuts */

/**
 * Entrées d'une page de changelog, quelle que soit sa forme — fonction pure
 * testée sans Forge, prise en défaut le 11/11 (`histories` lu sur du `values`).
 */
export function historyItemsOf(page: ChangelogPage): JiraHistory[] {
  return page.values ?? page.histories ?? [];
}

/** Clé de catégorie Jira → catégorie du domaine. */
const STATUS_CATEGORIES: Record<string, StatusCategory> = {
  new: 'todo',
  indeterminate: 'inprogress',
  done: 'done',
};

export function toStatusCategory(key: string | undefined): StatusCategory | null {
  return key ? STATUS_CATEGORIES[key] ?? null : null;
}

/** Indexe les statuts par identifiant et par nom (minuscules). */
export function buildStatusCatalog(statuses: JiraStatus[]): Map<string, StatusCategory> {
  const catalog = new Map<string, StatusCategory>();
  for (const status of statuses) {
    const category = toStatusCategory(status.statusCategory?.key);
    if (!category) continue;
    if (status.id) catalog.set(status.id, category);
    if (status.name) catalog.set(status.name.toLowerCase(), category);
  }
  return catalog;
}

/** Un changement de statut → une entrée d'historique exploitable. */
export function toHistoryEntries(history: JiraHistory, catalog: Map<string, StatusCategory>): HistoryEntry[] {
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

/** Vrai quand le statut courant est dans la catégorie « terminé ». */
export function isDone(status: JiraStatus | undefined): boolean {
  return toStatusCategory(status?.statusCategory?.key) === 'done';
}

/* ------------------------------------------------------------------ liens */

/** Un lien Jira → zéro, une ou deux arêtes orientées depuis ce ticket. */
export function toIssueLinks(fromIssueId: string, link: JiraLink): IssueLink[] {
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

/** Liens d'un ticket, orientés depuis ce ticket. */
export function linksOfIssue(issue: JiraIssueJson): IssueLink[] {
  return (issue.fields?.issuelinks ?? []).flatMap((link) => toIssueLinks(issue.id, link));
}

/* ------------------------------------------------------------- description */

/** Description ADF → texte brut, bornée en profondeur (les ADF sont profonds). */
export function descriptionText(description: unknown): string | undefined {
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
