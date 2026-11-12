import type { Repayment } from '../core/types';
import { round2 } from '../core/time';
import { jiraSendJson } from '../platform/jira';
import { route } from '@forge/api';

/**
 * Le bulletin de remboursement publié sur le ticket (§7.5, B19).
 *
 * « Huit semaines plus tard, un commentaire est publié sur le ticket : Avant :
 * 2,6 jours-personne par semaine sur la zone. Après : 0,7. Aucun incident
 * depuis la clôture. Comparaison avant/après, sans preuve de causalité. »
 *
 * Le commentaire porte toujours les limites : un bulletin n'est jamais une
 * preuve de causalité (§11), et c'est écrit dessus.
 *
 * TODO(integration) : le lot B expose `postRepaymentComment` dans
 * `src/platform` (`platform/jira.ts`) ; tant qu'elle n'y est pas, ce module
 * fait l'appel REST lui-même **sous le même nom**, pour que le branchement
 * final soit un seul import à changer.
 */

/** Publie un commentaire sur un ticket ; `false` si Jira a refusé. */
export async function postRepaymentComment(issueKey: string, body: string): Promise<boolean> {
  const sent = await jiraSendJson<{ id?: string }>(
    'POST',
    route`/rest/api/3/issue/${issueKey}/comment`,
    { body },
    'postRepaymentComment',
  );
  return sent.ok;
}

/** Texte du bulletin (§7.5) : avant, après, et ses limites. */
export function repaymentCommentText(repayment: Repayment): string {
  const lines = [
    `Avant : ${num(repayment.beforeRate)} j-p par semaine sur la zone « ${repayment.zone} ».`,
    `Après : ${num(repayment.afterRate)} j-p par semaine.`,
  ];
  if (repayment.afterRate <= 0) lines.push('Aucun incident relevé sur la zone depuis la clôture.');
  lines.push(limitLine(repayment.caveats));
  return lines.join('\n');
}

/** Texte du retrait d'un bulletin : la dette a été rouverte (§19 cas 8, B17). */
export function withdrawalCommentText(key: string): string {
  return (
    `Bulletin de remboursement retiré : ${key} a été rouverte. ` +
    'Le bulletin sera recalculé à la prochaine clôture.'
  );
}

/** Les limites du bulletin, sur une ligne : jamais une causalité affirmée. */
function limitLine(caveats: readonly string[]): string {
  const kept = caveats.filter((caveat) => caveat.trim().length > 0);
  if (kept.length === 0) return 'Comparaison avant/après, sans preuve de causalité.';
  return `Limites : ${kept.join(' ; ')}.`;
}

/** Nombre lisible en français, deux décimales au plus (comme les familles). */
function num(value: number): string {
  return String(round2(Number.isFinite(value) ? value : 0)).replace('.', ',');
}
