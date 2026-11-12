/**
 * Garde-fous de l'agent « L'addition » (§13, items E68 à E70, E75).
 *
 * Le prompt est un contrat : s'il perd un interdit, l'agent peut classer des
 * personnes, inventer un chiffre ou confirmer un rapprochement à la place d'un
 * humain sans que rien ne casse ailleurs. Ces tests vérifient que les interdits,
 * les cinq amorces et la liste d'outils restent en place, dans les deux langues
 * livrées — et que le prompt ne recèle aucune valeur codée en dur (item E69).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentDescription, agentForbiddenTopics, agentPrompt, agentStarters, agentToolList } from './agent';
import { AGENT_ACTION_KEYS, MCP_TOOL_KEYS } from './registry';

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

  it('interdit le double compte (parts ≤ 100 %)', () => {
    for (const locale of ['fr', 'en'] as const) {
      const prompt = agentPrompt(locale);
      assert.equal(prompt.includes('100 %'), true, `${locale} : la borne des parts doit être rappelée`);
      assert.equal(/deux fois|twice/.test(prompt), true, `${locale} : le double compte doit être interdit`);
    }
  });
});

describe('agent — outils cités (items E68, E70, E75)', () => {
  it('nomme exactement les actions de l’agent, et rien d’autre', () => {
    const prompt = agentPrompt('fr');
    for (const action of AGENT_ACTION_KEYS) {
      assert.equal(prompt.includes(action), true, `action ${action} absente du prompt`);
    }
    assert.equal(agentToolList(), AGENT_ACTION_KEYS.join(', '), 'la liste citée doit venir de la table');
  });

  it('cite l’argumentaire, les preuves de zone et la liste des projets', () => {
    for (const locale of ['fr', 'en'] as const) {
      const prompt = agentPrompt(locale);
      assert.equal(prompt.includes('get-debt-case'), true, `${locale} : get-debt-case absent (item E68)`);
      assert.equal(prompt.includes('list-zone-evidence'), true, `${locale} : list-zone-evidence absent (item E67)`);
      assert.equal(prompt.includes('list-projects'), true, `${locale} : list-projects absent (item E75)`);
    }
  });

  it('ne propose jamais confirm-evidence à l’agent : la confirmation est humaine (§10)', () => {
    for (const locale of ['fr', 'en'] as const) {
      const prompt = agentPrompt(locale);
      assert.equal(prompt.includes('confirm-evidence'), false, `${locale} : l'agent ne doit pas confirmer seul`);
      assert.equal(
        /appartient à un humain|belongs to a human/.test(prompt),
        true,
        `${locale} : la réserve humaine doit être dite`,
      );
    }
    assert.equal(AGENT_ACTION_KEYS.includes('confirm-evidence'), false, 'confirm-evidence hors liste agent');
    assert.equal(MCP_TOOL_KEYS.includes('confirm-evidence'), true, 'confirm-evidence reste un outil MCP');
  });
});

describe('agent — aucune valeur codée en dur (item E69)', () => {
  it('ne fige ni la fenêtre, ni le seuil de dette morte, ni un taux', () => {
    for (const locale of ['fr', 'en'] as const) {
      const prompt = agentPrompt(locale);
      assert.equal(/\b(90|180)\b/.test(prompt), false, `${locale} : une durée est codée en dur`);
      assert.equal(/90\s?(jours|days)|sur 90/.test(prompt), false, `${locale} : fenêtre figée`);
      assert.equal(
        /réglages|settings/.test(prompt),
        true,
        `${locale} : le prompt doit renvoyer aux réglages du projet`,
      );
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

  it('les amorces sans projet nomment une action jouable (item E75)', () => {
    // Amorces 1 et 3 : aucun `projectKey` fourni. Elles restent jouables parce
    // que les actions acceptent une clé facultative avec repli, et que le prompt
    // demande `list-projects` en cas d'ambiguïté.
    for (const index of [0, 2] as const) {
      const starter = agentStarters('fr')[index] ?? '';
      assert.equal(starter.includes('PAY-'), false, `amorce ${index + 1} : projet codé en dur`);
    }
    assert.equal(agentPrompt('fr').includes('list-projects'), true, 'repli non documenté');
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
