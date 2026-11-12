/**
 * Tests des doubles de test eux-mêmes (garde CI « un dossier porte des tests »).
 *
 * Le jeu amorcé par `seedPayProject` sert de référence à une dizaine de suites :
 * s'il dérive, les assertions des autres portent sur autre chose que le cahier
 * des charges. On vérifie donc ici les invariants que le jeu prétend reproduire
 * (dettes du §7, preuve masquée du §18, parts qui ne dépassent pas 1 de la
 * recette §20 n° 2), puis les deux lecteurs d'enveloppe : leur rôle est
 * d'échouer bruyamment plutôt que de laisser une assertion porter sur
 * `undefined`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
} from '../../platform/db/index';
import { dataOf, errorOf } from './envelopes';
import { PROJECT_ID, bills, evidenceRows, seedPayProject, startFakeDb } from './seed';

describe('seedPayProject — le jeu de référence reste celui du cahier', () => {
  it('amorce quatre dettes, dont une endormie et une sans addition', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const debts = await listDebtIssues(PROJECT_ID);
    assert.deepEqual(
      debts.map((debt) => debt.key).sort(),
      ['PAY-41', 'PAY-50', 'PAY-77', 'PAY-90'],
      'trois dettes vivantes + une dette morte (§7.3)',
    );
    const stored = await listBills(PROJECT_ID);
    assert.deepEqual(
      stored.map((bill) => bill.key).sort(),
      ['PAY-41', 'PAY-77'],
      'PAY-90 n’a volontairement aucune addition : c’est le cas « dette sans preuve »',
    );
  });

  it('conserve une preuve masquée et une preuve partagée à parts complètes', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const evidence = await listEvidence(PROJECT_ID);
    assert.deepEqual(
      evidence.filter((row) => !row.visible).map((row) => row.id),
      ['ev2'],
      '§18 : exactement une preuve hors des droits du lecteur',
    );
    const shared = (await listAttributions(PROJECT_ID)).filter((row) => row.evidenceId === 'ev3');
    assert.equal(shared.length, 2, 'ev3 est partagée entre deux dettes');
    const total = shared.reduce((sum, row) => sum + row.share, 0);
    assert.equal(Math.round(total * 100) / 100, 1, 'recette §20 n° 2 : la somme des parts vaut 1');
  });

  it('expose les fabriques sans dépendre de l’amorçage', () => {
    assert.equal(bills().length, 2, 'deux additions déclarées');
    assert.equal(evidenceRows().length, 7, 'sept preuves, dont deux homonymes (item E74)');
  });
});

describe('envelopes — dataOf et errorOf échouent au lieu de rendre undefined', () => {
  it('lit le côté attendu d’une enveloppe', () => {
    assert.deepEqual(dataOf<{ n: number }>({ ok: true, data: { n: 1 } }), { n: 1 });
    assert.equal(errorOf({ ok: false, error: 'zone inconnue' }), 'zone inconnue');
  });

  it('refuse l’enveloppe inverse', () => {
    assert.throws(() => dataOf({ ok: false, error: 'échec' }), /succès attendu/);
    assert.throws(() => errorOf({ ok: true, data: 1 }), /enveloppe d’échec était attendue/);
  });
});
