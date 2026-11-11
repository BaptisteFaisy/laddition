import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Résout les imports relatifs sans extension (`./x` -> `./x.ts` ou `./x/index.ts`)
 * pour que `node --test --experimental-strip-types` exécute exactement le même
 * code que celui que compile `forge build`.
 */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return nextResolve(specifier, context);
    }
    if (path.extname(specifier)) return nextResolve(specifier, context);
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const suffix of CANDIDATES) {
      const candidate = path.resolve(parent, specifier + suffix);
      if (fs.existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
