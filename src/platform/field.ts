/**
 * Champ « Coût de la dette (j-p / 90 j) » — DT-11 et DT-19.
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
import { clamp } from '../core/time';
import { jiraGetJson, jiraSendJson, searchIssues } from './jira';
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

interface JiraField {
  id?: string;
  name?: string;
  custom?: boolean;
  schema?: { type?: string };
}

/**
 * Trouve le champ « coût de la dette » du site, ou le crée (DT-11).
 * `projectKey` sert à la description du champ et au diagnostic : le champ est
 * global au site, un seul suffit pour tous les projets.
 */
export async function ensureDebtCostField(projectKey: string): Promise<FieldSetup> {
  const fields = await jiraGetJson<JiraField[]>(route`/rest/api/3/field`, 'listFields');
  if (!fields) return { ok: false, fieldId: null, reason: 'liste des champs illisible' };
  const existing = findField(fields, DEBT_COST_FIELD_NAME);
  if (existing?.id) return { ok: true, fieldId: existing.id, reason: null };
  return createField(projectKey);
}

/** Crée le champ ; un 403 (app non administrateur) est un échec explicite. */
async function createField(projectKey: string): Promise<FieldSetup> {
  const sent = await jiraSendJson<{ id?: string }>(
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
 * faites par paquets de 50, avec `notifyUsers=false` (personne ne reçoit de
 * mail pour un chiffre recalculé).
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
  for (const key of batch) {
    const target = values.get(key);
    if (target === undefined || !Number.isFinite(target)) {
      outcome.skipped.push(key);
      continue;
    }
    if (current.get(key) === target) {
      outcome.skipped.push(key);
      continue;
    }
    const written = await putValue(key, fieldId, target);
    if (written) outcome.updated.push(key);
    else {
      outcome.ok = false;
      outcome.failed.push({ key, reason: 'écriture refusée (403 ou champ verrouillé)' });
    }
  }
}

/** Valeurs courantes du champ pour un lot, en un seul appel de recherche. */
async function currentValues(batch: string[], fieldId: string): Promise<Map<string, number> | null> {
  const jql = `key in (${batch.map(quoteKey).join(', ')})`;
  const page = await searchIssues(jql, [fieldId], batch.length);
  if (!page) return null;
  const values = new Map<string, number>();
  for (const issue of page.issues) {
    const raw = issue.fields[fieldId];
    if (typeof raw === 'number') values.set(issue.key, raw);
  }
  return values;
}

/** Écrit une valeur ; rend `true` quand Jira a accepté (204 compris). */
async function putValue(key: string, fieldId: string, value: number): Promise<boolean> {
  const sent = await jiraSendJson<unknown>(
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
