import { registerHooks } from 'node:module';

/**
 * Double des paquets Forge qui exigent le runtime dès l'import.
 *
 * `@forge/llm` instancie son client au chargement du module : hors du runtime
 * Forge (donc dans `node --test`), l'import jette « Forge runtime not found »
 * avant qu'aucun test ne tourne. Les jobs qui scorent des rapprochements
 * l'importent indirectement ; ce double permet de tester leur logique pure.
 *
 * À installer **avant** l'import du module testé :
 * ```ts
 * stubForgeRuntime();
 * const { mergeFacts } = await import('./recalc');
 * ```
 */

/** Source du double : aucune réponse du modèle hors runtime. */
const LLM_STUB = `
export async function chat() {
  throw new Error('modèle indisponible hors runtime Forge');
}
export async function list() {
  return { models: [] };
}
export default { chat, list };
`;

let installed = false;

/** Installe le double, une seule fois par processus de test. */
export function stubForgeRuntime(): void {
  if (installed) return;
  installed = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.includes('node_modules/@forge/llm/')) {
        return { format: 'module', source: LLM_STUB, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
