import { route } from '@forge/api';
import type { Route } from '@forge/api';
import type { Request } from '@forge/resolver';
import type { Evidence, ProjectSettings } from '../core/types';
import { listEvidence } from '../platform/db/index';
import { jiraSendJson } from '../platform/jira';
import type { SendResult } from '../platform/jira';
import { draftDebtTicket as draftWithModel } from '../platform/llm';
import type { Draft } from '../platform/llm';
import { projectIdByKey, requireSettings } from '../jobs/projects';
import type { Failure } from '../jobs/support';
import { guard, optionalString, payloadOf, requireString, textLocaleOf } from '../jobs/support';

/**
 * DT-08 : préparer le ticket d'une dette fantôme.
 *
 * Le brouillon est rédigé à partir des preuves déjà enregistrées (aucun calcul),
 * puis le ticket est créé dans le projet. Rien n'est inventé : si le modèle
 * n'est pas disponible, `platform/llm.ts` retombe sur un gabarit.
 */

/** Ticket créé : sa clé et son adresse. */
export interface DraftedTicket {
  key: string;
  url: string;
}

/**
 * Champs de zone posés sur le ticket créé : ils le rattachent à sa zone (§8).
 * Sans eux, le ticket reste hors zone et ne capte aucune preuve (§7.2).
 */
export interface ZoneFields {
  labels: string[];
  components: Array<{ name: string }>;
}

/** Envoi Jira injectable : les tests remplacent le transport (aucun réseau). */
export type SendJson = <T>(
  method: string,
  url: Route,
  payload: unknown,
  what: string,
) => Promise<SendResult<T>>;

/** Transport par défaut : l'adaptateur Jira de `platform/jira`. */
const defaultSend: SendJson = async <T>(method: string, url: Route, payload: unknown, what: string) =>
  jiraSendJson<T>(method, url, payload, what);

let sendJson: SendJson = defaultSend;

/** Remplace l'envoi Jira (tests) ; `null` rend le transport par défaut. */
export function setDraftSend(send: SendJson | null): void {
  sendJson = send ?? defaultSend;
}

/**
 * Brouillon d'un ticket de dette, **sans création** (§7.2).
 *
 * C'est la moitié lecture du parcours : le tech lead relit et corrige avant de
 * créer. `draftDebtTicket` et `previewDebtTicket` passent par la même fonction
 * — une seule implémentation par logique (§18).
 */
export async function previewDebtTicket(request: Request<unknown>): Promise<Draft | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const prepared = await buildDraft(
      requireString(payload, 'projectKey'),
      requireString(payload, 'zone'),
      textLocaleOf(payload),
    );
    return prepared.draft;
  });
}

/** Rédige puis crée le ticket d'une zone coûteuse sans dette. */
export async function draftDebtTicket(request: Request<unknown>): Promise<DraftedTicket | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const projectKey = requireString(payload, 'projectKey');
    const prepared = await buildDraft(projectKey, requireString(payload, 'zone'), textLocaleOf(payload));
    return createIssue(
      projectKey,
      prepared.draft.title,
      prepared.draft.description,
      prepared.zoneFields,
      optionalString(payload, 'siteUrl'),
    );
  });
}

/** Brouillon et champs de zone : la création porte la zone dès le départ (§8). */
interface PreparedDraft {
  draft: Draft;
  zoneFields: ZoneFields;
}

/** Rédaction du brouillon : projet, réglages, preuves de la zone, puis modèle. */
async function buildDraft(projectKey: string, zone: string, locale: 'fr' | 'en'): Promise<PreparedDraft> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » inconnu : ouvrir l'écran Réglages`);
  const settings = await requireSettings(projectId);
  const evidence = await evidenceOfZone(projectId, zone);
  if (evidence.length === 0) {
    throw new Error(`aucune preuve sur la zone « ${zone} » : vérifier la zone, ou attendre le calcul nocturne`);
  }
  const draft = await draftWithModel(zone, evidence, settings, locale);
  return { draft, zoneFields: zoneFieldsOf(settings, zone) };
}

/**
 * Champs de zone du ticket créé, selon le mode du projet (§8) : une étiquette
 * `zone:` en mode étiquette, un composant dans les autres modes. Le même
 * ticket, la même zone : une seule implémentation de la règle (§18).
 */
export function zoneFieldsOf(settings: ProjectSettings, zone: string): ZoneFields {
  if (settings.zoneMode === 'label') {
    const prefix = settings.zoneLabelField ? `${settings.zoneLabelField}:` : 'zone:';
    return { labels: [`${prefix}${zone}`], components: [] };
  }
  return { labels: [], components: [{ name: zone }] };
}

/** Preuves d'une zone, les plus coûteuses d'abord (le brouillon s'appuie dessus). */
async function evidenceOfZone(projectId: string, zone: string): Promise<Evidence[]> {
  const all = await listEvidence(projectId);
  return all.filter((item) => item.zone === zone).sort((a, b) => b.costJp - a.costJp);
}

/** Crée le ticket et rend sa clé ; `siteUrl` sert seulement au lien affiché. */
async function createIssue(
  projectKey: string,
  summary: string,
  description: string,
  zoneFields: ZoneFields,
  siteUrl: string | undefined,
): Promise<DraftedTicket> {
  const sent = await sendJson<{ id?: string; key?: string }>(
    'POST',
    route`/rest/api/3/issue`,
    {
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Task' },
        summary,
        description: toAdf(description),
        labels: zoneFields.labels,
        components: zoneFields.components,
      },
    },
    'draftDebtTicket',
  );
  const key = sent.ok ? sent.data?.key : undefined;
  if (!key) throw new Error('création du ticket refusée par Jira');
  // TODO(integration) : `siteUrl` vient du contexte d'installation ; tant qu'il
  // n'est pas exposé, le lien est relatif et le navigateur le résout seul.
  return { key, url: `${siteUrl ?? ''}/browse/${key}` };
}

/** Texte brut → document Atlassian (un paragraphe par ligne non vide). */
function toAdf(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: block }],
    }));
  return { type: 'doc', version: 1, content: paragraphs.length > 0 ? paragraphs : [emptyParagraph()] };
}

/** Paragraphe vide : un document ADF ne peut pas avoir de corps vide. */
function emptyParagraph(): Record<string, unknown> {
  return { type: 'paragraph', content: [] };
}
