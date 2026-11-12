/**
 * Tests du résolveur d'addition (items D57/A4, §18, §20).
 *
 * Deux propriétés vérifiées à la lecture :
 * - les **parts d'attribution** sont exposées, avec le total toutes dettes
 *   confondues — c'est ce qui rend la recette §20 n° 2 vérifiable à l'écran
 *   (« la somme des parts ne dépasse pas 100 % ») ;
 * - `hiddenCount` est **réel** et les preuves hors droits sont masquées : leur
 *   contenu (clé source, formule) ne sort pas du serveur.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@forge/resolver';

import type { Failure } from '../jobs/support';
import { MASKED_FORMULA } from '../mcp/masking';
import { startFakeDb, seedPayProject } from '../mcp/testing/seed';
import type { DebtBillView } from './billView';
import { getDebtBill } from './billView';

/** Requête de résolveur : seul le payload compte ici. */
function request(payload: Record<string, unknown>): Request<unknown> {
  return { payload } as unknown as Request<unknown>;
}

/** Vue rendue, ou échec du test si le résolveur a renvoyé une erreur. */
function viewOf(result: DebtBillView | Failure): DebtBillView {
  if ('ok' in result && result.ok === false) assert.fail(`succès attendu, reçu : ${result.error}`);
  return result as DebtBillView;
}

describe('getDebtBill — parts d’attribution (recette §20 n° 2)', () => {
  it('expose la part de chaque preuve et le total toutes dettes confondues', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await getDebtBill(request({ debtIssueId: 'd41' })));
    const share = view.shares.find((item) => item.evidenceId === 'ev3');
    assert.ok(share, 'la preuve partagée doit apparaître');
    assert.equal(share.share, 0.6, 'part imputée à PAY-41');
    assert.equal(share.totalShare, 1, '0,6 pour PAY-41 + 0,4 pour PAY-90');
    assert.equal(share.basis, 'inferred');
    assert.equal(share.sourceKey, 'PAY-103');
    assert.equal(share.costJp, 4);
  });

  it('une preuve liée à 100 % porte sa base et son total', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await getDebtBill(request({ debtIssueId: 'd77' })));
    const linked = view.shares.find((item) => item.evidenceId === 'ev1');
    assert.equal(linked?.share, 1);
    assert.equal(linked?.basis, 'link');
    assert.equal(linked?.totalShare, 1);
    const inferred = view.shares.find((item) => item.evidenceId === 'ev2');
    assert.equal(inferred?.share, 0.5);
    assert.equal(inferred?.basis, 'inferred');
  });

  it('aucune part n’invente une preuve absente de l’addition', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await getDebtBill(request({ debtIssueId: 'd77' })));
    const ids = view.evidence.map((item) => item.id);
    for (const share of view.shares) assert.equal(ids.includes(share.evidenceId), true);
  });
});

describe('getDebtBill — hiddenCount réel et masquage (§18)', () => {
  it('compte les preuves masquées et retire leur contenu', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await getDebtBill(request({ debtIssueId: 'd77' })));
    assert.equal(view.hiddenCount, 1);
    assert.equal(view.bill.hiddenCount, 1, 'le panneau lit bill.hiddenCount');
    assert.equal(view.evidence.length, 4, 'la preuve masquée reste comptée');
    const hidden = view.evidence.find((item) => item.id === 'ev2');
    assert.equal(hidden?.visible, false);
    assert.equal(hidden?.sourceKey, '');
    assert.equal(hidden?.detail.formula, MASKED_FORMULA);
    assert.equal(hidden?.costJp, 3);
    const visible = view.evidence.find((item) => item.id === 'ev1');
    assert.equal(visible?.sourceKey, 'PAY-101');
    assert.equal(visible?.detail.formula, '2 intervenants × 3 j');
  });

  it('une addition sans preuves cachées compte zéro', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const view = viewOf(await getDebtBill(request({ debtIssueId: 'd41' })));
    assert.equal(view.hiddenCount, 0);
  });
});

describe('getDebtBill — erreurs actionnables (item D45)', () => {
  it('ticket inconnu et payload vide rendent une phrase, jamais une exception', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const missing = await getDebtBill(request({}));
    assert.equal('ok' in missing && missing.ok === false, true);
    assert.match((missing as Failure).error, /« debtIssueId » manquant ou vide/);
    const unknown = await getDebtBill(request({ debtIssueId: 'nope' }));
    assert.match((unknown as Failure).error, /ticket nope inconnu : lancer l'initialisation/);
  });
});
