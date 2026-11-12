/**
 * Tests des clés de résolveur demandées par les écrans (`ui/api.ts`).
 *
 * Cinq lectures exposées pour les items D39, D40, D55, D57 et le §7.2 :
 * `getIssueCost`, `getGadgetData`, `listZoneEvidence`, `listDebtAttributions`
 * et `previewDebtTicket`. On y vérifie les chiffres rendus, le masquage des
 * preuves hors droits (§18), la somme des parts (recette §20 n° 2) et des
 * erreurs actionnables (item D45).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@forge/resolver';

import type { Attribution } from '../core/types';
import type { Failure } from '../jobs/support';
import { PROJECT_ID, seedPayProject, startFakeDb } from '../mcp/testing/seed';
import type { ZoneEvidenceLine } from './evidence';
import { listDebtAttributions, listZoneEvidence } from './evidence';
import type { GadgetData, IssueCost } from './read';
import { GADGET_TOP_DEBTS, getGadgetData, getIssueCost } from './read';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Résultat attendu en succès ; échoue le test sur une enveloppe d'erreur. */
function ok<T>(result: T | Failure): T {
  if ('ok' in (result as Failure) && (result as Failure).ok === false) {
    assert.fail(`succès attendu, reçu : ${(result as Failure).error}`);
  }
  return result as T;
}

/** Erreur d'un résolveur ; échoue le test s'il a réussi. */
function error(result: unknown | Failure): string {
  const failure = result as Failure;
  assert.equal(failure.ok, false, 'une erreur était attendue');
  return failure.error;
}

describe('listZoneEvidence — preuves d’une zone et leurs parts (D55, D57)', () => {
  it('rend chaque preuve avec les dettes qu’elle alimente', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const lines = ok<ZoneEvidenceLine[]>(await listZoneEvidence(request({ projectId: PROJECT_ID, zone: 'taxes' })));
    assert.equal(lines.length, 4, 'les preuves masquées restent comptées');
    const first = lines[0];
    assert.equal(first?.evidence.sourceKey, 'PAY-101', 'la plus coûteuse d’abord');
    assert.deepEqual(first?.shares, [{ debtIssueId: 'd77', debtKey: 'PAY-77', share: 1 }]);
  });

  it('une preuve partagée montre ses deux parts (recette §20 n° 2)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const lines = ok<ZoneEvidenceLine[]>(
      await listZoneEvidence(request({ projectId: PROJECT_ID, zone: 'notifications' })),
    );
    const shared = lines.find((line) => line.evidence.id === 'ev3');
    assert.equal(shared?.shares.length, 2);
    const total = (shared?.shares ?? []).reduce((sum, item) => sum + item.share, 0);
    assert.equal(Math.round(total * 100) / 100, 1, 'la somme des parts ne dépasse pas 100 %');
    assert.deepEqual(shared?.shares.map((item) => item.debtKey), ['PAY-41', 'PAY-90']);
  });

  it('masque le contenu d’une preuve hors droits (§18)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const lines = ok<ZoneEvidenceLine[]>(await listZoneEvidence(request({ projectId: PROJECT_ID, zone: 'taxes' })));
    const hidden = lines.find((line) => line.evidence.id === 'ev2');
    assert.equal(hidden?.evidence.visible, false);
    assert.equal(hidden?.evidence.sourceKey, '');
    assert.equal(hidden?.evidence.costJp, 3, 'le coût masqué reste compté');
  });

  it('zone ou projet absent : une phrase actionnable', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    assert.match(error(await listZoneEvidence(request({ projectId: PROJECT_ID }))), /« zone » manquant ou vide/);
    assert.match(error(await listZoneEvidence(request({ zone: 'taxes' }))), /« projectKey » manquant ou vide/);
  });
});

describe('listDebtAttributions — parts d’une dette (D57)', () => {
  it('rend les parts triées, avec leur base et leur pertinence', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const rows = ok<Attribution[]>(await listDebtAttributions(request({ debtIssueId: 'd77' })));
    assert.equal(rows.length, 4);
    assert.equal(rows[0]?.share, 1);
    assert.equal(rows[0]?.basis, 'link');
    assert.equal(rows[rows.length - 1]?.share, 0.5);
    assert.equal(rows[rows.length - 1]?.basis, 'inferred');
  });

  it('ticket inconnu : le motif dit quoi faire', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    assert.match(error(await listDebtAttributions(request({ debtIssueId: 'nope' }))), /ticket nope inconnu/);
    assert.match(error(await listDebtAttributions(request({}))), /« debtIssueId » manquant ou vide/);
  });
});

describe('getIssueCost — le champ personnalisé sans l’état du projet (D39)', () => {
  it('rend la fourchette, la fenêtre et le marqueur d’exemple', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const cost = ok<IssueCost>(await getIssueCost(request({ issueId: 'd77' })));
    assert.deepEqual(cost, { lowJp: 6, highJp: 9, days: 90, insufficient: false, demoData: false });
  });

  it('un ticket sans addition rend des zéros, pas une erreur', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const cost = ok<IssueCost>(await getIssueCost(request({ issueId: 'd90' })));
    assert.equal(cost.lowJp, 0);
    assert.equal(cost.highJp, 0);
    assert.equal(cost.days, 90);
  });

  it('ticket inconnu ou absent du payload : une phrase', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    assert.match(error(await getIssueCost(request({ issueId: 'nope' }))), /ticket nope inconnu/);
    assert.match(error(await getIssueCost(request({}))), /« issueId » manquant ou vide/);
  });
});

describe('getGadgetData — les trois lignes du gadget (D40)', () => {
  it('borne le classement et rend les deux replis', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = ok<GadgetData>(await getGadgetData(request({ projectId: PROJECT_ID, projectKey: 'PAY' })));
    assert.equal(data.debts.length <= GADGET_TOP_DEBTS, true);
    assert.equal(data.debts[0]?.key, 'PAY-77');
    assert.equal(data.costByTeam.length > 0, true);
    assert.equal(data.costByQuarter.length > 0, true);
    assert.equal(data.demoData, false);
  });

  it('projet absent : une phrase actionnable', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    assert.match(error(await getGadgetData(request({}))), /« projectKey » manquant ou vide/);
  });
});
