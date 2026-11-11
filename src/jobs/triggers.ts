import type { ProjectSettings } from '../core/types';
import { getIssueFact, getSettings } from '../platform/db/index';
import { fetchIssue } from '../platform/jira';
import { markInvalid } from './invalidation';
import { storeIssue } from './issueSync';
import { ensureReady } from './schema';
import { childRecord, eventBody, messageOf, nowIso, uniqueStrings } from './support';

/**
 * Triggers Jira (§15) : au fil de l'eau, jamais de calcul lourd.
 *
 * Une modification de ticket met à jour ses durées par statut et marque sa zone
 * « à recalculer ». Un lien créé ou supprimé invalide les attributions des deux
 * tickets. Le reste — preuves, additions, classement — attend la nuit.
 */

/** Bilan d'un trigger ; jamais d'exception, un trigger qui jette est rejoué. */
export interface TriggerResult {
  ok: boolean;
  issueId?: string;
  error?: string;
}

/** `avi:jira:created:issue` — un ticket naît : on enregistre ses faits. */
export function issueCreated(event: unknown): Promise<TriggerResult> {
  return syncFromEvent(event);
}

/** `avi:jira:updated:issue` — un ticket change : durées et zones à jour. */
export function issueUpdated(event: unknown): Promise<TriggerResult> {
  return syncFromEvent(event);
}

/** `avi:jira:created:issuelink` — un rapprochement possible apparaît. */
export function linkCreated(event: unknown): Promise<TriggerResult> {
  return invalidateLink(event);
}

/** `avi:jira:deleted:issuelink` — un rapprochement possible disparaît. */
export function linkDeleted(event: unknown): Promise<TriggerResult> {
  return invalidateLink(event);
}

/** Relit un ticket chez Jira et réenregistre ses faits et ses durées. */
async function syncFromEvent(event: unknown): Promise<TriggerResult> {
  const reference = issueRefOf(event);
  if (!reference) return { ok: false, error: 'événement sans ticket' };
  try {
    await ensureReady();
    const issueJson = await fetchIssue(reference);
    if (!issueJson) return { ok: false, error: `ticket ${reference} illisible` };
    const projectId = issueJson.fields?.project?.id ?? '';
    if (!projectId) return { ok: false, error: 'ticket sans projet' };
    const settings = await settingsOf(projectId);
    const fact = await storeIssue(issueJson, settings);
    await markInvalid(projectId, 'zone', fact.zones, nowIso());
    return { ok: true, issueId: fact.issueId };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Marque les attributions des deux tickets d'un lien comme à refaire. */
async function invalidateLink(event: unknown): Promise<TriggerResult> {
  const ids = linkEndsOf(event);
  if (ids.length === 0) return { ok: false, error: 'événement sans lien' };
  try {
    await ensureReady();
    const facts = await Promise.all(ids.map((issueId) => getIssueFact(issueId)));
    const projectIds = uniqueStrings(facts.map((fact) => fact?.projectId));
    const zones = uniqueStrings(facts.flatMap((fact) => fact?.zones ?? []));
    const at = nowIso();
    for (const projectId of projectIds) {
      await markInvalid(projectId, 'attribution', ids, at);
      await markInvalid(projectId, 'zone', zones, at);
    }
    return projectIds.length > 0 ? { ok: true } : { ok: false, error: 'tickets du lien encore inconnus' };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Réglages du projet, ou erreur explicite : sans eux, aucune zone n'est sûre. */
async function settingsOf(projectId: string): Promise<ProjectSettings> {
  const settings = await getSettings(projectId);
  if (!settings) throw new Error(`projet ${projectId} sans réglages : ouvrir l'écran Réglages`);
  return settings;
}

/** Clé ou identifiant du ticket porté par l'événement. */
function issueRefOf(event: unknown): string | null {
  const issue = childRecord(eventBody(event), 'issue');
  const key = issue.key;
  if (typeof key === 'string' && key.length > 0) return key;
  const id = issue.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Les deux extrémités d'un événement de lien. */
function linkEndsOf(event: unknown): string[] {
  const link = childRecord(eventBody(event), 'issueLink');
  return uniqueStrings([asId(link.sourceIssueId), asId(link.destinationIssueId)]);
}

/** Identifiant exploitable, ou `undefined` : les payloads Forge sont souples. */
function asId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
