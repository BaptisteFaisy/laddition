/**
 * Enveloppe commune des actions Rovo / MCP (§13).
 *
 * Une action ne jette **jamais** : elle rend `{ ok: true, data }` ou
 * `{ ok: false, error }`. Un agent qui appelle un outil doit pouvoir expliquer
 * l'échec à l'utilisateur au lieu de voir sa conversation se rompre.
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

/** Texte d'une erreur, quel que soit son emballage. */
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
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`paramètre « ${key} » requis`);
  }
  return value.trim();
}

/** Paramètre texte facultatif, `null` quand il est absent ou vide. */
export function optionalText(payload: JsonPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Paramètre booléen strict : une chaîne « true » est refusée, pas devinée. */
export function requireBoolean(payload: JsonPayload, key: string): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') throw new Error(`paramètre « ${key} » requis (booléen)`);
  return value;
}

/**
 * Paramètre numérique facultatif, borné. Une valeur illisible est ignorée
 * plutôt que de faire échouer une lecture : la borne de repli s'applique.
 */
export function optionalNumber(payload: JsonPayload, key: string, fallback: number, max: number): number {
  const value = payload[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}
