/**
 * Garde de débit des appels au modèle (§17 : 100 requêtes par minute).
 *
 * Le calcul nocturne note des couples (preuve, dette). Sans garde, une nuit
 * nombreuse sature le quota Forge LLM et les derniers scores ne sont jamais
 * obtenus. La garde attend le temps nécessaire : elle ne perd rien, elle
 * espace.
 *
 * TODO(integration) : le lot B expose le garde-fou dans `src/platform/llm.ts`
 * (`llmThrottle`, partagé par le calcul, le redação et l'agent) ; tant qu'il
 * n'existe pas, ce module en est le point d'appel, avec la même règle.
 */

/** Un garde d'appel : à invoquer avant chaque requête au modèle. */
export interface CallGuard {
  /** Attend, s'il le faut, que le quota de la minute soit disponible. */
  beforeCall(): Promise<void>;
}

/** Options du garde : horloge et sommeil injectés (tests sans attente). */
export interface GuardOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Appels par minute autorisés : 90, sous la limite de 100 (§17). */
export const LLM_CALLS_PER_MINUTE = 90;

/** Longueur de la fenêtre de debit, en millisecondes. */
const WINDOW_MS = 60_000;

/** Garde-fou : une attente qui ne fait pas avancer l'horloge ne boucle pas. */
const MAX_WAITS = 64;

/**
 * Crée un garde de débit : au plus `maxPerMinute` appels par minute glissante.
 *
 * L'algorithme est une fenêtre glissante : quand elle est pleine, on attend
 * que le plus ancien appel sorte de la fenêtre.
 */
export function createCallGuard(maxPerMinute: number, options: GuardOptions = {}): CallGuard {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const limit = Math.max(1, Math.floor(maxPerMinute));
  const calls: number[] = [];
  return {
    async beforeCall(): Promise<void> {
      for (let wait = 0; wait < MAX_WAITS; wait += 1) {
        const at = now();
        while (calls.length > 0 && at - (calls[0] as number) >= WINDOW_MS) calls.shift();
        if (calls.length < limit) {
          calls.push(at);
          return;
        }
        const oldest = calls[0] as number;
        await sleep(Math.max(1, WINDOW_MS - (at - oldest) + 1));
      }
    },
  };
}
