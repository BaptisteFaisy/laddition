/**
 * Teamwork Graph — enrichissement des zones et des services (§15).
 *
 * Toutes ces lectures passent par `asUser()` : le graphe ne rend que ce que
 * l'utilisateur a le droit de voir, et un scope manquant rend une liste vide
 * sans erreur (on ne devine jamais un rattachement).
 *
 * Cache : une `Map` de module par lecture, remise à zéro à chaque invocation
 * Forge (§15). Un même ticket n'est donc interrogé qu'une fois par écran.
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

const zoneLinksCache: ZoneLinks = new Map();
const teamByComponentCache: TeamByComponent = new Map();
const incidentServicesCache: ServicesByIssue = new Map();

/**
 * Zones Compass de chaque ticket. Les clés absentes du graphe (ou sans scope)
 * sont rendues avec une liste vide : `zonesForIssue` retombera sur les
 * composants Jira, puis sur « non classé ».
 */
export async function fetchZoneLinks(issueKeys: string[]): Promise<ZoneLinks> {
  const wanted = uniqueKeys(issueKeys);
  const missing = wanted.filter((key) => !zoneLinksCache.has(key));
  if (missing.length > 0) {
    const data = await graphQuery<{ jiraWorkItems?: Connection<ZoneLinkNode> }>(
      'zoneLinks',
      ZONE_LINKS_QUERY,
      { keys: missing },
    );
    for (const key of missing) zoneLinksCache.set(key, []);
    for (const node of nodesOf(data?.jiraWorkItems)) {
      const key = node.key;
      if (!key) continue;
      zoneLinksCache.set(key, namesOf(node.compassComponents));
    }
  }
  return pick(wanted, zoneLinksCache, () => []);
}

/**
 * Équipe propriétaire de chaque composant Compass (nom lisible).
 * Une valeur vide signifie « équipe inconnue » : l'appelant retombe alors sur
 * `settings.teamByZone`, sans jamais deviner une équipe (§15).
 */
export async function fetchTeamByComponent(componentIds: string[]): Promise<TeamByComponent> {
  const wanted = uniqueKeys(componentIds);
  const missing = wanted.filter((id) => !teamByComponentCache.has(id));
  if (missing.length > 0) {
    const data = await graphQuery<{ compassComponents?: Connection<ComponentTeamNode> }>(
      'teamByComponent',
      TEAM_BY_COMPONENT_QUERY,
      { ids: missing },
    );
    const found = new Map<string, string>();
    for (const node of nodesOf(data?.compassComponents)) {
      const id = node.id;
      const team = node.team?.name?.trim();
      if (id && team) found.set(id, team);
    }
    for (const id of missing) teamByComponentCache.set(id, found.get(id) ?? '');
  }
  return pick(wanted, teamByComponentCache, () => '');
}

/** Services affectés de chaque incident JSM (famille C1). */
export async function fetchIncidentServices(issueKeys: string[]): Promise<ServicesByIssue> {
  const wanted = uniqueKeys(issueKeys);
  const missing = wanted.filter((key) => !incidentServicesCache.has(key));
  if (missing.length > 0) {
    const data = await graphQuery<{ jiraWorkItems?: Connection<IncidentNode> }>(
      'incidentServices',
      INCIDENT_SERVICES_QUERY,
      { keys: missing },
    );
    for (const key of missing) incidentServicesCache.set(key, []);
    for (const node of nodesOf(data?.jiraWorkItems)) {
      const key = node.key;
      if (!key) continue;
      incidentServicesCache.set(key, namesOf(node.affectedServices));
    }
  }
  return pick(wanted, incidentServicesCache, () => []);
}

/**
 * Exécute une requête du graphe au nom de l'utilisateur.
 * Rend `null` sur erreur HTTP, erreur GraphQL (scope manquant) ou exception :
 * l'appelant rend alors des listes vides, jamais une erreur à l'écran.
 */
async function graphQuery<T>(
  operation: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  try {
    const response = await asUser().requestTeamworkGraph(query, variables, operation);
    if (!response.ok) {
      logShort(`graph ${operation}: HTTP ${response.status}`);
      return null;
    }
    const payload = (await response.json()) as GraphPayload<T>;
    if (payload.errors && payload.errors.length > 0) {
      logShort(`graph ${operation}: ${payload.errors[0]?.message ?? 'erreur GraphQL'}`);
      return null;
    }
    return payload.data ?? null;
  } catch (error) {
    logShort(`graph ${operation}: ${shortError(error)}`);
    return null;
  }
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

/** Clés uniques, sans les chaînes vides. */
function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter((key) => key.trim().length > 0)));
}

/** Rend le résultat complet demandé, en lisant le cache et en complétant à vide. */
function pick<V>(wanted: string[], cache: Map<string, V>, empty: () => V): Map<string, V> {
  const result = new Map<string, V>();
  for (const key of wanted) result.set(key, cache.get(key) ?? empty());
  return result;
}
