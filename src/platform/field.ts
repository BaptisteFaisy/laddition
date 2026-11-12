/**
 * Champ « Coût de la dette (j-p / 90 j) » — DT-11 et DT-19,
 * et bulletin de remboursement publié en commentaire (G91).
 *
 * L'app tient un champ numérique par projet, écrit par le job d'initialisation
 * et par le recalcul nocturne. Le champ n'est jamais exposé dans un écran
 * d'édition : la lecture seule est tenue par l'app (aucun formulaire ne
 * l'inclut) et rappelée dans la description du champ, car l'API des champs ne
 * sait pas poser un champ « non modifiable ».
 *
 * Aucune fonction ne jette : tout échec (403, champ verrouillé, écriture
 * refusée) rend `{ ok: false, reason }` et laisse l'app continuer.
 */
import { route } from '@forge/api';
import type { Route } from '@forge/api';
import { createHash } from 'node:crypto';
import { clamp, round2 } from '../core/time';
import { jiraGetJson, jiraSendJson, searchIssues } from './jira';
import type { SearchPage, SendResult } from './jira';
import { logShort } from './log';

/** Nom exact du champ, tel qu'il apparaît dans Jira. */
export const DEBT_COST_FIELD_NAME = 'Coût de la dette (j-p / 90 j)';

/** Type Jira : nombre décimal. */
const FIELD_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:float';

/** Chercheur associé, pour que le champ soit utilisable en JQL. */
const FIELD_SEARCHER = 'com.atlassian.jira.plugin.system.customfieldtypes:numberrange';

/** Écriture en masse : 50 tickets par lot (limite de l'API). */
const WRITE_BATCH = 50;

/** Plafond de la requête « top dettes » (DT-19). */
const MAX_TOP_DEBTS = 50;

/** Écritures en vol (C29) : jamais plus de 5 PUT simultanés. */
const WRITE_CONCURRENCY = 5;

/** Plafond de tentatives par PUT (C29) : on ne martèle jamais un 403. */
const PUT_ATTEMPTS = 2;

/** Marqueur d'idempotence d'un bulletin (G91) : dans le corps du commentaire. */
const COMMENT_MARKER_PREFIX = 'laddition:bulletin:';

const COMMENT_PAGE_SIZE = 100;
const COMMENT_MAX_PAGES = 10;

/** Résultat de la mise en place du champ. */
export interface FieldSetup {
  ok: boolean;
  fieldId: string | null;
  reason: string | null;
}

/** Bilan d'une écriture en masse : rien n'est silencieux. */
export interface WriteOutcome {
  ok: boolean;
  updated: string[];
  skipped: string[];
  failed: Array<{ key: string; reason: string }>;
  reason: string | null;
}

/** Requête « top dettes » : le JQL, et le plafond qui l'accompagne. */
export interface TopDebtsQuery {
  jql: string;
  maxResults: number;
}

/** Bilan d'une publication de bulletin : posté, déjà là, ou refusé. */
export interface CommentOutcome {
  ok: boolean;
  posted: boolean;
  reason: string | null;
}

interface JiraField {
  id?: string;
  name?: string;
  custom?: boolean;
  schema?: { type?: string };
}

interface ReadCommentPage {
  comments?: Array<{ body?: unknown }>;
  total?: number;
  startAt?: number;
}

/** Surface HTTP Jira utilisée par ce module (injectable pour les tests). */
export interface JiraHttp {
  getJson<T>(url: Route, what: string): Promise<T | null>;
  sendJson<T>(method: string, url: Route, payload: unknown, what: string): Promise<SendResult<T>>;
  search(jql: string, fields: readonly string[], maxResults: number, nextPageToken?: string): Promise<SearchPage | null>;
}

const defaultHttp: JiraHttp = { getJson: jiraGetJson, sendJson: jiraSendJson, search: searchIssues };
let http: JiraHttp = defaultHttp;

/** Remplace le transport HTTP (tests) ; `null` restaure les vrais appels. */
export function setJiraHttp(impl: JiraHttp | null): void {
  http = impl ?? defaultHttp;
}

/**
 * Trouve le champ « coût de la dette » du site, ou le crée (DT-11).
 * `projectKey` sert à la description du champ et au diagnostic : le champ est
 * global au site, un seul suffit pour tous les projets.
 */
export async function ensureDebtCostField(projectKey: string): Promise<FieldSetup> {
  const fields = await http.getJson<JiraField[]>(route`/rest/api/3/field`, 'listFields');
  if (!fields) return { ok: false, fieldId: null, reason: 'liste des champs illisible' };
  const existing = findField(fields, DEBT_COST_FIELD_NAME);
  if (existing?.id) return { ok: true, fieldId: existing.id, reason: null };
  return createField(projectKey);
}

/** Crée le champ ; un 403 (app non administrateur) est un échec explicite. */
async function createField(projectKey: string): Promise<FieldSetup> {
  const sent = await http.sendJson<{ id?: string }>(
    'POST',
    route`/rest/api/3/field`,
    {
      name: DEBT_COST_FIELD_NAME,
      description:
        `Coût mesuré de la dette technique, en jours-personne sur 90 jours. ` +
        `Écrit par l’app L’addition (projet ${projectKey}) — lecture seule pour les humains.`,
      type: FIELD_TYPE,
      searcherKey: FIELD_SEARCHER,
    },
    'createDebtCostField',
  );
  const fieldId = sent.data?.id ?? null;
  if (!sent.ok || !fieldId) {
    logShort('ensureDebtCostField: création refusée');
    return {
      ok: false,
      fieldId: null,
      reason: 'création du champ refusée : un administrateur Jira doit créer « ' + DEBT_COST_FIELD_NAME + ' »',
    };
  }
  return { ok: true, fieldId, reason: null };
}

/** Champ existant : nom exact d'abord, puis nom insensible à la casse. */
function findField(fields: JiraField[], name: string): JiraField | null {
  const wanted = name.toLowerCase();
  const exact = fields.find((field) => field.name === name);
  if (exact) return exact;
  return fields.find((field) => (field.name ?? '').toLowerCase() === wanted) ?? null;
}

/**
 * Écrit le coût de la dette sur un lot de tickets (DT-11).
 *
 * Idempotent : la valeur courante est relue avant écriture, et un ticket dont
 * la valeur est déjà la bonne n'est ni réécrit ni notifié. Les écritures sont
 * faites par lots de 50, avec `notifyUsers=false`, et en parallèle par petits
 * paquets bornés (C29) : au plus 5 PUT en vol et un plafond de tentatives.
 *
 * `fieldId` vient de `ensureDebtCostField` : on ne devine jamais l'identifiant
 * d'un champ, et on n'écrit jamais dans un champ qu'on n'a pas résolu.
 */
export async function writeDebtCost(
  issueKeys: string[],
  values: Map<string, number>,
  fieldId: string,
): Promise<WriteOutcome> {
  const outcome: WriteOutcome = { ok: true, updated: [], skipped: [], failed: [], reason: null };
  for (const batch of chunk(uniqueKeys(issueKeys), WRITE_BATCH)) {
    await writeBatch(batch, values, fieldId, outcome);
  }
  if (!outcome.ok) outcome.reason = 'écriture partielle : voir les tickets en échec';
  return outcome;
}

/** Un lot de 50 : relecture des valeurs, puis écriture des seuls écarts. */
async function writeBatch(
  batch: string[],
  values: Map<string, number>,
  fieldId: string,
  outcome: WriteOutcome,
): Promise<void> {
  const current = await currentValues(batch, fieldId);
  if (!current) {
    outcome.ok = false;
    for (const key of batch) outcome.failed.push({ key, reason: 'valeurs actuelles illisibles' });
    return;
  }
  const pending: string[] = [];
  for (const key of batch) {
    const target = values.get(key);
    if (target === undefined || !Number.isFinite(target)) {
      outcome.skipped.push(key);
      continue;
    }
    const now = current.get(key);
    if (now !== undefined && round2(now) === round2(target)) {
      outcome.skipped.push(key);
      continue;
    }
    pending.push(key);
  }
  const written = await writeAll(pending, values, fieldId);
  for (const key of pending) {
    if (written.get(key)) outcome.updated.push(key);
    else {
      outcome.ok = false;
      outcome.failed.push({ key, reason: 'écriture refusée (403 ou champ verrouillé)' });
    }
  }
}

/** Écrit les écarts en parallèle borné (C29), résultat indexé par clé. */
async function writeAll(
  pending: string[],
  values: Map<string, number>,
  fieldId: string,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  await runPool(pending, WRITE_CONCURRENCY, async (key) => {
    results.set(key, await putWithRetry(key, fieldId, values.get(key) ?? 0));
  });
  return results;
}

/** Un PUT, réessayé au plus `PUT_ATTEMPTS` fois, sans jamais jeter. */
async function putWithRetry(key: string, fieldId: string, value: number): Promise<boolean> {
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt += 1) {
    if (await putValue(key, fieldId, value)) return true;
  }
  logShort(`writeDebtCost ${key}: échec après ${PUT_ATTEMPTS} tentatives`);
  return false;
}

/** Exécute une tâche sur une liste avec une concurrence bornée. */
async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index] as T;
      index += 1;
      await task(current);
    }
  });
  await Promise.all(workers);
}

/** Valeurs courantes du champ pour un lot, en un seul appel de recherche. */
async function currentValues(batch: string[], fieldId: string): Promise<Map<string, number> | null> {
  const jql = `key in (${batch.map(quoteKey).join(', ')})`;
  const page = await http.search(jql, [fieldId], batch.length);
  if (!page) return null;
  const values = new Map<string, number>();
  for (const issue of page.issues) {
    const value = fieldValue(issue.fields[fieldId]);
    if (value !== null) values.set(issue.key, value);
  }
  return values;
}

/** Valeur d'un champ « nombre » : nombre, ou chaîne tolérée (C42). */
function fieldValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Écrit une valeur ; rend `true` quand Jira a accepté (204 compris). */
async function putValue(key: string, fieldId: string, value: number): Promise<boolean> {
  const sent = await http.sendJson<unknown>(
    'PUT',
    route`/rest/api/3/issue/${key}?notifyUsers=false`,
    { fields: { [fieldId]: value } },
    `writeDebtCost ${key}`,
  );
  return sent.ok;
}

/**
 * Requête JQL de la fonction « top dettes » (DT-19) : les tickets de dette les
 * plus coûteux d'abord. JQL ne connaît pas de `LIMIT` : le plafond voyage à
 * côté de la requête, c'est l'appelant qui l'applique à la recherche.
 */
export function jqlForTopDebts(fieldId: string, limit: number): TopDebtsQuery {
  const ref = jqlFieldRef(fieldId);
  return {
    jql: `${ref} is not EMPTY AND ${ref} > 0 ORDER BY ${ref} DESC`,
    maxResults: clamp(Math.round(limit), 1, MAX_TOP_DEBTS),
  };
}

// ---------------------------------------------------------------------------
// Bulletin de remboursement (G91)
// ---------------------------------------------------------------------------

/**
 * Publie le bulletin de remboursement d'un ticket en commentaire Jira.
 *
 * Au nom de l'app, au sens « un commentaire de plus, jamais une réécriture » :
 * idempotent par marqueur dans le corps (l'empreinte du texte), donc le même
 * bulletin n'est jamais reposté et aucun commentaire existant n'est écrasé.
 * Le lot D appelle cette fonction pour la brancher ; elle n'est volontairement
 * pas appelée ici.
 */
export async function postRepaymentComment(issueKey: string, texte: string): Promise<CommentOutcome> {
  const key = issueKey.trim();
  const body = texte.trim();
  if (key.length === 0 || body.length === 0) return { ok: false, posted: false, reason: 'ticket ou bulletin vide' };
  const marker = bulletinMarker(body);
  const already = await commentHasMarker(key, marker);
  if (already === null) return { ok: false, posted: false, reason: 'commentaires illisibles' };
  if (already) return { ok: true, posted: false, reason: null };
  const sent = await http.sendJson<{ id?: string }>(
    'POST',
    route`/rest/api/3/issue/${key}/comment`,
    { body: commentAdf(marker, body) },
    `postRepaymentComment ${key}`,
  );
  if (!sent.ok) return { ok: false, posted: false, reason: 'publication du bulletin refusée' };
  return { ok: true, posted: true, reason: null };
}

/** Marqueur d'idempotence : préfixe fixe + empreinte courte du texte. */
function bulletinMarker(body: string): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `<!-- ${COMMENT_MARKER_PREFIX}${hash} -->`;
}

/** Vrai si un commentaire porte déjà le marqueur ; `null` si illisible. */
async function commentHasMarker(key: string, marker: string): Promise<boolean | null> {
  let startAt = 0;
  for (let page = 0; page < COMMENT_MAX_PAGES; page += 1) {
    const data = await http.getJson<ReadCommentPage>(
      route`/rest/api/3/issue/${key}/comment?startAt=${startAt}&maxResults=${COMMENT_PAGE_SIZE}`,
      `readComments ${key}`,
    );
    if (!data) return null;
    const comments = data.comments ?? [];
    if (comments.some((comment) => commentBodyHas(comment, marker))) return true;
    startAt += comments.length;
    if (comments.length === 0) break;
    if (data.total !== undefined && startAt >= data.total) break;
  }
  return false;
}

/** Le marqueur est un texte littéral dans le corps (jamais un HTML commenté). */
function commentBodyHas(comment: { body?: unknown }, marker: string): boolean {
  return JSON.stringify(comment.body ?? '').includes(marker);
}

/** Document ADF : le marqueur puis une ligne par paragraphe non vide. */
function commentAdf(marker: string, body: string): Record<string, unknown> {
  const content = [marker, ...body.split('\n')]
    .filter((line) => line.trim().length > 0)
    .map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
  return { type: 'doc', version: 1, content };
}

/** `customfield_10042` → `cf[10042]` ; tout autre identifiant → nom cité. */
function jqlFieldRef(fieldId: string): string {
  const match = /^customfield_(\d+)$/.exec(fieldId);
  const number = match?.[1];
  if (number) return `cf[${number}]`;
  return `"${fieldId.replace(/"/g, '')}"`;
}

/** Clé de ticket citée dans un JQL. */
function quoteKey(key: string): string {
  return `"${key.replace(/"/g, '')}"`;
}

/** Clés uniques, sans les vides. */
function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter((key) => key.trim().length > 0)));
}

/** Découpe une liste en paquets de taille fixe. */
function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}