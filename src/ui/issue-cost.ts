import type { DebtBillView, IssueCost } from './api';

/**
 * Ce que le champ personnalisé affiche, déduit d'une addition complète.
 *
 * Sert de repli tant que la clé réduite `getIssueCost` n'est pas exposée
 * (item D39) : même rendu, lecture plus lourde. Module pur, testable.
 */
export function costOfBill(view: DebtBillView): IssueCost {
  const families = Object.values(view.bill.byFamily);
  return {
    lowJp: view.bill.lowJp,
    highJp: view.bill.highJp,
    days: view.settings.windowDays,
    insufficient: families.some((family) => family.insufficient),
    demoData: view.settings.demoData,
  };
}
