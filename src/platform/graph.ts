/**
 * Teamwork Graph — enrichissement des zones et des services (§15).
 *
 * Toutes ces lectures passent par `asUser()` : le graphe ne rend que ce que
 * l'utilisateur a le droit de voir, et un scope manquant rend une liste vide
 * sans erreur (§17). Deux états distincts, traités différemment (item C43) :
 *  - « vide »  : la requête aboutit, le graphe ne connaît rien → mis en cache ;
 *  - « échec » : HTTP != 200 (429…), erreur GraphQL, exception → JAMAIS mis
 *    en cache, et journalisé dans `takeGraphFailures()` pour le diagnostic.
 *
 * Cache : clés préfixées par l'utilisateur (les résultats du graphe dépendent
 * de ses scopes — un cache partagé entre utilisateurs fuit des zones d'un
 * écran à l'autre), TTL courte, remis à zéro à chaque invocation Forge (§15).
 * Les écrans passent `context.accountId` en `userKey` ; sans lui, la clé
 * par défaut « app » isole au moins l'appel des autres utilisateurs.
 *
 * INTERDIT — jamais d'appel au graphe depuis le calcul nocturne
 * (`jobs/scheduledTrigger`, §10) : le job tourne sans utilisateur, `asUser()`
 * n'y a pas de contexte, et le calcul ne doit dépendre d'aucune permission
 * personnelle. Le graphe habille l'affichage ; il ne produit aucune preuve et
 * n'entre dans aucune addition.
 */
import { asUser } from '@forge/api';
import { logShort, shortError } from './log';

/** Zone(s) Compass d'un ticket, par clé de ticket. */
export type ZoneLinks = Map<string, string[]>;

/** Équipe propriétaire d'un composant Compass, par identifiant de composant. */
export type TeamByComponent = Map<string, string>;

/** Services affectés d'un incident JSM, par clé de ticket. */
export type ServicesByIssue = Map<string, string[]>;

/** Réponse HTTP minimale attendue du transport (compatible `APIResponse`). */
export interface GraphResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Transport injectable : les tests n'appellent jamais le réseau. */
export interface GraphTransport {
  requestTeamworkGraph(
    query: string,
    variables: Record<string, unknown>,
    operationName: string,
  ): Promise<GraphResponse>;
}

/** Durée de vie d'une entrée de cache : courte, le graphe évolue vite. */
export const GRAPH_TTL_MS = 60_000;

/** Clé de cache par défaut quand l'appelant ne connaît pas l'utilisateur. */
export const SHARED_USER_KEY = 'app';

/** Requête « Jira work item impacts Compass component ». */
const ZONE_LINKS_QUERY = `query ZoneLinks($keys: [String!]!) {
  jiraWorkItems(keys: $keys) {
    nodes {
      key
      compassComponents { nodes { id name } }
    }
  }
}`;

/** Requête « Atlassian team owns Compass component ». */
const TEAM_BY_COMPONENT_QUERY = `query TeamByComponent($ids: [String!]!) {
  compassComponents(ids: $ids) {
    nodes {
      id
      name
      team { name }
    }
  }
}`;

/** Requête « incident JSM → service ». */
const INCIDENT_SERVICES_QUERY = `query IncidentServices($keys: [String!]!) {
  jiraWorkItems(keys: $keys) {
    nodes {
      key
      affectedServices { nodes { id name } }
    }
  }
}`;

interface Connection<T> {
  nodes?: Array<T | null> | null;
}

interface GraphPayload<T> {
  data?: T | null;
  errors?: Array<{ message?: string }>;
}

interface ZoneLinkNode {
  key?: string;
  compassComponents?: Connection<{ name?: string }>;
}

interface ComponentTeamNode {
  id?: string;
  name?: string;
  team?: { name?: string } | null;
}

interface IncidentNode {
  key?: string;
  affectedServices?: Connection<{ name?: string }>;
}

/** Une entrée de cache : valeur + expiration (TTL courte, item C43). */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Décrit une lecture du graphe : requête, extraction, valeur « vide ». */
interface GraphRead<V> {
  operation: string;
  query: string;
  variable: 'keys' | 'ids';
  /** Valeur légitime quand le graphe répond mais ne connaît pas la clé. */
  empty(): V;
  extract(data: unknown): Map<string, V>;
}

/** Succès (données exploitables, éventuellement nulles) ou échec distinct. */
type GraphOutcome<T> = { ok: true; data: T | null } | { ok: false; reason: string };

const graphCache = new Map<string, CacheEntry>();
let graphFailures: string[] = [];

/** Transport réel : le graphe au nom de l'utilisateur courant (§15). */
const userTransport: GraphTransport = {
  requestTeamworkGraph: (query, variables, operationName) =>
    asUser().requestTeamworkGraph(query, variables, operationName),
};

let graphTransport: GraphTransport = userTransport;
let graphNow: () => number = () => Date.now();

/** Remplace le transport (tests, injection) ; `null` restaure `asUser()`. */
export function setGraphTransport(transport: GraphTransport | null): void {
  graphTransport = transport ?? userTransport;
}

/** Remplace l'horloge du cache (tests) ; `null` restaure `Date.now()`. */
export function setGraphClock(now: (() => number) | null): void {
  graphNow = now ?? (() => Date.now());
}

/** Vide le cache et les échecs : à chaque invocation Forge, et entre tests. */
export function resetGraphCache(): void {
  graphCache.clear();
  graphFailures = [];
}

/** Échecs récents (diagnostic, tests) et vide la liste : borne à 50 entrées. */
export function takeGraphFailures(): string[] {
  const taken = graphFailures;
  graphFailures = [];
  return taken;
}

const ZONE_LINKS_READ: GraphRead<string[]> = {
  operation: 'zoneLinks',
  query: ZONE_LINKS_QUERY,
  variable: 'keys',
  empty: () => [],
  extract: (data) => {
    const typed = data as { jiraWorkItems?: Connection<ZoneLinkNode> } | null;
    return indexNodes(typed?.jiraWorkItems, (node) => node.key, (node) => namesOf(node.compassComponents));
  },
};

const TEAM_READ: GraphRead<string> = {
  operation: 'teamByComponent',
  query: TEAM_BY_COMPONENT_QUERY,
  variable: 'ids',
  empty: () => '',
  extract: (data) => {
    const typed = data as { compassComponents?: Connection<ComponentTeamNode> } | null;
    return indexNodes(typed?.compassComponents, (node) => node.id, (node) => teamName(node));
  },
};

const SERVICES_READ: GraphRead<string[]> = {
  operation: 'incidentServices',
  query: INCIDENT_SERVICES_QUERY,
  variable: 'keys',
  empty: () => [],
  extract: (data) => {
    const typed = data as { jiraWorkItems?: Connection<IncidentNode> } | null;
    return indexNodes(typed?.jiraWorkItems, (node) => node.key, (node) => namesOf(node.affectedServices));
  },
};

/**
 * Zones Compass de chaque ticket. Les clés inconnues du graphe (ou sans scope)
 * sont rendues avec une liste vide : `zonesForIssue` retombera sur les
 * composants Jira, puis sur « non classé ». En cas d'échec du graphe, rien
 * n'est mis en cache et la réponse reste vide (jamais d'erreur à l'écran).
 */
export async function fetchZoneLinks(issueKeys: string[], userKey = SHARED_USER_KEY): Promise<ZoneLinks> {
  return fetchCached(ZONE_LINKS_READ, issueKeys, userKey);
}

/**
 * Équipe propriétaire de chaque composant Compass (nom lisible).
 * Une valeur vide signifie « équipe inconnue » : l'appelant retombe alors sur
 * `settings.teamByZone`, sans jamais deviner une équipe (§15).
 */
export async function fetchTeamByComponent(
  componentIds: string[],
  userKey = SHARED_USER_KEY,
): Promise<TeamByComponent> {
  return fetchCached(TEAM_READ, componentIds, userKey);
}

/** Services affectés de chaque incident JSM (famille C1). */
export async function fetchIncidentServices(
  issueKeys: string[],
  userKey = SHARED_USER_KEY,
): Promise<ServicesByIssue> {
  return fetchCached(SERVICES_READ, issueKeys, userKey);
}

/**
 * Lecture générique avec cache par utilisateur et TTL (item C43) :
 * seules les clés absentes ou expirées sont requêtées ; un échec n'écrit
 * aucune entrée — il est distingué du « vide » légitime du graphe.
 */
async function fetchCached<V>(read: GraphRead<V>, wantedRaw: string[], userKey: string): Promise<Map<string, V>> {
  const wanted = uniqueKeys(wantedRaw);
  const now = graphNow();
  const missing = wanted.filter((key) => freshValue<V>(read, userKey, key, now) === null);
  if (missing.length > 0) await queryMissing(read, missing, userKey, now);
  const result = new Map<string, V>();
  for (const key of wanted) {
    result.set(key, freshValue<V>(read, userKey, key, graphNow()) ?? read.empty());
  }
  return result;
}

/** Requête les clés manquantes ; ne met en cache qu'en cas de succès. */
async function queryMissing<V>(read: GraphRead<V>, missing: string[], userKey: string, now: number): Promise<void> {
  const outcome = await graphQuery<unknown>(read.operation, read.query, { [read.variable]: missing });
  if (!outcome.ok) return; // échec : jamais mis en cache (item C43)
  const found = read.extract(outcome.data);
  const expiresAt = now + GRAPH_TTL_MS;
  for (const key of missing) {
    graphCache.set(cacheKey(read.operation, userKey, key), { value: found.get(key) ?? read.empty(), expiresAt });
  }
}

/** Valeur encore fraîche du cache, `null` si absente ou expirée. */
function freshValue<V>(read: GraphRead<V>, userKey: string, key: string, now: number): V | null {
  const entry = graphCache.get(cacheKey(read.operation, userKey, key));
  if (!entry || entry.expiresAt <= now) return null;
  return entry.value as V;
}

/** Clé de cache : opération + utilisateur + clé (jamais partagée, item C43). */
function cacheKey(operation: string, userKey: string, key: string): string {
  return `${operation}\u0000${userKey}\u0000${key}`;
}

/**
 * Exécute une requête du graphe au nom de l'utilisateur. Rend un échec
 * explicite sur erreur HTTP (429…), erreur GraphQL ou exception : le cache
 * distingue ainsi « le graphe ne connaît pas » de « le graphe a refusé ».
 */
async function graphQuery<T>(
  operation: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphOutcome<T>> {
  try {
    const response = await graphTransport.requestTeamworkGraph(query, variables, operation);
    if (!response.ok) return graphFailure(operation, `HTTP ${response.status}`);
    const payload = (await response.json()) as GraphPayload<T>;
    if (payload.errors && payload.errors.length > 0) {
      return graphFailure(operation, payload.errors[0]?.message ?? 'erreur GraphQL');
    }
    return { ok: true, data: payload.data ?? null };
  } catch (error) {
    return graphFailure(operation, shortError(error));
  }
}

/** Journalise un échec court (jamais de contenu) et le rend exploitable. */
function graphFailure(operation: string, reason: string): { ok: false; reason: string } {
  logShort(`graph ${operation}: ${reason}`);
  graphFailures.push(`${operation}: ${reason}`);
  if (graphFailures.length > 50) graphFailures = graphFailures.slice(-50);
  return { ok: false, reason };
}

/** Indexe les nœuds d'une connexion : clé → valeur, sans les entrées nulles. */
function indexNodes<T, V>(
  connection: Connection<T> | null | undefined,
  keyOf: (node: T) => string | undefined,
  valueOf: (node: T) => V | null,
): Map<string, V> {
  const found = new Map<string, V>();
  for (const node of nodesOf(connection)) {
    const key = keyOf(node);
    const value = valueOf(node);
    if (key && value !== null) found.set(key, value);
  }
  return found;
}

/** Nœuds d'une connexion GraphQL, sans les entrées nulles. */
function nodesOf<T>(connection: Connection<T> | null | undefined): T[] {
  const nodes = connection?.nodes ?? [];
  return nodes.filter((node): node is T => node !== null && node !== undefined);
}

/** Noms non vides d'une connexion `{ nodes { name } }`. */
function namesOf(connection: Connection<{ name?: string }> | null | undefined): string[] {
  const names = nodesOf(connection).map((node) => (node.name ?? '').trim()).filter((name) => name.length > 0);
  return Array.from(new Set(names));
}

/** Nom d'équipe non vide d'un composant ; `null` si inconnue. */
function teamName(node: ComponentTeamNode): string | null {
  const team = node.team?.name?.trim();
  return team && team.length > 0 ? team : null;
}

/** Clés uniques, sans les chaînes vides. */
function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter((key) => key.trim().length > 0)));
}
