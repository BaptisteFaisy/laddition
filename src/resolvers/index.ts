import type { ResolverFunction } from '@forge/resolver';
import {
  bootstrapProgress,
  getDataQuality,
  getGadgetData,
  getIssueCost,
  getProjectPage,
  getRepaymentReport,
  getSettings,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './read';
import { getDebtBill } from './billView';
import { getDebtCase } from './case';
import { confirmEvidence, rejectEvidence } from './decide';
import { saveSettings } from './settings';
import { clearSampleData, loadSampleData } from './sample';
import { draftDebtTicket, previewDebtTicket } from './draft';
import { listDebtAttributions, listZoneEvidence } from './evidence';
import { startBootstrap } from './bootstrap';

/**
 * API des écrans (§14) : une clé par fonction appelée par l'UI.
 *
 * TODO(integration) : `src/ui/api.ts` (lot UI, non modifiable ici) déclare les
 * clés attendues. `getDebtCase` (item E68) est exposée ici mais absente de son
 * union `ResolverKey` : à y ajouter pour que l'écran « argumentaire » puisse
 * l'appeler. Les cinq autres clés ajoutées (`previewDebtTicket`,
 * `listZoneEvidence`, `listDebtAttributions`, `getIssueCost`, `getGadgetData`)
 * répondent aux `TODO(integration)` déjà écrits dans `ui/api.ts`.
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
  getDebtCase,
  getZoneCosts,
  listPhantomDebt,
  listDeadDebt,
  getRepaymentReport,
  draftDebtTicket,
  previewDebtTicket,
  listZoneEvidence,
  listDebtAttributions,
  getIssueCost,
  getGadgetData,
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
