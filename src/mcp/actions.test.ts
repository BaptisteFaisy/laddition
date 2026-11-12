/**
 * Tests des actions MCP (item E76).
 *
 * Couvertures : paramètres manquants, vides ou du mauvais type pour chaque
 * action ; enveloppes d'erreur lisibles (projet inconnu, ticket qui n'est pas
 * une dette, clé sans tiret, aucune addition, aucun bulletin, zone inconnue,
 * preuve ambiguë) ; bornage de `limit` avec écho (item E72) ; cohérence entre
 * les handlers et la table `ACTIONS` ; entrées réellement lues versus entrées
 * déclarées (item E77).
 *
 * Aucune base réelle : le double en mémoire de la couche de stockage
 * (`platform/db/fakeSql.ts`) est installé pour chaque test.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import type { ActionEnvelope, JsonPayload } from './result';
import { optionalNumber, requireBoolean, requireText } from './result';
import {
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
  MCP_ACTOR,
} from './actions';
import { getDebtCase } from './debtCase';
import { listZoneEvidence } from './zoneEvidence';
import { listProjects } from './projectList';
import { ACTIONS, ACTION_KEYS, AGENT_ACTION_KEYS, MCP_TOOL_KEYS } from './registry';
import { invokeAction } from './index';
import { startFakeDb, seedPayProject } from './testing/seed';
import { dataOf, errorOf } from './testing/envelopes';

/** Un cas de validation : l'appel, le payload, et le fragment attendu. */
interface ParamCase {
  label: string;
  call: (payload: JsonPayload) => Promise<ActionEnvelope<unknown>>;
  payload: JsonPayload;
  fragment: string | RegExp;
}

describe('actions — cohérence de la table (item E76)', () => {
  const HANDLERS: Record<string, (payload: JsonPayload) => Promise<ActionEnvelope<unknown>>> = {
    'get-debt-ranking': getDebtRanking,
    'get-debt-bill': getDebtBill,
    'get-debt-case': getDebtCase,
    'get-zone-costs': getZoneCosts,
    'list-zone-evidence': listZoneEvidence,
    'list-phantom-debt': listPhantomDebt,
    'list-dead-debt': listDeadDebt,
    'get-repayment-report': getRepaymentReport,
    'draft-debt-ticket': draftDebtTicket,
    'list-projects': listProjects,
    'confirm-evidence': confirmEvidence,
  };

  it('chaque clé de la table pointe sur le bon handler', () => {
    for (const key of ACTION_KEYS) {
      const spec = ACTIONS[key];
      assert.ok(spec, `spec absente pour ${key}`);
      assert.equal(spec?.key, key, `clé incohérente : ${key}`);
      assert.equal(spec?.handler, HANDLERS[key], `handler inattendu pour ${key}`);
      assert.equal(spec?.verb === 'GET' || spec?.verb === 'UPDATE', true, `verbe invalide pour ${key}`);
      assert.equal((spec?.exportName ?? '').length > 0, true, `exportName absent pour ${key}`);
      assert.ok(Array.isArray(spec?.inputs), `inputs absents pour ${key}`);
    }
    assert.equal(Object.keys(HANDLERS).length, ACTION_KEYS.length, 'table et handlers divergents');
  });

  it('une seule écriture, réservée à un humain (item E70)', () => {
    const writes = ACTION_KEYS.filter((key) => ACTIONS[key]?.verb === 'UPDATE');
    assert.deepEqual(writes, ['confirm-evidence']);
    assert.deepEqual(ACTION_KEYS.filter((key) => ACTIONS[key]?.humanOnly === true), ['confirm-evidence']);
    assert.equal(AGENT_ACTION_KEYS.includes('confirm-evidence'), false, 'l’agent ne doit pas confirmer');
    assert.equal(MCP_TOOL_KEYS.length, ACTION_KEYS.length, 'rovo:mcp expose toutes les actions');
  });

  it('une clé inconnue rend une enveloppe d’échec, pas une exception', async () => {
    const result = await invokeAction('get-debt-cass', {});
    assert.equal(result.ok, false);
    assert.match(errorOf(result), /action inconnue/);
    assert.match(errorOf(result), /get-debt-case/, 'les actions disponibles doivent être listées');
  });
});

describe('actions — paramètres manquants, vides ou du mauvais type (item E76)', () => {
  const CASES: ParamCase[] = [
    { label: 'get-debt-bill sans issueKey', call: getDebtBill, payload: {}, fragment: '« issueKey » requis' },
    { label: 'get-debt-bill issueKey vide', call: getDebtBill, payload: { issueKey: '   ' }, fragment: '« issueKey » requis' },
    { label: 'get-debt-bill issueKey nombre', call: getDebtBill, payload: { issueKey: 77 }, fragment: 'un texte est attendu' },
    { label: 'get-debt-case sans issueKey', call: getDebtCase, payload: {}, fragment: '« issueKey » requis' },
    { label: 'get-repayment-report sans issueKey', call: getRepaymentReport, payload: {}, fragment: '« issueKey » requis' },
    { label: 'get-debt-ranking projectKey nombre', call: getDebtRanking, payload: { projectKey: 12 }, fragment: '« projectKey » : un texte est attendu, reçu un nombre' },
  ];

  for (const item of CASES) {
    it(item.label, async (t) => {
      await startFakeDb(t);
      const result = await item.call(item.payload);
      assert.equal(result.ok, false, 'une erreur était attendue');
      assert.match(errorOf(result), typeof item.fragment === 'string' ? new RegExp(escapeRegExp(item.fragment)) : item.fragment);
    });
  }

  it('get-zone-costs et list-zone-evidence exigent une zone', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    for (const call of [getZoneCosts, listZoneEvidence, draftDebtTicket]) {
      const result = await call({ projectKey: 'PAY' });
      assert.equal(result.ok, false);
      assert.match(errorOf(result), /« zone » requis/);
    }
  });

  it('confirm-evidence exige ses trois entrées, dans le bon type', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const missing = await confirmEvidence({ evidenceKey: 'ev1', debtKey: 'PAY-77' });
    assert.match(errorOf(missing), /« confirmed » requis : un booléen/);
    const wrongType = await confirmEvidence({ evidenceKey: 'ev1', debtKey: 'PAY-77', confirmed: 'true' });
    assert.match(errorOf(wrongType), /pas la chaîne « true »/, 'item E73 : message trompeur');
    const noKey = await confirmEvidence({ debtKey: 'PAY-77', confirmed: true });
    assert.match(errorOf(noKey), /« evidenceKey » requis/);
  });
});

describe('actions — enveloppes d’erreur lisibles (items E76, D45)', () => {
  it('projet inconnu : le motif dit quoi faire', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await getDebtRanking({ projectKey: 'NOPE' });
    assert.match(errorOf(result), /projet « NOPE » inconnu/);
    assert.match(errorOf(result), /PAY/, 'les projets initialisés doivent être listés');
  });

  it('aucun projet initialisé : le motif renvoie à l’initialisation', async (t) => {
    await startFakeDb(t);
    const result = await listPhantomDebt({ projectKey: 'PAY' });
    assert.match(errorOf(result), /inconnu|aucun projet initialisé/);
  });

  it('ticket qui n’est pas une dette', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await getDebtBill({ issueKey: 'PAY-1' });
    assert.match(errorOf(result), /n'est pas un ticket de dette/);
  });

  it('clé sans tiret : le format attendu est rappelé', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await getDebtBill({ issueKey: 'PAY' });
    assert.match(errorOf(result), /clé de ticket illisible/);
    assert.match(errorOf(result), /PROJET-NUMÉRO/);
  });

  it('aucune addition calculée', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await getDebtBill({ issueKey: 'PAY-90' });
    assert.match(errorOf(result), /aucune addition calculée/);
    assert.match(errorOf(result), /calcul nocturne/);
  });

  it('aucun bulletin de remboursement', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await getRepaymentReport({ issueKey: 'PAY-77' });
    assert.match(errorOf(result), /aucun bulletin de remboursement/);
  });

  it('zone inconnue : les zones valides sont listées (item E67)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    for (const call of [getZoneCosts, listZoneEvidence, draftDebtTicket]) {
      const result = await call({ projectKey: 'PAY', zone: 'inconnue' });
      const error = errorOf(result);
      assert.match(error, /zone « inconnue » inconnue/);
      assert.match(error, /zones disponibles : api, archive, legacy, notifications, taxes/);
    }
  });

  it('preuve ambiguë sur une action qui écrit : refus, pas premier homonyme (item E74)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await confirmEvidence({ evidenceKey: 'DUP-1', debtKey: 'PAY-77', confirmed: true });
    const error = errorOf(result);
    assert.match(error, /ambiguë/);
    assert.match(error, /ev5/, 'les identifiants en clair doivent permettre de lever l’ambiguïté');
    assert.match(error, /ev6/);
  });

  it('preuve inconnue : le motif dit où trouver l’identifiant', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const result = await confirmEvidence({ evidenceKey: 'PAY-999', debtKey: 'PAY-77', confirmed: true });
    assert.match(errorOf(result), /preuve « PAY-999 » inconnue/);
    assert.match(errorOf(result), /list-zone-evidence/);
  });
});

describe('actions — bornage de la limite avec écho (item E72)', () => {
  it('100000 est plafonné à 50, et l’appelant le voit', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<{ limit: number; limitApplied: { applied: number; requested: number | null; adjusted: boolean; note: string } }>(
      await getDebtRanking({ projectKey: 'PAY', limit: 100000 }),
    );
    assert.equal(data.limit, 50);
    assert.equal(data.limitApplied.applied, 50);
    assert.equal(data.limitApplied.requested, 100000);
    assert.equal(data.limitApplied.adjusted, true);
    assert.match(data.limitApplied.note, /plafonné/);
  });

  it('limit: true n’est plus avalé comme 1', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<{ limit: number; limitApplied: { adjusted: boolean; note: string } }>(
      await getDebtRanking({ projectKey: 'PAY', limit: true }),
    );
    assert.equal(data.limit, 10, 'le repli par défaut doit s’appliquer');
    assert.equal(data.limitApplied.adjusted, true);
    assert.match(data.limitApplied.note, /booléen/);
  });

  it('une limite lisible est appliquée telle quelle', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<{ limit: number; limitApplied: { adjusted: boolean } }>(
      await getDebtRanking({ projectKey: 'PAY', limit: 2 }),
    );
    assert.equal(data.limit, 2);
    assert.equal(data.limitApplied.adjusted, false);
    assert.equal(dataOf<{ debts: unknown[] }>(await getDebtRanking({ projectKey: 'PAY', limit: 2 })).debts.length, 2);
  });
});

describe('result — validateurs (items E72, E73)', () => {
  it('requireText distingue absent, vide et mauvais type', () => {
    assert.throws(() => requireText({}, 'zone'), /« zone » requis/);
    assert.throws(() => requireText({ zone: '' }, 'zone'), /« zone » requis/);
    assert.throws(() => requireText({ zone: true }, 'zone'), /un texte est attendu, reçu un booléen/);
    assert.equal(requireText({ zone: ' api ' }, 'zone'), 'api');
  });

  it('requireBoolean ne devine jamais une chaîne (item E73)', () => {
    assert.equal(requireBoolean({ confirmed: true }, 'confirmed'), true);
    assert.equal(requireBoolean({ confirmed: false }, 'confirmed'), false);
    assert.throws(() => requireBoolean({ confirmed: 'true' }, 'confirmed'), /pas la chaîne « true »/);
    assert.throws(() => requireBoolean({}, 'confirmed'), /requis : un booléen/);
    assert.throws(() => requireBoolean({ confirmed: 1 }, 'confirmed'), /reçu un nombre/);
  });

  it('optionalNumber borne, rejette les booléens, et échoie', () => {
    const clamped = optionalNumber({ limit: 100000 }, 'limit', 10, 50);
    assert.deepEqual([clamped.applied, clamped.requested, clamped.adjusted], [50, 100000, true]);
    const boolean = optionalNumber({ limit: true }, 'limit', 10, 50);
    assert.deepEqual([boolean.applied, boolean.requested, boolean.adjusted], [10, null, true]);
    const absent = optionalNumber({}, 'limit', 10, 50);
    assert.deepEqual([absent.applied, absent.requested, absent.adjusted], [10, null, false]);
    const text = optionalNumber({ limit: '7' }, 'limit', 10, 50);
    assert.deepEqual([text.applied, text.adjusted], [7, false]);
    const garbage = optionalNumber({ limit: 'abc' }, 'limit', 10, 50);
    assert.deepEqual([garbage.applied, garbage.adjusted], [10, true]);
    const zero = optionalNumber({ limit: 0 }, 'limit', 10, 50);
    assert.deepEqual([zero.applied, zero.requested, zero.adjusted], [10, 0, true]);
  });
});

describe('confirm-evidence — auteur non usurpable (item E71)', () => {
  it('l’auteur enregistré est l’outil, jamais un champ du payload', () => {
    assert.equal(MCP_ACTOR, 'rovo-mcp');
    assert.equal(ACTIONS['confirm-evidence']?.inputs.includes('by'), false, '« by » ne doit pas être déclaré');
  });

  it('le payload « by » n’est plus lu par l’action', () => {
    // Garde anti-régression : un champ libre permettait d'attribuer la décision
    // à un tiers. La lecture a été supprimée ; si elle revient, ce test casse.
    const source = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
    assert.equal(/payload\s*,\s*'by'/.test(source), false, 'lecture du champ « by » réintroduite');
    assert.equal(/\[\s*'by'\s*\]/.test(source), false, 'lecture du champ « by » réintroduite');
    assert.match(source, /MCP_ACTOR/, 'l’auteur neutre doit être utilisé');
  });
});

describe('actions — entrées lues versus déclarées (item E77)', () => {
  it('aucune action ne lit une entrée non déclarée dans la table', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    for (const key of ACTION_KEYS) {
      const spec = ACTIONS[key];
      if (!spec) continue;
      const { payload, read } = recording(spec.inputs);
      await spec.handler(payload);
      const undeclared = [...read].filter((name) => !spec.inputs.includes(name));
      assert.deepEqual(undeclared, [], `${key} lit des entrées non déclarées : ${undeclared.join(', ')}`);
    }
  });
});

/**
 * Payload espion : un `Proxy` qui journalise les clés réellement touchées.
 *
 * Toutes les entrées déclarées sont fournies avec un type invalide, pour que le
 * handler s'arrête sur sa validation au lieu d'aller en base : on observe ainsi
 * ce qu'il lit, sans dépendre du succès de l'appel.
 */
function recording(inputs: readonly string[]): { payload: JsonPayload; read: Set<string> } {
  const read = new Set<string>();
  const base: JsonPayload = {};
  for (const name of inputs) base[name] = { invalid: true };
  const payload = new Proxy(base, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      read.add(property);
      return target[property];
    },
    has(target, property) {
      if (typeof property === 'string') read.add(property);
      return property in target;
    },
  });
  return { payload, read };
}

/** Échappe les caractères spéciaux d'un fragment littéral. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
