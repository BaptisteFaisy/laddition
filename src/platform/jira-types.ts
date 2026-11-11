/**
 * Formes JSON de l'API REST Jira — partielles et volontairement tolérantes :
 * seuls les champs réellement lus sont décrits, tout le reste reste accessible
 * par l'index de `JiraFields` (champs personnalisés).
 *
 * Aucun comportement ici : uniquement des types, importés par `jira.ts`.
 */

export interface JiraNamed {
  id?: string;
  name?: string;
  key?: string;
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
  from?: string | null;
  fromString?: string | null;
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

/** Une page de `GET /rest/api/3/issue/{key}/changelog`. */
export interface ChangelogPage {
  histories?: JiraHistory[];
  total?: number;
  isLast?: boolean;
}

/** Une page de `GET /rest/api/3/issue/{key}/comment`. */
export interface CommentPage {
  comments?: Array<{ author?: { accountId?: string } }>;
  total?: number;
}

/** Réponse de `POST /rest/api/3/search/jql`. */
export interface SearchResponse {
  issues?: JiraIssueJson[];
  nextPageToken?: string | null;
  isLast?: boolean;
}
