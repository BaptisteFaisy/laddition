import type { Request } from '@forge/resolver';

/**
 * Petits outils partagés par les points d'entrée Forge.
 *
 * Trois règles y sont appliquées une fois pour toutes :
 * - une seule horloge (`nowIso`), jamais `Date.now()` dispersé ;
 * - un resolver rend la donnée attendue par l'UI, ou `{ ok: false, error }` ;
 * - les payloads Forge sont lus avec tolérance, jamais indexés à l'aveugle.
 */

/**
 * Échec d'un resolver. Le succès rend la donnée elle-même (forme décrite par
 * `src/ui/api.ts`), l'échec cette enveloppe : l'écran n'a jamais d'exception.
 */
export interface Failure {
  ok: false;
  error: string;
}

/** Instant courant, ISO 8601 UTC. Seule horloge des points d'entrée. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Message lisible d'une erreur attrapée, sans jamais jeter à son tour. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'erreur inconnue';
}

/**
 * Exécute une action et convertit toute erreur en `{ ok: false, error }`.
 * C'est le seul endroit où une exception est attrapée pour l'UI : les
 * validateurs et les dépôts peuvent jeter, l'écran reçoit toujours un objet.
 */
export async function guard<T>(action: () => Promise<T>): Promise<T | Failure> {
  try {
    return await action();
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Vrai pour un objet simple (ni tableau, ni `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Payload d'un resolver, ramené à un objet : jamais `undefined` à lire. */
export function payloadOf(request: Request<unknown> | undefined): Record<string, unknown> {
  return isRecord(request?.payload) ? request.payload : {};
}

/** Champ texte obligatoire ; jette un message clair si absent (attrapé par `guard`). */
export function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`champ « ${key} » manquant ou vide`);
  }
  return value.trim();
}

/** Champ texte facultatif ; `undefined` s'il est absent ou vide. */
export function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Langue de rédaction demandée par un écran ou une action.
 *
 * L'anglais est le défaut : c'est la langue de l'application et de la
 * soumission. Une valeur absente ou inconnue retombe dessus — un appelant ne
 * choisit jamais une troisième langue.
 */
export function textLocaleOf(payload: Record<string, unknown>): 'fr' | 'en' {
  return optionalString(payload, 'locale') === 'fr' ? 'fr' : 'en';
}

/** Sous-objet d'un objet, ou `{}` : lecture tolérante des payloads Forge. */
export function childRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

/** Corps d'un événement Forge (`consumer`, triggers) : l'événement lui-même à défaut. */
export function eventBody(event: unknown): Record<string, unknown> {
  if (!isRecord(event)) return {};
  const body = event.body;
  return isRecord(body) ? body : event;
}

/** Liste sans doublon ni valeur vide : sert aux zones et aux identifiants. */
export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const kept = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  return [...new Set(kept)];
}
