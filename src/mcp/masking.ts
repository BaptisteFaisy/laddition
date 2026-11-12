/**
 * Masquage des preuves que le lecteur ne peut pas ouvrir (§18, items D57/A4).
 *
 * Règle du cahier des charges : « les preuves issues de projets que le lecteur
 * ne voit pas sont **comptées**, mais affichées comme éléments masqués ».
 *
 * - comptées : elles restent dans la liste (l'addition et ses totaux les
 *   incluent déjà) et elles alimentent `hiddenCount` ;
 * - masquées : leur contenu identifiant disparaît — clé du ticket source,
 *   identifiant, formule et valeurs d'entrée, titre — tandis que ce qui reste
 *   agrégé (zone, famille, coût, date) suffit à afficher la ligne.
 *
 * Une seule implémentation : les actions MCP et les résolveurs d'écran passent
 * par ici, pour qu'un chiffre ne soit jamais plus bavard sur une surface que
 * sur l'autre.
 */

import type { Evidence, EvidenceDetail } from '../core/types';

/** Preuves rendues à un lecteur, et nombre de celles qui sont masquées. */
export interface MaskedEvidence {
  /** Même longueur que l'entrée : les masquées sont présentes, vidées. */
  evidence: Evidence[];
  /** Preuves comptées dans l'addition mais illisibles pour ce lecteur. */
  hiddenCount: number;
}

/** Texte qui remplace le contenu d'une preuve masquée. */
export const MASKED_FORMULA = 'preuve masquée : ticket hors des droits du lecteur';

/** Sépare et masque : les visibles telles quelles, les autres vidées de leur contenu. */
export function maskEvidence(items: readonly Evidence[]): MaskedEvidence {
  let hiddenCount = 0;
  const evidence = items.map((item) => {
    if (item.visible !== false) return item;
    hiddenCount += 1;
    return hiddenCopyOf(item);
  });
  return { evidence, hiddenCount };
}

/** Copie d'une preuve masquée : structure intacte, contenu identifiant retiré. */
function hiddenCopyOf(item: Evidence): Evidence {
  return {
    ...item,
    sourceKey: '',
    sourceIssueId: '',
    detail: hiddenDetailOf(item.detail),
  };
}

/** Détail d'une preuve masquée : plus de formule, plus de valeurs, plus de titre. */
function hiddenDetailOf(detail: EvidenceDetail): EvidenceDetail {
  return {
    durationDays: detail.durationDays,
    method: detail.method,
    formula: MASKED_FORMULA,
    inputs: {},
    familyLabel: detail.familyLabel,
  };
}
