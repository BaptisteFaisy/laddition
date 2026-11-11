import type { IssueFact, ProjectSettings, StatusSpan } from '../core/types';
import { sizeClassOf } from '../core/baseline';
import { attachIssueId, reconstructStatusSpans } from '../core/duration';
import { zonesForIssue } from '../core/zones';
import { upsertIssueFacts, replaceStatusSpans } from '../platform/db/index';
import type { JiraIssueJson } from '../platform/jira';
import { fetchChangelog, toIssueFact } from '../platform/jira';

/**
 * D'un ticket Jira à ses faits en base : lecture, zones, durées par statut.
 *
 * Partagé par le trigger (au fil de l'eau) et par le consommateur
 * (initialisation par lots) : une seule façon d'enregistrer un ticket, donc
 * aucun risque que les deux chemins divergent. Écrire deux fois le même ticket
 * ne duplique rien (`upsert` sur `issue_fact`, remplacement sur `status_span`).
 */

/** Complète le fait lu chez Jira : zones du §8 et classe de taille (C3). */
export function withComputedFields(fact: IssueFact, settings: ProjectSettings): IssueFact {
  return { ...fact, zones: zonesForIssue(fact, settings), size: sizeClassOf(fact, settings) };
}

/** Durées par statut d'un ticket, reconstituées depuis son historique (DT-03). */
export async function spansOf(fact: IssueFact): Promise<StatusSpan[]> {
  const history = (await fetchChangelog(fact.issueId)) ?? [];
  return attachIssueId(reconstructStatusSpans(history, fact.createdAt, fact.resolvedAt), fact.issueId);
}

/**
 * Enregistre un ticket et son historique. Rend le fait tel qu'il a été écrit,
 * pour que l'appelant connaisse ses zones sans relire la base.
 */
export async function storeIssue(
  issueJson: JiraIssueJson,
  settings: ProjectSettings,
): Promise<IssueFact> {
  const fact = withComputedFields(toIssueFact(issueJson, settings), settings);
  await upsertIssueFacts([fact]);
  await replaceStatusSpans(fact.issueId, await spansOf(fact));
  return fact;
}
