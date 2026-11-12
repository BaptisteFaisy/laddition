import type { SmokeReport } from './smoke';
import { smokeTest } from './smoke';
import { OpsAuthError, requireOpsToken, safeProjectKey } from './opsAuth';

/** Requête HTTP reçue par le webtrigger Forge. */
export type WebTriggerRequest = {
  body?: string;
  queryParameters?: Record<string, string[]>;
  headers?: Record<string, string[]>;
  method?: string;
};

/** Réponse HTTP renvoyée par le webtrigger Forge. */
export type WebTriggerResponse = {
  body: string;
  statusCode: number;
  headers?: Record<string, string[]>;
};

const DEFAULT_PROJECT_KEY = 'PAY';

/**
 * Handler du `webtrigger` : exécute le smoke test et rend son rapport en JSON.
 *
 * Utilise la clé reçue en query string (`?project=...`) ou le projet par défaut.
 * Le code HTTP vaut 200 si toutes les étapes passent, 500 si l'une d'elles échoue.
 */
export async function smokeTriggerHandler(
  request: WebTriggerRequest,
): Promise<WebTriggerResponse> {
  try {
    requireOpsToken(request);
    const report: SmokeReport = await smokeTest(pickProjectKey(request));
    return json(report.ok ? 200 : 500, report);
  } catch (error) {
    // Une garde refusée rend 403, pas 500 : ce n'est pas une panne de l'app.
    const status = error instanceof OpsAuthError ? 403 : 500;
    return json(status, { ok: false, error: messageOf(error) });
  }
}

/** Première valeur du paramètre `project`, validée avant tout JQL. */
function pickProjectKey(request: WebTriggerRequest): string {
  const query = request.queryParameters ?? {};
  const candidates = query['project'] ?? query['projectKey'] ?? [];
  const first = Array.isArray(candidates) ? candidates[0] : candidates;
  return safeProjectKey(typeof first === 'string' ? first : null, DEFAULT_PROJECT_KEY);
}

/** Réponse JSON, code HTTP explicite. */
function json(statusCode: number, body: unknown): WebTriggerResponse {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json; charset=utf-8'] },
    body: JSON.stringify(body, null, 2),
  };
}

/** Message d'une erreur, quel que soit son emballage. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
