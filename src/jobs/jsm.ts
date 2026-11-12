import type { IssueFact, ProjectSettings } from '../core/types';
import type { JiraIssueJson } from '../platform/jira-types';
import { searchIssues } from '../platform/jira';
import { factsOf } from './issueSync';

/**
 * Incidents des projets JSM du projet (A9, réglage `jsmProjectKeys`).
 *
 * Les incidents vivent souvent dans un projet JSM dédié (`PAYSUP`), pas dans le
 * projet qui porte la dette : sans eux, la famille C1 ne voit rien et
 * l'addition du héros du §7.1 (quatre incidents, 11 j-p) tombe à zéro. On les
 * relit donc chez Jira chaque nuit, dans la fenêtre du projet.
 *
 * Ils ne sont **pas** enregistrés dans `issue_fact` : ce ne sont pas des
 * tickets du projet. Ils entrent dans le calcul comme faits supplémentaires
 * (`RecomputeInput.extraFacts`), donc ils produisent des preuves sans servir de
 * référence C3 ni de mesure de qualité. Leur transcription passe par le même
 * chemin que l'initialisation (`factsOf`) : intervenants, post-mortem et
 * services affectés sont lus une fois pour toutes.
 */

/** Nombre maximal d'incidents JSM lus par nuit (borne les appels REST). */
export const MAX_JSM_INCIDENTS = 300;

/** Pages lues par nuit : l'API rend 100 tickets au plus par page. */
export const MAX_JSM_PAGES = 4;

/** Champs lus pour un incident JSM : ceux de la transcription des faits. */
export const JSM_FIELDS: readonly string[] = [
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
  'issuelinks',
];

/**
 * JQL des incidents des projets JSM du projet, sur sa fenêtre d'analyse.
 * Chaîne vide quand aucun projet JSM n'est réglé : rien à lire.
 */
export function jsmJql(settings: ProjectSettings): string {
  const keys = settings.jsmProjectKeys.map((key) => key.trim()).filter((key) => key.length > 0);
  if (keys.length === 0) return '';
  const list = keys.map((key) => `"${key}"`).join(', ');
  return (
    `project in (${list}) AND issuetype ~ "incident" ` +
    `AND created >= -${settings.windowDays}d ORDER BY created ASC`
  );
}

/** Lit les incidents JSM du projet et les transcrit en faits (A9). */
export async function jsmIncidentFacts(settings: ProjectSettings): Promise<IssueFact[]> {
  const jql = jsmJql(settings);
  if (jql.length === 0) return [];
  const issues = await searchAll(jql);
  return jsmFacts(issues, settings);
}

/** Pages d'une recherche, bornées : jamais de boucle infinie. */
async function searchAll(jql: string): Promise<JiraIssueJson[]> {
  const issues: JiraIssueJson[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_JSM_PAGES; page += 1) {
    const found = await searchIssues(jql, JSM_FIELDS, MAX_JSM_INCIDENTS, token);
    if (!found) break;
    issues.push(...found.issues);
    if (!found.nextPageToken) break;
    token = found.nextPageToken;
  }
  return issues.slice(0, MAX_JSM_INCIDENTS);
}

/**
 * Transcription pure : incidents JSM → faits du calcul.
 *
 * Les zones viennent du mode du **projet analysé** (§8) : un incident JSM porte
 * ses composants, ses services ou ses étiquettes, et c'est la règle du projet
 * qui décide laquelle de ces sources fait la zone. Un incident d'un autre
 * projet n'est jamais un ticket de dette du projet analysé.
 */
export async function jsmFacts(
  issues: readonly JiraIssueJson[],
  settings: ProjectSettings,
): Promise<IssueFact[]> {
  const { facts } = await factsOf(issues, settings);
  return facts.map((fact) => ({ ...fact, isDebt: false }));
}
