/**
 * Tout composant de ligne de tableau doit être marqué.
 *
 * Régression du 12/11 : huit tableaux utilisaient un composant de ligne
 * personnalisé que le parseur de `kit.tsx` ne voyait pas — les lignes
 * disparaissaient et les écrans ne montraient que des en-têtes. La parade est
 * `markTableRow`, qui rend le composant résolvable ; cette garde empêche
 * d'en réintroduire un sans le marquer.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const DIR = fileURLToPath(new URL('./components/', import.meta.url));

/** Fichiers d'écran de l'interface. */
function screens(): string[] {
  return readdirSync(DIR).filter((name) => name.endsWith('.tsx'));
}

describe('composants de ligne de tableau', () => {
  it('tout composant utilisé comme ligne est marqué', () => {
    const forgotten: string[] = [];
    for (const name of screens()) {
      const source = readFileSync(DIR + name, 'utf8');
      const used = [...source.matchAll(/<([A-Z][A-Za-z0-9]*Row)\b/g)].map((match) => match[1] ?? '');
      for (const component of new Set(used)) {
        if (component === 'Row') continue;
        if (!source.includes(`markTableRow(${component})`)) {
          forgotten.push(`${name} : ${component} n’est pas marqué (markTableRow)`);
        }
      }
    }
    assert.deepEqual(forgotten, [], 'composant de ligne sans marqueur : ses lignes disparaîtraient');
  });
});
