/**
 * Tests du correctif de réglages de l'outillage d'exploitation (`?action=init`).
 *
 * L'outillage sert à préparer un site de démo sans navigateur : il doit donc
 * accepter les réglages numériques (taux journalier en euros, fenêtre, seuils)
 * et le champ de story points. Deux exigences : une valeur illisible est
 * **ignorée** plutôt que devinée, et une valeur hors bornes est **ramenée**
 * dans les bornes du §11 — jamais écrite telle quelle.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SETTINGS_PARAMS, settingsPatch } from './ops';
import { initPatch } from './opsTrigger';
import type { WebTriggerRequest } from './smokeTrigger';

describe('settingsPatch — réglages numériques de l’outillage', () => {
  it('lit un taux journalier et un champ de story points', () => {
    const patch = settingsPatch({ dayRateEur: '650', storyPointField: ' Story Points ' });
    assert.equal(patch.dayRateEur, 650);
    assert.equal(patch.storyPointField, 'Story Points');
  });

  it('ignore une valeur illisible au lieu de la deviner', () => {
    const patch = settingsPatch({ dayRateEur: 'beaucoup', storyPointField: '   ', windowDays: 'NaN' });
    assert.equal('dayRateEur' in patch, false);
    assert.equal('storyPointField' in patch, false);
    assert.equal('windowDays' in patch, false);
  });

  it('ramène une valeur hors bornes dans les bornes du domaine', () => {
    const patch = settingsPatch({
      dayRateEur: '-5',
      hoursPerDay: '99',
      occupationCoefficient: '3',
      minBaselineSample: '0',
    });
    assert.equal(patch.dayRateEur, 0);
    assert.equal(patch.hoursPerDay, 24);
    assert.equal(patch.occupationCoefficient, 1);
    assert.equal(patch.minBaselineSample, 1);
  });

  it('accepte une écriture décimale à virgule comme à point', () => {
    assert.equal(settingsPatch({ occupationCoefficient: '0.5' }).occupationCoefficient, 0.5);
    assert.equal(settingsPatch({ dayRateEur: '650,5' }).dayRateEur, 650.5);
  });

  it('conserve le comportement existant : règle de dette, mode de zone', () => {
    const patch = settingsPatch({ debtRuleKind: 'jql', debtRuleValue: 'labels = dette', zoneMode: 'label' });
    assert.deepEqual(patch.debtRule, { kind: 'jql', value: 'labels = dette' });
    assert.equal(patch.zoneMode, 'label');
  });

  it('une query string vide ne produit aucun correctif', () => {
    assert.deepEqual(settingsPatch({}), {});
  });
});

describe('initPatch — les paramètres de réglage traversent le webtrigger', () => {
  /** Requête de webtrigger : chaque paramètre arrive en tableau de chaînes. */
  function request(params: Record<string, string>): WebTriggerRequest {
    return { queryParameters: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]])) };
  }

  it('transmet un réglage numérique et le champ de story points', () => {
    const patch = initPatch(request({ dayRateEur: '650', storyPointField: 'customfield_10016' }));
    assert.equal(patch['dayRateEur'], '650');
    assert.equal(patch['storyPointField'], 'customfield_10016');
  });

  it('transmet les réglages historiques et rien d’autre', () => {
    const patch = initPatch(
      request({ debtRuleKind: 'jql', zoneMode: 'label', action: 'init', project: 'MOBL', token: 'secret', inconnu: 'x' }),
    );
    assert.deepEqual(patch, { debtRuleKind: 'jql', zoneMode: 'label' });
  });

  it('la liste des paramètres couvre chaque réglage numérique accepté', () => {
    for (const name of ['dayRateEur', 'hoursPerDay', 'windowDays', 'phantomThresholdJp', 'minBaselineSample']) {
      assert.equal(SETTINGS_PARAMS.includes(name), true, `${name} absent de SETTINGS_PARAMS`);
    }
  });
});
