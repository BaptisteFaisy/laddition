/**
 * Tests du garde des webtriggers d'exploitation (items G85, G86, G87).
 *
 * Le point critique est le nom de la variable : Forge expose une variable d'app
 * `LADDITION_OPS_TOKEN` sous le nom `FORGE_USER_VAR_LADDITION_OPS_TOKEN`. Un
 * garde qui ne lit que le nom nu refuse tout sur le site installé — échec
 * fermé, donc invisible, mais l'outillage est mort. Ces tests fixent les deux
 * noms, l'échec fermé, et la validation de la clé de projet avant tout JQL.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { WebTriggerRequest } from './smokeTrigger';
import { FORGE_VAR_PREFIX, OPS_TOKEN_VAR, OpsAuthError, requireOpsToken, safeProjectKey } from './opsAuth';

const FORGE_NAME = `${FORGE_VAR_PREFIX}${OPS_TOKEN_VAR}`;
const TOKEN = 'jeton-de-test';

/** Requête de webtrigger minimale, jeton en en-tête ou en paramètre. */
function requestWith(token: string | null, viaHeader = true): WebTriggerRequest {
  if (token === null) return { queryParameters: {}, headers: {} };
  return viaHeader
    ? { headers: { 'x-ops-token': [token] } }
    : { queryParameters: { token: [token] } };
}

describe('requireOpsToken — échec fermé, et les deux noms de variable', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved[FORGE_NAME] = process.env[FORGE_NAME];
    saved[OPS_TOKEN_VAR] = process.env[OPS_TOKEN_VAR];
    delete process.env[FORGE_NAME];
    delete process.env[OPS_TOKEN_VAR];
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('variable absente : tout est refusé, y compris une requête sans jeton', () => {
    assert.throws(() => requireOpsToken(requestWith(null)), OpsAuthError);
    assert.throws(() => requireOpsToken(requestWith(TOKEN)), OpsAuthError);
  });

  it('variable posée par Forge (préfixée) : le bon jeton passe, un autre est refusé', () => {
    process.env[FORGE_NAME] = TOKEN;
    requireOpsToken(requestWith(TOKEN));
    requireOpsToken(requestWith(TOKEN, false));
    assert.throws(() => requireOpsToken(requestWith('autre')), OpsAuthError);
    assert.throws(() => requireOpsToken(requestWith(null)), OpsAuthError);
  });

  it('variable nue (local, tests) : acceptée, et le préfixé gagne s’il est non vide', () => {
    process.env[OPS_TOKEN_VAR] = TOKEN;
    requireOpsToken(requestWith(TOKEN));
    process.env[FORGE_NAME] = '  ';
    requireOpsToken(requestWith(TOKEN));
    process.env[FORGE_NAME] = 'jeton-du-site';
    assert.throws(() => requireOpsToken(requestWith(TOKEN)), OpsAuthError);
    requireOpsToken(requestWith('jeton-du-site'));
  });

  it('un jeton entouré d’espaces reste utilisable, jamais partiel', () => {
    process.env[FORGE_NAME] = `  ${TOKEN}  `;
    requireOpsToken(requestWith(TOKEN));
    assert.throws(() => requireOpsToken(requestWith(TOKEN.slice(0, 6))), OpsAuthError);
  });
});

describe('safeProjectKey — la seule porte vers un JQL', () => {
  it('accepte une clé normale et retombe sur la valeur par défaut', () => {
    assert.equal(safeProjectKey('pay', 'DEMO'), 'PAY');
    assert.equal(safeProjectKey(null, 'DEMO'), 'DEMO');
    assert.equal(safeProjectKey('  ', 'DEMO'), 'DEMO');
    assert.equal(safeProjectKey('PAY_2', 'DEMO'), 'PAY_2');
  });

  it('refuse une tentative d’injection JQL', () => {
    for (const raw of ["PAY' OR 1=1 --", 'PAY) ', 'PAY,PROJECT=SECRET', 'X'.repeat(12), 'pay-1']) {
      assert.throws(() => safeProjectKey(raw, 'DEMO'), OpsAuthError, raw);
    }
  });

  it('borne du motif : onze caractères passent, douze non', () => {
    assert.equal(safeProjectKey('X'.repeat(11), 'DEMO'), 'X'.repeat(11));
    assert.throws(() => safeProjectKey('X'.repeat(12), 'DEMO'), OpsAuthError);
  });

  it('une clé par défaut invalide échoue aussi : jamais de JQL non validé', () => {
    assert.throws(() => safeProjectKey(null, 'mauvaise clé'), OpsAuthError);
  });
});
