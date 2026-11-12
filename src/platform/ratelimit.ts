/**
 * Limiteur de débit à fenêtre glissante, partagé par la couche plateforme.
 *
 * `src/platform/llm.ts` s'en sert pour borner les appels au modèle (§17 :
 * 100 requêtes/min, 500 000 jetons/min) et le nombre de requêtes par
 * invocation (C31). Aucune dépendance externe ; l'horloge et le sommeil sont
 * injectables pour tester sans attendre ni appeler le réseau.
 */

/** Plafonds du §17 : 100 requêtes/min, 500 000 jetons/min par modèle. */
export const LLM_LIMITS = {
  requestsPerMinute: 100,
  tokensPerMinute: 500_000,
  /** Plafond de requêtes par invocation (borne le budget d'une nuit, C31). */
  requestsPerInvocation: 80,
} as const;

/** Verdict d'une demande de quota : autorisée, ou motif du refus. */
export interface RateLimitVerdict {
  allowed: boolean;
  reason: string | null;
}

/** Options du limiteur : horloge et sommeil injectées (tests sans attente). */
export interface RateLimiterOptions {
  maxRequestsPerMinute?: number;
  maxTokensPerMinute?: number;
  maxRequestsPerInvocation?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Limiteur borné à fenêtre glissante. */
export interface RateLimiter {
  /** Réserve (ou refuse) `tokens` jetons ; ne jette jamais. */
  tryAcquire(tokens?: number): RateLimitVerdict;
  /** Attend (borné) qu'une requête soit admissible, sans la consommer. */
  beforeCall(): Promise<void>;
}

const WINDOW_MS = 60_000;
const MAX_WAITS = 64;

/** Construit un limiteur isolé (tests) ou remplace celui de l'invocation. */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const maxRequests = options.maxRequestsPerMinute ?? LLM_LIMITS.requestsPerMinute;
  const maxTokens = options.maxTokensPerMinute ?? LLM_LIMITS.tokensPerMinute;
  const maxInvocation = options.maxRequestsPerInvocation ?? LLM_LIMITS.requestsPerInvocation;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const hits: Array<{ at: number; tokens: number }> = [];
  let invocationCount = 0;

  function prune(): void {
    const floor = now() - WINDOW_MS;
    while (hits.length > 0 && (hits[0]?.at ?? 0) <= floor) hits.shift();
  }

  function tokenUsage(): number {
    return hits.reduce((sum, hit) => sum + hit.tokens, 0);
  }

  function acquire(tokens: number): RateLimitVerdict {
    prune();
    if (invocationCount >= maxInvocation) return { allowed: false, reason: `plafond d'invocation (${maxInvocation})` };
    if (hits.length >= maxRequests) return { allowed: false, reason: `${maxRequests} requêtes/min` };
    if (tokenUsage() + tokens > maxTokens) return { allowed: false, reason: `${maxTokens} jetons/min` };
    hits.push({ at: now(), tokens });
    invocationCount += 1;
    return { allowed: true, reason: null };
  }

  return {
    tryAcquire: (tokens = 0) => acquire(Math.max(0, tokens)),
    async beforeCall(): Promise<void> {
      for (let wait = 0; wait < MAX_WAITS; wait += 1) {
        prune();
        if (invocationCount < maxInvocation && hits.length < maxRequests) return;
        const oldest = hits[0]?.at ?? now();
        await sleep(Math.max(1, WINDOW_MS - (now() - oldest) + 1));
      }
    },
  };
}

/** Budget de l'invocation ; `resetLlmBudget` le recrée (tests, rejeu). */
let budget: RateLimiter = createRateLimiter();

/** Garde de débit partagé (§17) : attendre une place, ne jamais jeter. */
export const llmThrottle: { beforeCall(): Promise<void> } = { beforeCall: () => budget.beforeCall() };

/** Recrée le budget (par invocation, ou en test avec options). */
export function resetLlmBudget(options: RateLimiterOptions = {}): void {
  budget = createRateLimiter(options);
}

/** Réserve (ou refuse) des jetons sur le budget LLM de l'invocation. */
export function acquireLlmBudget(tokens: number): RateLimitVerdict {
  return budget.tryAcquire(tokens);
}