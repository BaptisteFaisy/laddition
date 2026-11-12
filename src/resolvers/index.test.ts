/**
 * Le contrat des écrans : chaque clé que l'UI appelle est bien enregistrée.
 *
 * `src/index.tsx` parcourt `RESOLVERS` et fait un `resolver.define(key, …)` par
 * entrée. Une clé absente ici ne casse aucun test de domaine : l'écran tourne en
 * chargement pour toujours, ou tombe en erreur, une fois déployé. C'est
 * exactement ce qui est arrivé à la simulation (DT-21) et à l'argumentaire
 * (DT-17), livrés côté résolveur et invisibles côté écran — d'où cette garde.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RESOLVERS } from './index';
import { SIMULATION_RESOLVER_KEY } from './simulation';

/**
 * Clés enregistrées pour un autre appelant que les écrans. Une clé doit avoir
 * un appelant réel : ici c'est l'outil MCP, vérifié par `src/mcp/manifest.test.ts`.
 */
const SERVED_ELSEWHERE: Readonly<Record<string, string>> = {
  getZoneCosts: 'outil MCP `get-zone-costs` (src/mcp/index.ts)',
};

/** Les clés appelées par `src/ui/api.ts` (union `ResolverKey`). */
const CALLED_BY_UI: readonly string[] = [
  'getProjectPage',
  'getDebtBill',
  'getDebtCase',
  'listPhantomDebt',
  'listDeadDebt',
  'getRepaymentReport',
  'confirmEvidence',
  'rejectEvidence',
  'getSettings',
  'saveSettings',
  'loadSampleData',
  'clearSampleData',
  'getDataQuality',
  'startBootstrap',
  'bootstrapProgress',
  'draftDebtTicket',
  'previewDebtTicket',
  'listZoneEvidence',
  'listDebtAttributions',
  'getIssueCost',
  'getGadgetData',
  SIMULATION_RESOLVER_KEY,
];

describe('RESOLVERS — le contrat entre les écrans et le serveur', () => {
  it('enregistre une fonction pour chaque clé appelée par l’UI', () => {
    const missing = CALLED_BY_UI.filter((key) => typeof RESOLVERS[key] !== 'function');
    assert.deepEqual(missing, [], `clés appelées par src/ui/api.ts mais absentes de RESOLVERS : ${missing.join(', ')}`);
  });

  it('n’enregistre aucune clé sans appelant (écran ou outil MCP)', () => {
    const extra = Object.keys(RESOLVERS).filter(
      (key) => !CALLED_BY_UI.includes(key) && !(key in SERVED_ELSEWHERE),
    );
    assert.deepEqual(extra, [], `clés enregistrées sans aucun appelant : ${extra.join(', ')}`);
  });

  it('rend la simulation DT-21 atteignable depuis un écran', () => {
    assert.equal(typeof RESOLVERS[SIMULATION_RESOLVER_KEY], 'function');
  });
});
