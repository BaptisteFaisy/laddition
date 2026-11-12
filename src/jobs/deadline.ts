/**
 * Garde de durée : un job long rend la main proprement.
 *
 * Forge laisse 900 s à une fonction asynchrone ou planifiée (§17). Un recalcul
 * qui dépasse ce budget est tué sans que rien ne soit dit : le projet reste
 * « à recalculer » et rien n'est expliqué. La garde donne un point de contrôle
 * entre deux étapes : on s'arrête, on rend la main, et le travail restant est
 * repris au tour suivant (C34).
 *
 * L'horloge est injectée : un test fait avancer le temps sans attendre.
 */

/** Une échéance : le temps restant, et la question « est-ce fini ? ». */
export interface Deadline {
  /** Vrai quand le budget de temps est épuisé. */
  expired(): boolean;
  /** Millisecondes restantes avant l'échéance. */
  remaining(): number;
}

/** Horloge injectable (millisecondes depuis l'origine). */
export type Clock = () => number;

/** Budget par défaut : 600 s, sous la limite de 900 s avec de la marge. */
export const DEFAULT_BUDGET_MS = 600_000;

/** Crée une échéance à `budgetMs` millisecondes depuis l'appel. */
export function createDeadline(budgetMs: number, clock: Clock = Date.now): Deadline {
  const end = clock() + Math.max(0, budgetMs);
  return {
    expired: () => clock() >= end,
    remaining: () => Math.max(0, end - clock()),
  };
}

/** Une garde sans budget : jamais expirée (lots courts, tests). */
export const NO_DEADLINE: Deadline = {
  expired: () => false,
  remaining: () => Number.POSITIVE_INFINITY,
};
