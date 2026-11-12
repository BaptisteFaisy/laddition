/**
 * Table des actions exposées à Rovo et à `rovo:mcp` (§13).
 *
 * Une seule source de vérité : la clé du manifeste, le verbe, le handler, le nom
 * de la fonction exportée par `src/index.tsx` et **les entrées réellement lues**
 * sont écrits ici. `manifest.test.ts` compare cette table au manifeste : une
 * action non déclarée, un verbe divergent ou une entrée lue mais non déclarée
 * casse le test au lieu de casser l'agent en production (item E77).
 */

import type { Action } from './result';
import {
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './actions';
import { getDebtCase } from './debtCase';
import { listZoneEvidence } from './zoneEvidence';
import { listProjects } from './projectList';

/** Verbe d'une action : lecture seule, ou écriture. */
export type ActionVerb = 'GET' | 'UPDATE';

/** Une action du §13, telle que la déclare le manifeste. */
export interface ActionSpec {
  /** Clé du module `action` et de l'outil `rovo:mcp`. */
  key: string;
  verb: ActionVerb;
  handler: Action;
  /**
   * Nom exporté par `src/index.tsx`, référencé par `function:` du manifeste.
   *
   * TODO(integration) : `src/index.tsx` et `manifest.yml` ne sont pas modifiables
   * par ce lot. Pour chaque nouvelle action, il faut y ajouter (1) un module
   * `function` (`key: <exportName>` / `handler: index.<exportName>`), (2) le
   * module `action` correspondant, et (3) l'export du handler dans
   * `src/index.tsx`. `manifest.test.ts` vérifie les trois et reste rouge tant
   * que ce n'est pas fait.
   */
  exportName: string;
  /** Entrées lues du payload : le manifeste doit toutes les déclarer. */
  inputs: readonly string[];
  /**
   * Réservée à une décision humaine (item E70, §10) : exposée dans `rovo:mcp`,
   * **jamais** dans la liste d'actions de l'agent conversationnel.
   */
  humanOnly?: boolean;
}

/** Les actions du §13, dans l'ordre du cahier des charges, puis les ajouts. */
export const ACTIONS: Readonly<Record<string, ActionSpec>> = {
  'get-debt-ranking': {
    key: 'get-debt-ranking',
    verb: 'GET',
    handler: getDebtRanking,
    exportName: 'getDebtRanking',
    inputs: ['projectKey', 'limit'],
  },
  'get-debt-bill': {
    key: 'get-debt-bill',
    verb: 'GET',
    handler: getDebtBill,
    exportName: 'getDebtBill',
    inputs: ['issueKey'],
  },
  'get-debt-case': {
    key: 'get-debt-case',
    verb: 'GET',
    handler: getDebtCase,
    exportName: 'getDebtCase',
    inputs: ['issueKey'],
  },
  'get-zone-costs': {
    key: 'get-zone-costs',
    verb: 'GET',
    handler: getZoneCosts,
    exportName: 'getZoneCosts',
    inputs: ['projectKey', 'zone'],
  },
  'list-zone-evidence': {
    key: 'list-zone-evidence',
    verb: 'GET',
    handler: listZoneEvidence,
    exportName: 'listZoneEvidence',
    inputs: ['projectKey', 'zone'],
  },
  'list-phantom-debt': {
    key: 'list-phantom-debt',
    verb: 'GET',
    handler: listPhantomDebt,
    exportName: 'listPhantomDebt',
    inputs: ['projectKey'],
  },
  'list-dead-debt': {
    key: 'list-dead-debt',
    verb: 'GET',
    handler: listDeadDebt,
    exportName: 'listDeadDebt',
    inputs: ['projectKey'],
  },
  'get-repayment-report': {
    key: 'get-repayment-report',
    verb: 'GET',
    handler: getRepaymentReport,
    exportName: 'getRepaymentReport',
    inputs: ['issueKey'],
  },
  'draft-debt-ticket': {
    key: 'draft-debt-ticket',
    verb: 'GET',
    handler: draftDebtTicket,
    exportName: 'draftDebtTicket',
    inputs: ['projectKey', 'zone'],
  },
  'list-projects': {
    key: 'list-projects',
    verb: 'GET',
    handler: listProjects,
    exportName: 'listProjects',
    inputs: [],
  },
  'confirm-evidence': {
    key: 'confirm-evidence',
    verb: 'UPDATE',
    handler: confirmEvidence,
    exportName: 'confirmEvidence',
    inputs: ['evidenceKey', 'debtKey', 'confirmed'],
    humanOnly: true,
  },
};

/** Clés des actions, dans l'ordre de déclaration. */
export const ACTION_KEYS: readonly string[] = Object.keys(ACTIONS);

/** Outils exposés par `rovo:mcp` : toutes les actions. */
export const MCP_TOOL_KEYS: readonly string[] = ACTION_KEYS;

/**
 * Actions de l'agent conversationnel : tout sauf `confirm-evidence`.
 *
 * Le §10 réserve la confirmation d'un rapprochement à un humain ; l'agent
 * explique la proposition et renvoie à l'écran (item E70). Cette liste est la
 * source du prompt (`agent.ts`) et de la liste `actions:` du manifeste.
 */
export const AGENT_ACTION_KEYS: readonly string[] = ACTION_KEYS.filter(
  (key) => ACTIONS[key]?.humanOnly !== true,
);
