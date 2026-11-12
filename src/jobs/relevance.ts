import type { Evidence, IssueFact, RelevanceScore } from '../core/types';
import { BILLED_FAMILIES } from '../core/types';
import type { ScoreCache } from '../platform/llm';
import { scoreRelevance } from '../platform/llm';
import type { Deadline } from './deadline';
import type { CallGuard } from './llmGuard';

/**
 * Scores de pertinence du modèle, en amont du calcul nocturne (§10, §18).
 *
 * Le domaine reste pur : `core/attribution.ts` reçoit des scores déjà calculés.
 * Ici on décide seulement *quels couples* valent un appel au modèle — ceux qui
 * partagent une zone et qu'aucun lien n'explique — et on borne le budget.
 *
 * Deux bornes s'ajoutent (C30, C31) :
 * - le **cache persistant** (`score_cache`, chargé par l'appelant) : un couple
 *   dont les textes n'ont pas changé n'est jamais repayé ;
 * - le **garde de débit** : au plus `LLM_CALLS_PER_MINUTE` appels par minute
 *   (§17), et la garde de durée rend la main quand le budget de temps est fini.
 */

/** Tickets de dette comparés à une même preuve. */
const MAX_DEBTS_PER_EVIDENCE = 5;

/** Plafond d'appels au modèle par recalcul : le budget LLM est fini (§18). */
const MAX_SCORED_PAIRS = 300;

/** Garde-fous du score : débit du modèle et budget de temps. */
export interface ScoringOptions {
  /** Garde de débit (§17) ; absent, les appels s'enchaînent. */
  guard?: CallGuard;
  /** Garde de durée (§15) ; absent, on va au bout du budget de couples. */
  deadline?: Deadline;
}

/**
 * Note chaque couple (preuve, dette) candidat. C5 est écartée : un délai n'est
 * pas un effort à imputer. Le cache évite de repayer un couple déjà évalué.
 */
export async function scoreCandidates(
  evidence: Evidence[],
  debts: IssueFact[],
  cache: ScoreCache,
  options: ScoringOptions = {},
): Promise<RelevanceScore[]> {
  const scores: RelevanceScore[] = [];
  for (const item of evidence) {
    if (!BILLED_FAMILIES.includes(item.family)) continue;
    if (item.costJp <= 0) continue;
    for (const debt of candidatesFor(item, debts)) {
      if (scores.length >= MAX_SCORED_PAIRS) return scores;
      if (options.deadline?.expired()) return scores;
      const scored = await scorePair(item, debt, cache, options.guard);
      scores.push({
        evidenceId: item.id,
        debtIssueId: debt.issueId,
        relevance: scored.relevance,
        rationale: scored.rationale,
        fingerprint: scored.fingerprint,
      });
    }
  }
  return scores;
}

/** Un couple noté, en respectant le débit du modèle. */
async function scorePair(
  item: Evidence,
  debt: IssueFact,
  cache: ScoreCache,
  guard?: CallGuard,
): Promise<{ relevance: number; rationale: string; fingerprint: string }> {
  if (guard) await guard.beforeCall();
  return scoreRelevance(evidenceText(item), debtText(debt), cache);
}

/** Dettes de la même zone, par clé croissante : l'ordre ne dépend d'aucun hasard. */
function candidatesFor(item: Evidence, debts: IssueFact[]): IssueFact[] {
  return debts
    .filter((debt) => debt.zones.includes(item.zone))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, MAX_DEBTS_PER_EVIDENCE);
}

/** Texte comparé pour une preuve : sa formule et son origine, rien de plus. */
function evidenceText(item: Evidence): string {
  return `${item.sourceKey} ${item.detail.familyLabel} ${item.detail.formula}`;
}

/** Texte comparé pour un ticket de dette : son titre et son corps. */
function debtText(debt: IssueFact): string {
  return `${debt.key} ${debt.summary} ${debt.description ?? ''}`;
}
