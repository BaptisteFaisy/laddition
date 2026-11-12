/**
 * Enveloppe commune des actions Rovo / MCP (§13).
 *
 * Une action ne jette **jamais** : elle rend `{ ok: true, data }` ou
 * `{ ok: false, error }`. Un agent qui appelle un outil doit pouvoir expliquer
 * l'échec à l'utilisateur au lieu de voir sa conversation se rompre.
 *
 * Trois règles de validation (items E72, E73, D45) :
 * - un paramètre absent ou illisible donne un message **actionnable** ;
 * - une valeur bornée ou remplacée est **échoyée** dans la réponse : l'appelant
 *   voit ce qui a été appliqué, jamais un plafonnement silencieux ;
 * - un type approximatif n'est jamais deviné (`"true"` n'est pas `true`).
 */

/** Charge utile d'une action : ce que le modèle ou l'agent de code envoie. */
export type JsonPayload = Record<string, unknown>;

/** Résultat d'une action : la donnée, ou un motif lisible d'échec. */
export type ActionEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Signature commune, celle qu'enregistre `src/mcp/index.ts`. */
export type Action = (payload: JsonPayload) => Promise<ActionEnvelope<unknown>>;

/** Exécute le corps d'une action et convertit toute erreur en enveloppe. */
export async function run<T>(body: () => Promise<T>): Promise<ActionEnvelope<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Texte d'une erreur, quel que soit son emballage (jamais un `[object Object]`). */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error ?? 'erreur inconnue');
}

/**
 * Paramètre texte obligatoire. Absent ou vide, l'action rend une erreur
 * explicite : mieux vaut dire « projectKey est requis » qu'inventer un projet.
 */
export function requireText(payload: JsonPayload, key: string): string {
  const value = payload[key];
  if (value === undefined || value === null) {
    throw new Error(`paramètre « ${key} » requis (texte non vide)`);
  }
  if (typeof value !== 'string') {
    throw new Error(`paramètre « ${key} » : un texte est attendu, reçu ${describeType(value)}`);
  }
  if (value.trim().length === 0) {
    throw new Error(`paramètre « ${key} » requis (texte non vide)`);
  }
  return value.trim();
}

/**
 * Paramètre texte facultatif, `null` quand il est absent ou vide.
 *
 * Une valeur présente mais du mauvais type est **refusée**, pas ignorée : un
 * `projectKey` numérique silently ignoré ferait basculer l'action sur un autre
 * projet sans que l'appelant le sache (même famille de défaut que l'item E72).
 */
export function optionalText(payload: JsonPayload, key: string): string | null {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`paramètre « ${key} » : un texte est attendu, reçu ${describeType(value)}`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Paramètre booléen strict (item E73).
 *
 * Une chaîne « true » est **refusée avec un message qui dit quoi envoyer** :
 * sinon l'agent retente la même forme et boucle sur un échec illisible.
 */
export function requireBoolean(payload: JsonPayload, key: string): boolean {
  const value = payload[key];
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) {
    throw new Error(`paramètre « ${key} » requis : un booléen, true ou false`);
  }
  if (typeof value === 'string') {
    throw new Error(
      `paramètre « ${key} » : un booléen est attendu (true ou false), pas la chaîne « ${value} » — ` +
        'renvoyer la valeur sans guillemets',
    );
  }
  throw new Error(
    `paramètre « ${key} » : un booléen est attendu (true ou false), reçu ${describeType(value)}`,
  );
}

/**
 * Valeur numérique réellement appliquée, avec l'écho de la demande (item E72).
 *
 * `note` est une phrase lisible : elle est rendue telle quelle à l'appelant,
 * pour qu'un plafonnement ou un rejet ne passe jamais inaperçu.
 */
export interface AppliedNumber {
  /** Valeur appliquée par l'action. */
  applied: number;
  /** Valeur demandée, `null` si elle était absente ou illisible. */
  requested: number | null;
  /** Vrai quand la demande n'a pas été appliquée telle quelle. */
  adjusted: boolean;
  /** Phrase lisible : ce qui a été fait de la demande. */
  note: string;
}

/**
 * Paramètre numérique facultatif, borné, **avec écho** (item E72).
 *
 * Deux défauts corrigés ici :
 * - un booléen n'est plus converti (`true` valait 1) : il est ignoré, et la
 *   note le dit ;
 * - un dépassement du plafond n'est plus tronqué en silence : la note donne la
 *   valeur demandée et la valeur appliquée.
 *
 * Une valeur illisible ne fait pas échouer une lecture : le repli s'applique,
 * et la note explique pourquoi.
 */
export function optionalNumber(
  payload: JsonPayload,
  key: string,
  fallback: number,
  max: number,
): AppliedNumber {
  const value = payload[key];
  if (value === undefined || value === null) {
    return { applied: fallback, requested: null, adjusted: false, note: `« ${key} » absent : ${fallback} appliqué` };
  }
  if (typeof value === 'boolean') {
    return {
      applied: fallback,
      requested: null,
      adjusted: true,
      note: `« ${key} » booléen (${String(value)}) ignoré : un nombre est attendu, ${fallback} appliqué`,
    };
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return {
      applied: fallback,
      requested: null,
      adjusted: true,
      note: `« ${key} » illisible (${String(value)}) ignoré : ${fallback} appliqué`,
    };
  }
  if (parsed <= 0) {
    return {
      applied: fallback,
      requested: parsed,
      adjusted: true,
      note: `« ${key} » ${parsed} hors bornes (1 à ${max}) : ${fallback} appliqué`,
    };
  }
  const applied = Math.min(Math.floor(parsed), max);
  if (applied < parsed) {
    return {
      applied,
      requested: parsed,
      adjusted: true,
      note: `« ${key} » ${parsed} plafonné à ${applied} (maximum ${max})`,
    };
  }
  return { applied, requested: parsed, adjusted: false, note: `« ${key} » ${applied} appliqué` };
}

/** Nom de type lisible, pour un message d'erreur qui dit quoi envoyer. */
function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'un tableau';
  if (typeof value === 'number') return `un nombre (${String(value)})`;
  if (typeof value === 'boolean') return `un booléen (${String(value)})`;
  if (typeof value === 'object') return 'un objet';
  return typeof value;
}
