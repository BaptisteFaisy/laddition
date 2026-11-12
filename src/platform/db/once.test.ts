/**
 * Tests de `oncePerExecutor` : le mémo des créations de table.
 *
 * Le défaut corrigé était silencieux et coûteux à diagnostiquer : un mémo posé
 * au niveau du module survivait au double SQL installé par le test suivant, qui
 * échouait alors sur « table inconnue » alors que son propre amorçage était
 * correct. Ces trois tests fixent le contrat : une seule exécution par
 * exécuteur, une nouvelle exécution après changement d'exécuteur, et un échec
 * qui n'est jamais mis en cache.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oncePerExecutor } from './once';
import { getSqlExecutor, setSqlExecutor } from './query';

describe('oncePerExecutor', () => {
  it('ne joue la tâche qu’une fois pour un même exécuteur', async () => {
    let calls = 0;
    const ensure = oncePerExecutor(async () => {
      calls += 1;
    });
    await ensure();
    await ensure();
    await ensure();
    assert.equal(calls, 1);
  });

  it('rejoue la tâche quand l’exécuteur change', async () => {
    let calls = 0;
    const ensure = oncePerExecutor(async () => {
      calls += 1;
    });
    await ensure();
    const previous = setSqlExecutor(getSqlExecutor());
    try {
      await ensure();
      assert.equal(calls, 2, 'un nouvel exécuteur invalide le mémo');
    } finally {
      setSqlExecutor(previous);
    }
  });

  it('n’enregistre pas un échec : l’appel suivant réessaie', async () => {
    let attempt = 0;
    const ensure = oncePerExecutor(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('DDL refusé');
    });
    await assert.rejects(() => ensure(), /DDL refusé/);
    await ensure();
    assert.equal(attempt, 2);
  });
});
