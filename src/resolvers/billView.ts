import type { Request } from '@forge/resolver';
import type { Attribution, AttributionBasis, DebtBill, Evidence, Family, FamilyTotal, IssueFact } from '../core/types';
import { BILLED_FAMILIES } from '../core/types';
import { round2 } from '../core/time';
import { getBill, getIssueFact } from '../platform/db/index';
import { maskEvidence } from '../mcp/masking';
import type { Failure } from '../jobs/support';
import { guard, nowIso, payloadOf, requireString } from '../jobs/support';
import { evidenceOfBill } from './read';
import type { ProjectState } from './state';
import { loadState, withReaderRights } from './state';

/**
 * L'addition d'un ticket, telle que le panneau la montre (écran 2).
 *
 * Rien n'est recalculé : l'addition sort de `debt_bill`, les preuves de
 * `evidence`. Ce fichier ne fait que rapprocher les deux et préparer les
 * propositions de rapprochement (§10) et le rattachement d'un ticket qui n'est
 * pas la dette elle-même (écran 3).
 *
 * Deux exigences d'audit (items D57/A4) y sont appliquées à la lecture :
 * - les **parts d'attribution** sont exposées (`shares`), pour que la recette
 *   §20 n° 2 soit vérifiable à l'écran : un incident partagé entre deux dettes
 *   montre sa part, et la somme des parts ne dépasse pas 100 % ;
 * - `hiddenCount` est **réel** : les preuves que ce lecteur ne peut pas ouvrir
 *   sont comptées mais masquées (§18) — leur contenu (clé source, formule,
 *   valeurs) ne quitte pas le serveur, seule leur ligne chiffrée reste.
 */

/** Part d'une preuve imputée à cette dette, et total toutes dettes confondues. */
export interface EvidenceShare {
  evidenceId: string;
  /** Clé du ticket source ; vide quand la preuve est masquée (§18). */
  sourceKey: string;
  family: Family;
  costJp: number;
  /** Part imputée à cette dette (0 à 1). */
  share: number;
  basis: AttributionBasis;
  relevance: number;
  /** Somme des parts de cette preuve sur toutes les dettes : ≤ 1 (§5, règle 3). */
  totalShare: number;
}

/** Un rapprochement proposé, en attente de confirmation humaine (§10). */
export interface PendingMatch {
  evidenceId: string;
  sourceKey: string;
  sourceSummary: string | null;
  zone: string;
  family: Family;
  costJp: number;
  relevance: number;
  rationale: string;
}

/** Contexte d'attribution d'un ticket : ce qu'il alimente, ou à quoi il ressemble. */
export interface IssueAttribution {
  feeds: { key: string; zone: string } | null;
  proposal: { evidenceId: string; debtIssueId: string; key: string; zone: string; relevance: number } | null;
}

/** Tout ce que le panneau d'une dette affiche. */
export interface DebtBillView {
  settings: ProjectState['settings'];
  /** Zone du ticket de dette ; vide quand il n'en a pas (§19). */
  zone: string;
  /** Addition enregistrée, avec `hiddenCount` recalé sur les preuves rendues. */
  bill: DebtBill;
  /** Preuves de l'addition ; celles hors des droits du lecteur sont masquées. */
  evidence: Evidence[];
  /** Preuves comptées mais masquées pour ce lecteur (§18) : jamais leur contenu. */
  hiddenCount: number;
  /**
   * Vrai quand la lecture des droits du lecteur a échoué (item 4, §18) : rien
   * n'a pu être masqué à ce titre — le trou est signalé, jamais silencieux.
   */
  visibilityUnchecked: boolean;
  /** Parts d'attribution des preuves de cette dette (recette §20 n° 2). */
  shares: EvidenceShare[];
  pendingMatches: PendingMatch[];
  /** Renseigné pour un ticket qui n'est pas la dette elle-même. */
  attribution: IssueAttribution | null;
}

/** Écran 2 et 3 : addition d'un ticket de dette, ou rattachement d'un autre ticket. */
export async function getDebtBill(request: Request<unknown>): Promise<DebtBillView | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const debtIssueId = requireString(payload, 'debtIssueId');
    const stored = await getBill(debtIssueId);
    const projectId = await projectOfBill(debtIssueId, payload);
    const state = await loadState(projectId, nowIso());
    const fact = state.facts.find((item) => item.issueId === debtIssueId) ?? null;
    const bill = stored ?? emptyBill(fact, debtIssueId, nowIso());
    // Item 4 (§18) : les preuves que ce lecteur ne peut pas ouvrir sont
    // marquées `visible: false` avant le masquage ; une lecture des droits en
    // échec ne masque rien mais laisse `visibilityUnchecked` à vrai.
    const rights = await withReaderRights(await evidenceOfBill(projectId, bill.evidenceIds));
    const masked = maskEvidence(rights.evidence);
    return {
      settings: state.settings,
      zone: fact?.zones[0] ?? '',
      // `hiddenCount` réel : compté sur les preuves effectivement rendues, pas
      // sur la seule valeur écrite la nuit dernière (item D57/A4).
      bill: { ...bill, hiddenCount: masked.hiddenCount },
      evidence: masked.evidence,
      hiddenCount: masked.hiddenCount,
      visibilityUnchecked: !rights.checked,
      shares: sharesOf(state.attributions, masked.evidence, debtIssueId),
      pendingMatches: pendingMatchesOf(state, debtIssueId),
      attribution: fact && !fact.isDebt ? attributionOf(state, fact) : null,
    };
  });
}

/** Projet d'une addition : le ticket en base, à défaut le payload. */
async function projectOfBill(
  debtIssueId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const fact = await getIssueFact(debtIssueId);
  const direct = payload['projectId'];
  if (fact) return fact.projectId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  throw new Error(`ticket ${debtIssueId} inconnu : lancer l'initialisation`);
}

/**
 * Addition vide d'un ticket qui n'en a pas (jamais calculé, ou pas une dette).
 * Zéro partout, `computedAt` à l'instant de lecture : l'écran affiche
 * « pas encore d'addition » au lieu d'une erreur.
 */
export function emptyBill(fact: IssueFact | null, issueId: string, now: string): DebtBill {
  const byFamily = {} as Record<Family, FamilyTotal>;
  for (const family of BILLED_FAMILIES) {
    byFamily[family] = { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false };
  }
  return {
    debtIssueId: issueId,
    key: fact?.key ?? issueId,
    computedAt: now,
    lowJp: 0,
    highJp: 0,
    byFamily,
    evidenceIds: [],
    hiddenCount: 0,
    repaymentJp: null,
    avoidableJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
  };
}

/** Rapprochements déduits, au-dessus du seuil, pas encore tranchés par un humain. */
function pendingMatchesOf(state: ProjectState, debtIssueId: string): PendingMatch[] {
  const evidenceById = new Map(state.evidence.map((item) => [item.id, item]));
  const rows: PendingMatch[] = [];
  for (const attribution of state.attributions) {
    if (attribution.debtIssueId !== debtIssueId) continue;
    if (attribution.basis !== 'inferred') continue;
    if (attribution.relevance < state.settings.relevanceFloor) continue;
    const evidence = evidenceById.get(attribution.evidenceId);
    if (!evidence) continue;
    rows.push({
      evidenceId: evidence.id,
      sourceKey: evidence.sourceKey,
      sourceSummary: evidence.visible ? evidence.detail.sourceSummary ?? null : null,
      zone: evidence.zone,
      family: evidence.family,
      costJp: evidence.costJp,
      relevance: attribution.relevance,
      rationale: attribution.rationale,
    });
  }
  return rows.sort((a, b) => (b.costJp !== a.costJp ? b.costJp - a.costJp : a.sourceKey.localeCompare(b.sourceKey)));
}

/** Ce qu'un ticket alimente déjà, et à quelle dette il ressemble le plus. */
function attributionOf(state: ProjectState, fact: IssueFact): IssueAttribution {
  const byEvidence = new Map(state.evidence.map((item) => [item.id, item]));
  const keyOf = new Map(state.debts.map((debt) => [debt.issueId, debt.key]));
  const mine = state.attributions.filter((item) => byEvidence.get(item.evidenceId)?.sourceIssueId === fact.issueId);
  const feeds = mine.find((item) => item.basis === 'link' || item.basis === 'confirmed') ?? null;
  const proposal = mine
    .filter((item) => item.basis === 'inferred' && item.relevance >= state.settings.relevanceFloor)
    .sort((a, b) => b.relevance - a.relevance)[0] ?? null;
  return { feeds: feeds ? toFeed(feeds, byEvidence, keyOf) : null, proposal: proposal ? toProposal(proposal, byEvidence, keyOf) : null };
}

/** Rattachement confirmé : la dette et sa zone. */
function toFeed(
  attribution: Attribution,
  byEvidence: Map<string, Evidence>,
  keyOf: Map<string, string>,
): { key: string; zone: string } {
  return { key: keyOf.get(attribution.debtIssueId) ?? attribution.debtIssueId, zone: byEvidence.get(attribution.evidenceId)?.zone ?? '' };
}

/** Proposition à confirmer : la preuve, la dette, le score. */
function toProposal(
  attribution: Attribution,
  byEvidence: Map<string, Evidence>,
  keyOf: Map<string, string>,
): IssueAttribution['proposal'] {
  return {
    evidenceId: attribution.evidenceId,
    debtIssueId: attribution.debtIssueId,
    key: keyOf.get(attribution.debtIssueId) ?? attribution.debtIssueId,
    zone: byEvidence.get(attribution.evidenceId)?.zone ?? '',
    relevance: attribution.relevance,
  };
}

/**
 * Parts d'attribution des preuves de cette addition (item D57/A4).
 *
 * Une ligne par preuve rattachée à la dette : sa part, sa base, et la somme des
 * parts de cette preuve sur **toutes** les dettes — c'est ce total qui permet de
 * vérifier la recette §20 n° 2 (« la somme des parts ne dépasse pas 100 % »).
 * Une preuve sans part enregistrée n'apparaît pas : on ne l'invente pas.
 */
function sharesOf(
  attributions: readonly Attribution[],
  evidence: readonly Evidence[],
  debtIssueId: string,
): EvidenceShare[] {
  const totals = totalShareByEvidence(attributions);
  const rows: EvidenceShare[] = [];
  for (const item of evidence) {
    const mine = attributions.find(
      (attribution) => attribution.evidenceId === item.id && attribution.debtIssueId === debtIssueId,
    );
    if (!mine) continue;
    rows.push({
      evidenceId: item.id,
      sourceKey: item.sourceKey,
      family: item.family,
      costJp: item.costJp,
      share: mine.share,
      basis: mine.basis,
      relevance: mine.relevance,
      totalShare: round2(totals.get(item.id) ?? mine.share),
    });
  }
  return rows;
}

/** Somme des parts de chaque preuve, toutes dettes confondues. */
function totalShareByEvidence(attributions: readonly Attribution[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const attribution of attributions) {
    totals.set(attribution.evidenceId, (totals.get(attribution.evidenceId) ?? 0) + attribution.share);
  }
  return totals;
}
