/**
 * Enveloppe d'échec des resolvers.
 *
 * `src/jobs/support.ts` convertit toute erreur en `{ ok: false, error }` :
 * c'est ce que reçoit l'UI. Sans cette détection, un projet non configuré
 * rend un objet d'échec là où l'écran attend une donnée, et le rendu casse
 * en page blanche (item D45). Module pur : aucune dépendance `@forge/*`,
 * donc testable hors navigateur.
 */

/** Enveloppe rendue par un resolver quand le traitement a échoué. */
export interface FailureEnvelope {
  ok: false;
  error: string;
}

/** Vrai quand la réponse est une enveloppe d'échec, pas une donnée. */
export function isFailureEnvelope(response: unknown): response is FailureEnvelope {
  if (typeof response !== 'object' || response === null) return false;
  const envelope = response as { ok?: unknown; error?: unknown };
  return envelope.ok === false && typeof envelope.error === 'string';
}

/**
 * Déballe la réponse d'un resolver : `invoke` peut rendre le corps nu ou
 * l'envelopper dans `{ body }`. Une enveloppe d'échec est rejetée avec le
 * message du serveur, pour que `ErrorState` l'affiche au lieu de planter.
 */
export function unwrap<T>(response: T | { body: T }): T {
  if (isFailureEnvelope(response)) throw new Error(response.error);
  if (typeof response === 'object' && response !== null && 'body' in response) {
    return (response as { body: T }).body;
  }
  return response as T;
}
