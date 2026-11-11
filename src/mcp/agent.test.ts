/**
 * Garde-fous de l'agent « L'addition » (§13).
 *
 * Le prompt est un contrat : s'il perd un interdit, l'agent peut classer des
 * personnes ou inventer un chiffre sans que rien ne casse ailleurs. Ces tests
 * vérifient que les interdits et les cinq amorces restent en place, dans les
 * deux langues livrées.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentDescription, agentForbiddenTopics, agentPrompt, agentStarters } from './agent';

describe('agent — prompt', () => {
  it('tient les deux langues et se replie sur l’anglais', () => {
    assert.equal(agentPrompt('fr').includes('jours-personne'), true, 'prompt français absent');
    assert.equal(agentPrompt('en').includes('person-days'), true, 'prompt anglais absent');
    assert.equal(agentPrompt('de' as never), agentPrompt('en'), 'une langue inconnue doit retomber sur l’anglais');
  });

  it('interdit de classer des personnes', () => {
    for (const locale of ['fr', 'en'] as const) {
      const prompt = agentPrompt(locale).toLowerCase();
      assert.equal(prompt.includes('personnes') || prompt.includes('people'), true, `${locale} : interdit manquant`);
      assert.equal(prompt.includes('zone'), true, `${locale} : l’unité zone doit être rappelée`);
    }
  });

  it('exige une fourchette et une méthode pour chaque chiffre', () => {
    const fr = agentPrompt('fr').toLowerCase();
    assert.equal(fr.includes('fourchette'), true, 'fourchette absente');
    assert.equal(fr.includes('méthode'), true, 'méthode absente');
    assert.equal(fr.includes('jamais une valeur unique'), true, 'valeur unique non interdite');
  });

  it('interdit d’inventer un chiffre', () => {
    assert.equal(agentPrompt('fr').toLowerCase().includes('inventes'), true, 'interdit d’invention absent');
    assert.equal(agentPrompt('en').toLowerCase().includes('invent'), true, 'interdit d’invention absent (en)');
  });

  it('garde le retard induit hors de l’addition', () => {
    assert.equal(agentPrompt('fr').toLowerCase().includes('c5'), true, 'C5 non mentionnée');
    assert.equal(agentPrompt('fr').toLowerCase().includes('jamais'), true, 'aucun interdit formulé');
  });

  it('nomme les huit actions disponibles', () => {
    const prompt = agentPrompt('fr');
    for (const action of [
      'get-debt-ranking',
      'get-debt-bill',
      'get-zone-costs',
      'list-phantom-debt',
      'list-dead-debt',
      'get-repayment-report',
      'draft-debt-ticket',
      'confirm-evidence',
    ]) {
      assert.equal(prompt.includes(action), true, `action ${action} absente du prompt`);
    }
  });
});

describe('agent — amorces et description', () => {
  it('propose les cinq amorces du §13, dans les deux langues', () => {
    for (const locale of ['fr', 'en'] as const) {
      const starters = agentStarters(locale);
      assert.equal(starters.length, 5, `${locale} : ${starters.length} amorces`);
      for (const starter of starters) assert.equal(starter.trim().length > 0, true, 'amorce vide');
    }
    assert.equal(agentStarters('fr')[0], 'Quelle dette nous coûte le plus ?');
    assert.equal(agentStarters('fr')[4], "Prépare l'argumentaire pour PAY-77.");
  });

  it('rend une copie : modifier le tableau ne change pas la source', () => {
    const starters = agentStarters('fr');
    starters.push('injecté');
    assert.equal(agentStarters('fr').length, 5);
  });

  it('décrit l’agent en une phrase, sans chiffre', () => {
    for (const locale of ['fr', 'en'] as const) {
      const description = agentDescription(locale);
      assert.equal(description.length > 0, true, `${locale} : description vide`);
      assert.equal(/\d/.test(description), false, `${locale} : la description ne doit porter aucun chiffre`);
    }
  });

  it('liste les sujets interdits', () => {
    assert.equal(agentForbiddenTopics('fr').length, 4);
    assert.equal(agentForbiddenTopics('fr').includes('classement de personnes'), true);
  });
});
