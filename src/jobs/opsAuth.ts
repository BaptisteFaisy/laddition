import type { WebTriggerRequest } from './smokeTrigger';

/**
 * Garde des webtriggers d'exploitation (items G85, G86, G87 de l'audit).
 *
 * Ces points d'entrée existent pour développer et mesurer sans navigateur :
 * ils peuvent initialiser un projet, lancer un recalcul, injecter ou retirer le
 * jeu d'exemple, et rendre le classement de n'importe quel projet. Sans
 * contrôle, l'URL suffit — donc :
 *
 * 1. **jeton obligatoire**, lu dans une variable d'environnement de l'app
 *    (`forge variables set LADDITION_OPS_TOKEN …`). Variable absente ou vide :
 *    tout est refusé, y compris la lecture (échec fermé, jamais ouvert) ;
 * 2. **clé de projet validée** avant d'entrer dans un JQL : le paramètre arrive
 *    de l'extérieur et était jusqu'ici interpolé tel quel.
 *
 * Avant un dépôt sur le Marketplace, la solution la plus sûre reste de retirer
 * les deux modules `webtrigger` du manifeste : ce garde est un filet, pas une
 * autorisation définitive.
 */

/** Nom de la variable d'app qui porte le jeton (`forge variables:set …`). */
export const OPS_TOKEN_VAR = 'LADDITION_OPS_TOKEN';

/**
 * Préfixe dont Forge fait précéder les variables d'app dans le runtime :
 * `forge variables:set LADDITION_OPS_TOKEN …` arrive sous le nom
 * `FORGE_USER_VAR_LADDITION_OPS_TOKEN`. Sans ce préfixe, le garde ne trouve
 * jamais le jeton posé sur le site et refuse tout — échec fermé, mais
 * outillage d'exploitation mort (constat du 12/11 avant déploiement).
 */
export const FORGE_VAR_PREFIX = 'FORGE_USER_VAR_';

/** Forme d'une clé de projet Jira : majuscules, chiffres, underscore. */
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,10}$/;

/** Erreur de garde : message explicite, sans détail sur le jeton attendu. */
export class OpsAuthError extends Error {}

/**
 * Jeton attendu, lu à l'appel (jamais mis en cache : il peut être tourné).
 *
 * Deux noms sont acceptés : celui posé sur le site par Forge (préfixé) et le
 * nom nu, utile en local et dans les tests. Le préfixé gagne s'il est non vide.
 */
function expectedToken(): string {
  return firstNonEmpty(process.env[`${FORGE_VAR_PREFIX}${OPS_TOKEN_VAR}`], process.env[OPS_TOKEN_VAR]);
}

/** Première valeur non vide, ou chaîne vide. */
function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

/**
 * Vérifie le jeton d'exploitation. Comparaison à durée constante pour ne pas
 * révéler le jeton octet par octet.
 */
export function requireOpsToken(request: WebTriggerRequest): void {
  const expected = expectedToken();
  if (expected.length === 0) {
    throw new OpsAuthError(
      `webtrigger désactivé : la variable ${OPS_TOKEN_VAR} n'est pas définie`,
    );
  }
  const provided = readToken(request);
  if (!safeEquals(provided, expected)) {
    throw new OpsAuthError("jeton d'exploitation absent ou invalide");
  }
}

/** Jeton fourni : en-tête `x-ops-token`, sinon paramètre `token`. */
function readToken(request: WebTriggerRequest): string {
  const headers = request.headers ?? {};
  const header = headers['x-ops-token'] ?? headers['X-Ops-Token'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader;
  const query = request.queryParameters ?? {};
  const param = query['token'];
  const fromQuery = Array.isArray(param) ? param[0] : param;
  return typeof fromQuery === 'string' ? fromQuery : '';
}

/** Comparaison à durée constante ; deux chaînes de longueurs différentes → faux. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Clé de projet validée, ou erreur. Toute interpolation dans un JQL passe par
 * ici : c'est la seule protection contre une injection par le paramètre.
 */
export function safeProjectKey(raw: string | null, fallback: string): string {
  const candidate = (raw ?? '').trim().toUpperCase();
  const value = candidate.length > 0 ? candidate : fallback;
  if (!PROJECT_KEY_PATTERN.test(value)) {
    throw new OpsAuthError(
      `clé de projet invalide : « ${value.slice(0, 40)} » (lettres majuscules, chiffres et underscore, 10 caractères au plus)`,
    );
  }
  return value;
}
