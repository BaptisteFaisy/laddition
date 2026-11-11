import type { SmokeReport } from './smoke';
import { smokeTest } from './smoke';

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
  const projectKey = pickProjectKey(request);
  const report: SmokeReport = await smokeTest(projectKey);
  return {
    statusCode: report.ok ? 200 : 500,
    headers: { 'Content-Type': ['application/json; charset=utf-8'] },
    body: JSON.stringify(report, null, 2),
  };
}

/** Première valeur du paramètre `project`, ou le défaut. */
function pickProjectKey(request: WebTriggerRequest): string {
  const query = request.queryParameters ?? {};
  const candidates = query['project'] ?? query['projectKey'] ?? [];
  const first = Array.isArray(candidates) ? candidates[0] : candidates;
  if (typeof first === 'string' && first.trim().length > 0) return first.trim().toUpperCase();
  return DEFAULT_PROJECT_KEY;
}
