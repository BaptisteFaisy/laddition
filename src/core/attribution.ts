import type {
  Attribution,
  AttributionBasis,
  Evidence,
  IssueFact,
  IssueLink,
  ProjectSettings,
  RelevanceScore,
  Rejection,
} from './types.ts';
import { clamp, round2 } from './time.ts';

/**
 * §10 « Attribution » : à quel ticket de dette chaque preuve est imputée.
 *
 * Trois bases, de la plus forte à la plus faible :
 * - `link` : un lien Jira explicite relie la preuve au ticket → 100 %, fourchette
 *   basse ET haute (le rapprochement est un fait, pas une hypothèse) ;
 * - `confirmed` : un humain a confirmé le rapprochement → 100 %, basse et haute ;
 * - `inferred` : même zone, aucun lien → partage au prorata de la pertinence,
 *   fourchette HAUTE seulement (voir `isHighBandOnly`).
 *
 * Aucune preuve n'est comptée deux fois : la somme des parts d'une preuve vaut
 * exactement 1,00 quand elle est attribuée, et 0 quand elle ne l'est pas.
 */

/** Confirmation humaine d'un rapprochement (§10, règle 2). */
export interface Confirmation {
  evidenceId: string;
  debtIssueId: string;
  /** Auteur de la confirmation, repris tel quel dans la justification. */
  by?: string;
}

/** Types de lien Jira qui valent lien explicite (§10, règle 7). */
export const EXPLICIT_LINK_TYPES: readonly string[] = ['relates to', 'caused by', 'blocks'];

/** Seuil de pertinence utilisé si le projet n'en fournit pas. */
const DEFAULT_RELEVANCE_FLOOR = 0.3;

/**
 * Vrai quand l'attribution n'alimente que la fourchette haute.
 * Seul le partage déduit (`inferred`) est une hypothèse : un lien ou une
 * confirmation alimente aussi la fourchette basse.
 */
export function isHighBandOnly(attribution: Attribution): boolean {
  return attribution.basis === 'inferred';
}

/**
 * Impute les preuves aux tickets de dette.
 *
 * @param links Liens Jira connus. Omis (`undefined`), la fonction retombe sur
 *   les liens implicites portés par les scores (pertinence de 1).
 * @param confirmations Rapprochements confirmés par un humain (7e position).
 */
export function attributeEvidence(
  evidence: Evidence[],
  debts: IssueFact[],
  scores: RelevanceScore[],
  rejections: Rejection[],
  settings: ProjectSettings,
  links?: IssueLink[],
  confirmations?: Confirmation[],
): Attribution[] {
  const context = buildContext(debts, scores, rejections, settings, links, confirmations);
  const result: Attribution[] = [];
  for (const item of evidence) {
    result.push(...attributeOne(item, context));
  }
  return sortAttributions(result);
}

/** Contexte interne : index construits une fois pour toutes les preuves. */
interface AttributionContext {
  debts: IssueFact[];
  rejected: Set<string>;
  scores: Map<string, RelevanceScore>;
  confirmations: Map<string, Confirmation>;
  /** `source → dette` vers type de lien normalisé. */
  links: Map<string, string>;
  useImplicitLinks: boolean;
  floor: number;
}

function buildContext(
  debts: IssueFact[],
  scores: RelevanceScore[],
  rejections: Rejection[],
  settings: ProjectSettings,
  links: IssueLink[] | undefined,
  confirmations: Confirmation[] | undefined,
): AttributionContext {
  const uniqueDebts = new Map<string, IssueFact>();
  for (const debt of debts) {
    if (!uniqueDebts.has(debt.issueId)) uniqueDebts.set(debt.issueId, debt);
  }
  const scoreIndex = new Map<string, RelevanceScore>();
  for (const score of scores) scoreIndex.set(pairKey(score.evidenceId, score.debtIssueId), score);
  const confirmationIndex = new Map<string, Confirmation>();
  for (const confirmation of confirmations ?? []) {
    confirmationIndex.set(pairKey(confirmation.evidenceId, confirmation.debtIssueId), confirmation);
  }
  const rejected = new Set<string>();
  for (const rejection of rejections) rejected.add(pairKey(rejection.evidenceId, rejection.debtIssueId));
  const floor = Number.isFinite(settings.relevanceFloor) ? settings.relevanceFloor : DEFAULT_RELEVANCE_FLOOR;
  return {
    debts: Array.from(uniqueDebts.values()),
    rejected,
    scores: scoreIndex,
    confirmations: confirmationIndex,
    links: linkIndex(links ?? []),
    useImplicitLinks: links === undefined,
    floor,
  };
}

/** Attributions d'une preuve : lien ou confirmation d'abord, partage ensuite. */
function attributeOne(item: Evidence, context: AttributionContext): Attribution[] {
  const strong = strongAttributions(item, context);
  if (strong.length > 0) return equalShares(strong);
  return inferredAttributions(item, context);
}

/** Liens explicites et confirmations humaines, rejets déjà écartés. */
function strongAttributions(item: Evidence, context: AttributionContext): Attribution[] {
  const found: Attribution[] = [];
  for (const debt of context.debts) {
    const key = pairKey(item.id, debt.issueId);
    if (context.rejected.has(key)) continue;
    const confirmation = context.confirmations.get(key);
    if (confirmation) {
      found.push(makeAttribution(item.id, debt.issueId, 'confirmed', confirmationRationale(confirmation)));
      continue;
    }
    const linkType = context.links.get(pairKey(item.sourceIssueId, debt.issueId));
    if (linkType) {
      found.push(makeAttribution(item.id, debt.issueId, 'link', linkRationale(linkType)));
      continue;
    }
    if (!context.useImplicitLinks) continue;
    const score = context.scores.get(key);
    if (score && normalizedRelevance(score) >= 1) {
      found.push(makeAttribution(item.id, debt.issueId, 'link', implicitLinkRationale(score)));
    }
  }
  return found;
}

/** Partage entre les dettes de la zone, au prorata de la pertinence (§10 règle 3). */
function inferredAttributions(item: Evidence, context: AttributionContext): Attribution[] {
  const candidates = scoredZoneDebts(item, context);
  if (candidates.length === 0) return [];
  const shares = normalizeShares(candidates.map((candidate) => candidate.relevance));
  return candidates.map((candidate, index) => ({
    evidenceId: item.id,
    debtIssueId: candidate.debtIssueId,
    share: shares[index] ?? 0,
    basis: 'inferred' as AttributionBasis,
    relevance: candidate.relevance,
    rationale: candidate.rationale,
  }));
}

/** Dettes de la même zone dont la pertinence atteint le seuil du projet. */
function scoredZoneDebts(
  item: Evidence,
  context: AttributionContext,
): Array<{ debtIssueId: string; relevance: number; rationale: string }> {
  const picked: Array<{ debtIssueId: string; relevance: number; rationale: string }> = [];
  for (const debt of context.debts) {
    if (!debt.zones.includes(item.zone)) continue;
    const key = pairKey(item.id, debt.issueId);
    if (context.rejected.has(key)) continue;
    const score = context.scores.get(key);
    if (!score) continue;
    const relevance = normalizedRelevance(score);
    if (!(relevance >= context.floor)) continue;
    picked.push({ debtIssueId: debt.issueId, relevance, rationale: score.rationale });
  }
  return picked.sort((a, b) => compareIds(a.debtIssueId, b.debtIssueId));
}

/** Construit une attribution pleine (100 %, pertinence 1), avant répartition. */
function makeAttribution(
  evidenceId: string,
  debtIssueId: string,
  basis: AttributionBasis,
  rationale: string,
): Attribution {
  return { evidenceId, debtIssueId, share: 1, basis, relevance: 1, rationale };
}

/** Plusieurs rapprochements forts sur une même preuve : parts égales. */
function equalShares(list: Attribution[]): Attribution[] {
  const shares = normalizeShares(list.map(() => 1));
  return list.map((attribution, index) => ({ ...attribution, share: shares[index] ?? 0 }));
}

/** Répartit 1,00 au prorata des valeurs, arrondi au centième. */
function normalizeShares(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (values.length === 0 || total <= 0) return values.map(() => 0);
  const shares = values.map((value) => round2(Math.max(0, value) / total));
  return closeToOne(shares);
}

/** Corrige la dernière part pour que la somme fasse exactement 1,00. */
function closeToOne(shares: number[]): number[] {
  if (shares.length === 0) return shares;
  const drift = round2(1 - shares.reduce((sum, share) => sum + share, 0));
  if (drift === 0) return shares;
  const target = shares.length - 1;
  const adjusted = round2((shares[target] as number) + drift);
  if (adjusted >= 0) {
    shares[target] = adjusted;
    return shares;
  }
  shares[target] = 0;
  const donor = largestIndex(shares);
  shares[donor] = round2((shares[donor] as number) + adjusted);
  return shares;
}

/** Indice de la plus grosse part ; 0 pour une liste vide. */
function largestIndex(shares: number[]): number {
  let index = 0;
  for (let cursor = 1; cursor < shares.length; cursor += 1) {
    if ((shares[cursor] as number) > (shares[index] as number)) index = cursor;
  }
  return index;
}

/** Index des liens explicites, dans les deux sens de lecture. */
function linkIndex(links: IssueLink[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const link of links) {
    const type = link.type.trim().toLowerCase();
    if (!EXPLICIT_LINK_TYPES.includes(type)) continue;
    rememberLink(index, pairKey(link.fromIssueId, link.toIssueId), type);
    rememberLink(index, pairKey(link.toIssueId, link.fromIssueId), type);
  }
  return index;
}

/** Enregistre un lien ; le premier rencontré gagne (ordre d'entrée stable). */
function rememberLink(index: Map<string, string>, key: string, type: string): void {
  if (!index.has(key)) index.set(key, type);
}

/** Clé de couple preuve/dette, sans collision possible. */
function pairKey(evidenceId: string, debtIssueId: string): string {
  return `${evidenceId}\u0000${debtIssueId}`;
}

/** Pertinence ramenée dans [0, 1] et arrondie au centième. */
function normalizedRelevance(score: RelevanceScore): number {
  return round2(clamp(score.relevance, 0, 1));
}

/** Comparaison binaire, insensible à la locale : ordre stable (§18). */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Ordre de sortie stable : par preuve puis par ticket de dette. */
function sortAttributions(list: Attribution[]): Attribution[] {
  return list
    .slice()
    .sort((a, b) => compareIds(a.evidenceId, b.evidenceId) || compareIds(a.debtIssueId, b.debtIssueId));
}

/** Justification d'un lien explicite (§10, règle 9). */
function linkRationale(type: string): string {
  return `Lien Jira explicite (${type})`;
}

/** Justification d'une confirmation humaine (§10, règle 9). */
function confirmationRationale(confirmation: Confirmation): string {
  const author = confirmation.by?.trim();
  return `Rapprochement confirmé par ${author && author.length > 0 ? author : 'un humain'}`;
}

/** Justification d'un lien implicite : celle du score, à défaut un libellé sûr. */
function implicitLinkRationale(score: RelevanceScore): string {
  const text = score.rationale.trim();
  return text.length > 0 ? text : 'Lien Jira explicite (relates to)';
}
