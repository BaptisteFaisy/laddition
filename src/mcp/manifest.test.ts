/**
 * Contrat entre `manifest.yml` et le code (items E69, E70, E75, E77).
 *
 * Le manifeste est écrit à la main ; la table des actions est dans
 * `registry.ts`. Sans cette vérification, les deux divergent en silence et
 * c'est l'agent qui casse en production : une action non déclarée, un verbe
 * faux, une entrée lue mais absente du schéma, un prompt différent de celui
 * testé ici.
 *
 * Chaque échec nomme la correction attendue. Le manifeste n'est pas modifiable
 * par ce lot : ces tests passent au vert dès que le bloc YAML fourni avec la
 * revue est collé.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * `js-yaml` n'a pas de déclaration de types installée (et ce lot ne touche pas
 * à `package.json`) : il est chargé par `createRequire` et typé à la main, sur
 * la seule fonction utilisée ici.
 */
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load: (text: string) => unknown };

import { ACTIONS, ACTION_KEYS, AGENT_ACTION_KEYS, MCP_TOOL_KEYS } from './registry';
import { agentDescription, agentPrompt, agentStarters } from './agent';

/** Entrée d'un module `action` du manifeste. */
interface ManifestAction {
  key?: string;
  actionVerb?: string;
  function?: string;
  inputs?: Record<string, { type?: string; required?: boolean }>;
}

/** Module `function` du manifeste. */
interface ManifestFunction {
  key?: string;
  handler?: string;
}

/** Module `rovo:agent` du manifeste. */
interface ManifestAgent {
  key?: string;
  description?: string;
  prompt?: string;
  conversationStarters?: string[];
  actions?: string[];
}

/** Lecture du manifeste et des fichiers concernés, une fois par test. */
function manifest(): {
  actions: ManifestAction[];
  functions: ManifestFunction[];
  agent: ManifestAgent | undefined;
  mcpTools: string[];
} {
  const loaded = yaml.load(readFileSync(new URL('../../manifest.yml', import.meta.url), 'utf8')) as {
    modules?: Record<string, unknown>;
  };
  const modules = loaded.modules ?? {};
  const agents = (modules['rovo:agent'] ?? []) as ManifestAgent[];
  const servers = (modules['rovo:mcp'] ?? []) as Array<{ tools?: string[] }>;
  return {
    actions: (modules['action'] ?? []) as ManifestAction[],
    functions: (modules['function'] ?? []) as ManifestFunction[],
    agent: agents[0],
    mcpTools: servers.flatMap((server) => server.tools ?? []),
  };
}

/** Normalise les blancs : un bloc YAML replié ou littéral rend le même texte. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Action du manifeste pour une clé, ou `undefined`. */
function actionOf(key: string): ManifestAction | undefined {
  return manifest().actions.find((item) => item.key === key);
}

describe('manifest ↔ table des actions (item E77)', () => {
  it('toute action du code est déclarée dans le manifeste', () => {
    const missing = ACTION_KEYS.filter((key) => actionOf(key) === undefined);
    assert.deepEqual(missing, [], `modules.action : déclarer ${missing.join(', ')} (voir le bloc YAML de la revue)`);
  });

  it('toute action déclarée existe dans le code', () => {
    const unknown = manifest()
      .actions.map((item) => item.key ?? '')
      .filter((key) => ACTIONS[key] === undefined);
    assert.deepEqual(unknown, [], `modules.action : clés sans handler ${unknown.join(', ')}`);
  });

  it('les verbes concordent', () => {
    for (const key of ACTION_KEYS) {
      const declared = actionOf(key);
      assert.equal(declared?.actionVerb, ACTIONS[key]?.verb, `verbe de ${key}`);
    }
  });

  it('les entrées déclarées sont exactement celles que le code lit', () => {
    for (const key of ACTION_KEYS) {
      const declared = Object.keys(actionOf(key)?.inputs ?? {}).sort();
      const read = [...(ACTIONS[key]?.inputs ?? [])].sort();
      assert.deepEqual(declared, read, `entrées de ${key} : déclarées [${declared}] vs lues [${read}]`);
    }
  });

  it('chaque action a sa fonction Forge, exportée par src/index.tsx', () => {
    const { functions } = manifest();
    const entry = readFileSync(new URL('../index.tsx', import.meta.url), 'utf8');
    const problems: string[] = [];
    for (const key of ACTION_KEYS) {
      const name = ACTIONS[key]?.exportName ?? '';
      const declared = actionOf(key)?.function;
      const module = functions.find((item) => item.key === name);
      if (declared !== name) problems.push(`${key} : function « ${declared} » ≠ export « ${name} »`);
      if (!module) problems.push(`${key} : modules.function « ${name} » absent`);
      else if (module.handler !== `index.${name}`) problems.push(`${key} : handler « ${module.handler} »`);
      if (!new RegExp(`\\b${name}\\b`).test(entry)) problems.push(`${key} : src/index.tsx n'exporte pas ${name}`);
    }
    assert.deepEqual(problems, [], problems.join(' | '));
  });

  it('rovo:mcp expose toutes les actions, et rien d’autre', () => {
    assert.deepEqual([...manifest().mcpTools].sort(), [...MCP_TOOL_KEYS].sort());
  });
});

describe('manifest ↔ agent (items E69, E70, E75)', () => {
  it('le prompt servi est exactement agentPrompt("en")', () => {
    const served = manifest().agent?.prompt ?? '';
    assert.equal(
      flat(served),
      flat(agentPrompt('en')),
      'rovo:agent.prompt doit être le texte de agentPrompt("en") — voir le bloc YAML de la revue',
    );
  });

  it('la liste d’actions de l’agent exclut confirm-evidence (§10)', () => {
    const listed = manifest().agent?.actions ?? [];
    assert.deepEqual([...listed].sort(), [...AGENT_ACTION_KEYS].sort());
    assert.equal(listed.includes('confirm-evidence'), false, 'la confirmation est réservée à un humain');
  });

  it('les amorces et la description viennent de agent.ts', () => {
    const agent = manifest().agent;
    const starters = (agent?.conversationStarters ?? []).map(flat).join('|');
    const knownStarters = (['fr', 'en'] as const).map((locale) => agentStarters(locale).map(flat).join('|'));
    assert.equal(
      knownStarters.includes(starters),
      true,
      'conversationStarters doit être agentStarters("fr") ou agentStarters("en")',
    );
    const description = flat(agent?.description ?? '');
    const knownDescriptions = (['fr', 'en'] as const).map((locale) => flat(agentDescription(locale)));
    assert.equal(knownDescriptions.includes(description), true, 'description doit être agentDescription()');
  });

  it('le prompt servi ne code en dur aucune durée', () => {
    const served = manifest().agent?.prompt ?? '';
    assert.equal(/\b(90|180)\b/.test(served), false, 'une fenêtre ou un seuil est figé dans le manifeste');
  });
});
