import type { ResolverFunction } from '@forge/resolver';
import { bootstrapProgress, getDataQuality, getProjectPage, getRepaymentReport, getSettings, getZoneCosts, listDeadDebt, listPhantomDebt } from './read.ts';
import { getDebtBill } from './billView.ts';
import { confirmEvidence, rejectEvidence } from './decide.ts';
import { saveSettings } from './settings.ts';
import { clearSampleData, loadSampleData } from './sample.ts';
import { draftDebtTicket } from './draft.ts';
import { startBootstrap } from './bootstrap.ts';

/**
 * API des écrans (§14) : une clé par fonction appelée par l'UI.
 *
 * Les clés sont exactement celles de `src/ui/api.ts` — c'est le contrat, et il
 * n'y en a pas d'autre. Chaque fonction valide son payload et rend
 * `{ ok: false, error }` plutôt que de jeter : un écran ne montre jamais une
 * pile d'appels, seulement une phrase. Aucune ne calcule de coût : les preuves
 * et les additions sont lues telles que le calcul nocturne les a écrites.
 */
export const RESOLVERS: Record<string, ResolverFunction> = {
  getProjectPage,
  getDebtBill,
  getZoneCosts,
  listPhantomDebt,
  listDeadDebt,
  getRepaymentReport,
  draftDebtTicket,
  confirmEvidence,
  rejectEvidence,
  getSettings,
  saveSettings,
  startBootstrap,
  bootstrapProgress,
  loadSampleData,
  clearSampleData,
  getDataQuality,
};
