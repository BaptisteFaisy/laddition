import type { IssueFact, ProjectSettings } from '../core/types';
import { getIssueFact, getIssueFactByKey, getSettings } from '../platform/db/index';
import type { JiraIssueJson } from '../platform/jira';
import { fetchIssue } from '../platform/jira';
import { logShort } from '../platform/log';
import type { InvalidationKind } from './invalidation';
import { dropInvalidTarget, markInvalid } from './invalidation';
import { deleteIssue } from './issueRemoval';
import { storeIssue } from './issueSync';
import { ensureReady } from './schema';
import { childRecord, eventBody, messageOf, nowIso, uniqueStrings } from './support';
import { disappearedZones } from './zoneLifecycle';

/**
 * Triggers Jira (§15) : au fil de l'eau, jamais de calcul lourd.
 *
 * Une modification de ticket met à jour ses durées par statut et marque sa zone
 * « à recalculer ». Un lien créé ou supprimé invalide les attributions des deux
 * tickets. Le reste — preuves, additions, classement — attend la nuit.
 *
 * Trois événements s'ajoutent (B21, B22, B23) :
 * - `worklogChanged` : le temps saisi change, donc C1 et C2 changent (§9) ;
 * - `issueCommented` : un intervenant de plus change C1 (durée × intervenants) ;
 * - `issueDeleted` : un ticket supprimé doit sortir de la base, sinon il reste
 *   classé et proposé à l'écran.
 *
 * Un ticket déplacé vers un projet sans réglages n'échoue pas en silence : le
 * bilan dit lequel, et le journal aussi (B23).
 */

/** Bilan d'un trigger ; jamais d'exception, un trigger qui jette est rejoué. */
export interface TriggerResult {
  ok: boolean;
  issueId?: string;
  error?: string;
}

/** Tout ce qu'un trigger touche, injectable : les tests n'appellent pas Forge. */
export interface TriggerPorts {
  ensureReady(): Promise<void>;
  fetchIssue(reference: string): Promise<JiraIssueJson | null>;
  storeIssue(issueJson: JiraIssueJson, settings: ProjectSettings): Promise<IssueFact>;
  getIssueFact(issueId: string): Promise<IssueFact | null>;
  settingsOf(projectId: string): Promise<ProjectSettings | null>;
  markInvalid(projectId: string, kind: InvalidationKind, targets: string[], at: string): Promise<void>;
  dropInvalidTarget(projectId: string, target: string): Promise<void>;
  deleteIssue(issueId: string): Promise<void>;
  log(message: string): void;
}

/** Le câblage réel : la base, Jira, et le journal. */
export const defaultPorts: TriggerPorts = {
  ensureReady: () => ensureReady(),
  fetchIssue: (reference) => fetchIssue(reference),
  storeIssue: (issueJson, settings) => storeIssue(issueJson, settings),
  getIssueFact: (reference) => issueFactByAny(reference),
  settingsOf: (projectId) => getSettings(projectId),
  markInvalid: (projectId, kind, targets, at) => markInvalid(projectId, kind, targets, at),
  dropInvalidTarget: (projectId, target) => dropInvalidTarget(projectId, target),
  deleteIssue: (issueId) => deleteIssue(issueId),
  log: (message) => logShort(message),
};

/** Fait lu par identifiant interne ou par clé Jira : les événements donnent l'un ou l'autre. */
async function issueFactByAny(reference: string): Promise<IssueFact | null> {
  return (await getIssueFact(reference)) ?? (await getIssueFactByKey(reference));
}

/** `avi:jira:created:issue` — un ticket naît : on enregistre ses faits. */
export function issueCreated(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return syncFromEvent(event, ports);
}

/** `avi:jira:updated:issue` — un ticket change : durées et zones à jour. */
export function issueUpdated(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return syncFromEvent(event, ports);
}

/** `avi:jira:updated:worklog` — le temps saisi change : C1 et C2 changent (B21). */
export function worklogChanged(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return syncFromEvent(event, ports);
}

/** `avi:jira:created:comment` — un intervenant de plus : C1 change (B22). */
export function issueCommented(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return syncFromEvent(event, ports);
}

/** `avi:jira:deleted:issue` — le ticket sort de la base (B23). */
export function issueDeleted(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return deleteFromEvent(event, ports);
}

/** `avi:jira:created:issuelink` — un rapprochement possible apparaît. */
export function linkCreated(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return invalidateLink(event, ports);
}

/** `avi:jira:deleted:issuelink` — un rapprochement possible disparaît. */
export function linkDeleted(event: unknown, ports: TriggerPorts = defaultPorts): Promise<TriggerResult> {
  return invalidateLink(event, ports);
}

/** Relit un ticket chez Jira et réenregistre ses faits et ses durées. */
async function syncFromEvent(event: unknown, ports: TriggerPorts): Promise<TriggerResult> {
  const reference = issueRefOf(event);
  if (!reference) return { ok: false, error: 'événement sans ticket' };
  try {
    await ports.ensureReady();
    const issueJson = await ports.fetchIssue(reference);
    if (!issueJson) return { ok: false, error: `ticket ${reference} illisible` };
    const projectId = issueJson.fields?.project?.id ?? '';
    if (!projectId) return { ok: false, error: 'ticket sans projet' };
    const settings = await ports.settingsOf(projectId);
    if (!settings) return withoutSettings(projectId, ports);
    const previous = await ports.getIssueFact(issueJson.id);
    const fact = await ports.storeIssue(issueJson, settings);
    await markZones(projectId, previous, fact, ports);
    return { ok: true, issueId: fact.issueId };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/**
 * Un projet sans réglages : échec explicite, journalisé (B23).
 *
 * C'est le cas d'un ticket déplacé vers un projet que l'app ne connaît pas :
 * ses zones seraient devinées, donc fausses. On ne marque rien, on dit quoi.
 */
function withoutSettings(projectId: string, ports: TriggerPorts): TriggerResult {
  const message = `projet ${projectId} sans réglages : ouvrir l'écran Réglages`;
  ports.log(message);
  return { ok: false, error: message };
}

/** Marque les zones du ticket, et celles qu'il ne porte plus (B24). */
async function markZones(
  projectId: string,
  previous: IssueFact | null,
  fact: IssueFact,
  ports: TriggerPorts,
): Promise<void> {
  const at = nowIso();
  await ports.markInvalid(projectId, 'zone', fact.zones, at);
  const gone = disappearedZones(previous, fact);
  if (gone.length > 0) await ports.markInvalid(projectId, 'zone', gone, at);
  if (previous && previous.projectId !== projectId) {
    // Ticket déplacé : l'ancien projet perd un ticket, ses zones bougent aussi.
    await ports.markInvalid(previous.projectId, 'zone', previous.zones, at);
  }
}

/** Efface un ticket supprimé : faits, séjours, preuves, parts, addition (B23). */
async function deleteFromEvent(event: unknown, ports: TriggerPorts): Promise<TriggerResult> {
  const reference = issueIdOf(event) ?? issueRefOf(event);
  if (!reference) return { ok: false, error: 'événement sans ticket' };
  try {
    await ports.ensureReady();
    const known = await ports.getIssueFact(reference);
    const issueId = known?.issueId ?? reference;
    await ports.deleteIssue(issueId);
    if (known) {
      await ports.dropInvalidTarget(known.projectId, issueId);
      await ports.markInvalid(known.projectId, 'zone', known.zones, nowIso());
    }
    return { ok: true, issueId };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Marque les attributions des deux tickets d'un lien comme à refaire. */
async function invalidateLink(event: unknown, ports: TriggerPorts): Promise<TriggerResult> {
  const ids = linkEndsOf(event);
  if (ids.length === 0) return { ok: false, error: 'événement sans lien' };
  try {
    await ports.ensureReady();
    const facts = await Promise.all(ids.map((issueId) => ports.getIssueFact(issueId)));
    const projectIds = uniqueStrings(facts.map((fact) => fact?.projectId));
    const zones = uniqueStrings(facts.flatMap((fact) => fact?.zones ?? []));
    const at = nowIso();
    for (const projectId of projectIds) {
      await ports.markInvalid(projectId, 'attribution', ids, at);
      await ports.markInvalid(projectId, 'zone', zones, at);
    }
    return projectIds.length > 0 ? { ok: true } : { ok: false, error: 'tickets du lien encore inconnus' };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Clé ou identifiant du ticket porté par l'événement. */
function issueRefOf(event: unknown): string | null {
  const issue = childRecord(eventBody(event), 'issue');
  const key = issue.key;
  if (typeof key === 'string' && key.length > 0) return key;
  return issueIdOf(event);
}

/** Identifiant interne du ticket, quand l'événement le porte (suppression). */
function issueIdOf(event: unknown): string | null {
  const id = childRecord(eventBody(event), 'issue').id;
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
