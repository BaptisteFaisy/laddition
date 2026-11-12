/**
 * D'un ticket Jira à ses faits en base : lecture, zones, durées par statut.
 *
 * Partagé par le trigger (au fil de l'eau) et par le consommateur
 * (initialisation par lots) : une seule façon d'enregistrer un ticket, donc
 * aucun risque que les deux chemins divergent. Écrire deux fois le même ticket
 * ne duplique rien (`upsert` sur `issue_fact`, remplacement sur `status_span`).
 *
 * Ce que le lot ajoute :
 * - les intervenants réels (assignés + auteurs de commentaires) et le
 *   post-mortem lié, qui nourrissent la famille C1 (§9) ;
 * - les liens lus **en lot** par une seule recherche JQL (C28) ;
 * - la règle de dette `jql`, exécutée une fois par lot (DT-01) ;
 * - le marqueur de troncature de l'historique (C41 → `historyTruncated`).
 *
 * Visibilité (§18) : le calcul nocturne tourne au nom de l'app, tout ticket y
 * est visible. C'est le lecteur qui masque : un écran appelle
 * `visibleKeysForUser` (adaptateur Jira) puis passe le résultat à
 * `storeIssues`, ou applique `withVisibility` aux faits relus. Un ticket que
 * le lecteur ne peut pas ouvrir reste compté, mais `visible: false` — c'est ce
 * qui rend `hiddenCount` vrai dans l'addition.
 */
import type { IssueFact, IssueLink, ProjectSettings, StatusSpan } from '../core/types';
import { sizeClassOf } from '../core/baseline';
import { attachIssueId, reconstructStatusSpans } from '../core/duration';
import { zonesForIssue } from '../core/zones';
import { replaceStatusSpans, upsertIssueFacts } from '../platform/db/index';
import type { JiraIssueJson } from '../platform/jira-types';
import {
  debtJqlKeys,
  fetchComments,
  fetchCommentsAsApp,
  fetchHistory,
  fetchLinkedIssueTypes,
  fetchLinksBatch,
  serviceFieldIds,
  toIssueFact,
} from '../platform/jira';
import {
  isIncidentIssue,
  isPostMortemTypeName,
  linksOfIssue,
  postMortemFromLinks,
  projectJql,
  withVisibility,
} from '../platform/jira-types';
import { logShort } from '../platform/log';

/** Résultat de la synchronisation d'un lot de tickets. */
export interface SyncResult {
  facts: IssueFact[];
  links: IssueLink[];
  /**
   * Séjours de statut calculés, dans l'ordre des faits. Renseigné par
   * `factsOf`, qui calcule sans écrire : le calcul nocturne s'en sert pour les
   * incidents d'autres projets (A9), qui ne sont pas enregistrés.
   */
  histories?: Array<{ issueId: string; spans: StatusSpan[] }>;
}

/** Ce que le lot lit une seule fois, pour tous ses tickets. */
interface BatchContext {
  serviceFieldIds: string[];
  debtKeys: Set<string>;
  linksByKey: Map<string, IssueLink[]>;
}

/** Complète le fait lu chez Jira : zones du §8 et classe de taille (C3). */
export function withComputedFields(fact: IssueFact, settings: ProjectSettings): IssueFact {
  return { ...fact, zones: zonesForIssue(fact, settings), size: sizeClassOf(fact, settings) };
}

/**
 * Enregistre un lot de tickets : liens lus en une fois (C28), règle de dette
 * JQL jouée une fois (DT-01), historique lu par ticket avec son marqueur de
 * troncature (C41).
 *
 * `visibleKeys` est optionnel : absent (calcul nocturne, au nom de l'app),
 * tout reste visible ; fourni par un lecteur, les tickets qu'il ne peut pas
 * ouvrir sont comptés mais masqués (§18).
 */
export async function storeIssues(
  issues: JiraIssueJson[],
  settings: ProjectSettings,
  visibleKeys?: ReadonlySet<string>,
): Promise<SyncResult> {
  const computed = await factsOf(issues, settings);
  const stored = visibleKeys ? withVisibility(computed.facts, visibleKeys) : computed.facts;
  await upsertIssueFacts(stored);
  for (const entry of computed.histories ?? []) await replaceStatusSpans(entry.issueId, entry.spans);
  return { facts: stored, links: computed.links };
}

/**
 * Calcule les faits d'un lot **sans rien écrire** (A9).
 *
 * Même chemin que `storeIssues` — une seule façon de transcrire un ticket —
 * pour les faits qui ne doivent pas entrer en base : les incidents des projets
 * JSM du projet, qui alimentent C1 sans devenir des tickets du projet.
 */
export async function factsOf(
  issues: readonly JiraIssueJson[],
  settings: ProjectSettings,
): Promise<SyncResult> {
  if (issues.length === 0) return { facts: [], links: [], histories: [] };
  const context = await batchContext([...issues], settings);
  const facts: IssueFact[] = [];
  const links: IssueLink[] = [];
  const histories: Array<{ issueId: string; spans: StatusSpan[] }> = [];
  for (const issue of issues) {
    const marked = markDebtJqlMatch(issue, context.debtKeys);
    const issueLinks = linksOf(marked, context);
    links.push(...issueLinks);
    const fact = await factOf(marked, settings, context, issueLinks);
    const history = await historyOf(fact);
    facts.push(withComputedFields({ ...fact, historyTruncated: history.truncated }, settings));
    histories.push({ issueId: fact.issueId, spans: history.spans });
  }
  return { facts, links, histories };
}

/**
 * Enregistre un ticket et son historique. Rend le fait tel qu'il a été écrit,
 * pour que l'appelant connaisse ses zones sans relire la base.
 */
export async function storeIssue(issueJson: JiraIssueJson, settings: ProjectSettings): Promise<IssueFact> {
  const result = await storeIssues([issueJson], settings);
  const fact = result.facts[0];
  if (!fact) throw new Error(`ticket ${issueJson.key} non enregistré`);
  return fact;
}

/** Marque un ticket retenu par la règle JQL du projet (DT-01). */
export function markDebtJqlMatch(issue: JiraIssueJson, keys: ReadonlySet<string>): JiraIssueJson {
  if (issue.debtJqlMatch === true || !keys.has(issue.key)) return issue;
  return { ...issue, debtJqlMatch: true };
}

/** Durées par statut d'un ticket, reconstituées depuis son historique (DT-03). */
export async function spansOf(fact: IssueFact): Promise<StatusSpan[]> {
  return (await historyOf(fact)).spans;
}

/** Historique d'un ticket : séjours par statut et marqueur de troncature (C41). */
export async function historyOf(fact: IssueFact): Promise<{ spans: StatusSpan[]; truncated: boolean }> {
  const read = await fetchHistory(fact.issueId);
  const entries = read?.entries ?? [];
  const spans = attachIssueId(reconstructStatusSpans(entries, fact.createdAt, fact.resolvedAt), fact.issueId);
  return { spans, truncated: read?.truncated === true };
}

// ---------------------------------------------------------------------------
// Détails internes
// ---------------------------------------------------------------------------

/** Lit une seule fois ce que tout le lot partage : champs, règle, liens. */
async function batchContext(issues: JiraIssueJson[], settings: ProjectSettings): Promise<BatchContext> {
  const missing = issues
    .filter((issue) => (issue.fields?.issuelinks ?? []).length === 0)
    .map((issue) => issue.key);
  return {
    serviceFieldIds: await serviceFieldIds(),
    debtKeys: await debtKeysOf(settings),
    linksByKey: missing.length > 0 ? await fetchLinksBatch(missing) : new Map<string, IssueLink[]>(),
  };
}

/** Clés retenues par la règle JQL du projet ; ensemble vide pour toute autre règle. */
async function debtKeysOf(settings: ProjectSettings): Promise<Set<string>> {
  const rule = settings.debtRule;
  if (rule.kind !== 'jql' || rule.value.trim().length === 0) return new Set<string>();
  const jql = projectJql(settings.projectKey, rule.value);
  if (!jql) {
    logShort('règle de dette JQL : clé de projet invalide, règle ignorée');
    return new Set<string>();
  }
  return debtJqlKeys(jql);
}

/** Liens d'un ticket : ceux de sa charge utile, sinon la lecture en lot. */
function linksOf(issue: JiraIssueJson, context: BatchContext): IssueLink[] {
  const embedded = linksOfIssue(issue);
  return embedded.length > 0 ? embedded : context.linksByKey.get(issue.key) ?? [];
}

/** Fait d'un ticket, complété de ce que le JSON seul ne dit pas (C1). */
async function factOf(
  issue: JiraIssueJson,
  settings: ProjectSettings,
  context: BatchContext,
  links: readonly IssueLink[],
): Promise<IssueFact> {
  const fields = issue.fields ?? {};
  const incident = isIncidentIssue(fields);
  const commentAuthors = incident ? await commentAuthorsOf(issue.key) : [];
  const postMortem = incident ? postMortemFromLinks(links) || (await linkedPostMortem(issue.key)) : false;
  return toIssueFact(issue, settings, {
    serviceFieldIds: context.serviceFieldIds,
    links,
    commentAuthors,
    postMortem,
  });
}

/** Auteurs des commentaires : ceux du lecteur s'il y en a un, sinon ceux de l'app. */
async function commentAuthorsOf(issueKey: string): Promise<string[]> {
  const asReader = await fetchComments(issueKey);
  if (asReader) return asReader;
  return (await fetchCommentsAsApp(issueKey)) ?? [];
}

/** Post-mortem repéré par le type des tickets liés (« [System] Post-incident review »). */
async function linkedPostMortem(issueKey: string): Promise<boolean> {
  const types = await fetchLinkedIssueTypes(issueKey);
  return types.some((name) => isPostMortemTypeName(name));
}
