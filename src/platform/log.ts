/**
 * Journalisation courte, partagée par tous les adaptateurs.
 *
 * Les logs Forge sont tronqués et lisibles par les administrateurs du site :
 * on n'y met jamais un titre de ticket, un commentaire, un nom de personne ni
 * un extrait de texte du modèle. Seulement l'opération, le code HTTP et le
 * type d'erreur (§18, vie privée).
 */

const PREFIX = '[laddition]';

/** Journalise un message court ; ne jette jamais. */
export function logShort(message: string): void {
  try {
    console.warn(`${PREFIX} ${message}`);
  } catch {
    // Un log qui échoue ne doit pas casser l'appel en cours.
  }
}

/** Réduit une erreur à `Nom: message`, tronqué à 120 caractères. */
export function shortError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}
