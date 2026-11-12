import type { GadgetData, ProjectPageData } from './api';

/** Nombre de dettes affichées par le gadget. */
export const GADGET_TOP_DEBTS = 5;

/**
 * Ce que le gadget affiche, déduit du modèle de lecture complet du projet.
 *
 * Sert de repli tant que la clé réduite `getGadgetData` n'est pas exposée
 * (item D40) : même rendu, lecture plus lourde. Module pur, testable.
 */
export function dataOfPage(page: ProjectPageData): GadgetData {
  return {
    debts: page.ranking.slice(0, GADGET_TOP_DEBTS),
    costByTeam: page.costByTeam,
    costByQuarter: page.costByQuarter,
    demoData: page.settings.demoData,
  };
}
