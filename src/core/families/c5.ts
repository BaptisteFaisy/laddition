import type { CostContext, Evidence, IssueFact, IssueLink } from '../types';
import { diffDays, round2 } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/** Famille « retard induit » (§9, lot S) — un délai, jamais de l'effort. */
const FAMILY = 'C5' as const;
const FAMILY_LABEL = 'Retard induit (hors addition)';

/** Type de lien Jira qui exprime un blocage. */
const BLOCKS = 'blocks';

/** Un ticket bloqué et l'instant à partir duquel il l'a été. */
interface BlockedPair {
  blocked: IssueFact;
  blocker: IssueFact;
  /** Fin du blocage : résolution du ticket de dette, ou `now` s'il court encore. */
  blockedAt: string;
}

/**
 * C5 — retard induit (§9).
 *
 * Un ticket bloqué par un ticket de dette (`lien blocks`, de la dette vers le
 * ticket bloqué) subit un retard. Le coût retenu est le nombre de jours
 * calendaires passés bloqué, entre la résolution du ticket de dette et la
 * résolution du ticket bloqué (ou `now` s'il n'est pas encore résolu).
 *
 * C5 est **hors addition** : c'est un délai, pas un effort. Il ne doit jamais
 * être additionné aux familles C1-C4 (`BILLED_FAMILIES`) ; la preuve le
 * signale explicitement par `detail.inputs.delai = true` et son libellé.
 */
export function c5Delay(facts: IssueFact[], ctx: CostContext, links: IssueLink[]): Evidence[] {
  const factsById = new Map(facts.map((fact) => [fact.issueId, fact]));
  const debtIds = new Set(facts.filter((fact) => fact.isDebt).map((fact) => fact.issueId));
  const evidence: Evidence[] = [];
  for (const pair of blockedPairs(factsById, debtIds, links, ctx.now)) {
    const delai = blockedCalendarDays(pair, ctx.now);
    if (delai <= 0) continue;
    for (const share of splitAcrossZones(delai, zonesForIssue(pair.blocked, ctx.settings))) {
      evidence.push(buildEvidence(pair, share.zone, round2(share.costJp), delai));
    }
  }
  return evidence;
}

/**
 * Paires « bloqué / bloquant » déduites des liens `blocks` dont l'origine est
 * un ticket de dette. Les liens d'un autre type, les auto-liens et les tickets
 * inconnus sont ignorés.
 */
function blockedPairs(
  factsById: Map<string, IssueFact>,
  debtIds: Set<string>,
  links: IssueLink[],
  nowIso: string,
): BlockedPair[] {
  const pairs: BlockedPair[] = [];
  for (const link of links) {
    if (normalizeType(link.type) !== BLOCKS) continue;
    if (!debtIds.has(link.fromIssueId)) continue;
    if (link.fromIssueId === link.toIssueId) continue;
    const blocked = factsById.get(link.toIssueId);
    if (!blocked) continue;
    const blocker = factsById.get(link.fromIssueId);
    if (!blocker) continue;
    pairs.push({ blocked, blocker, blockedAt: blocker.resolvedAt ?? nowIso });
  }
  return pairs;
}

/** Normalise un type de lien Jira (`Blocks`, `blocks ` … → `blocks`). */
function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

/**
 * Jours calendaires passés bloqué : de la résolution du ticket de dette à la
 * résolution du ticket bloqué, ou à `now` tant qu'il n'est pas résolu. Le
 * blocage ne peut pas commencer avant la création du ticket bloqué.
 */
function blockedCalendarDays(pair: BlockedPair, nowIso: string): number {
  const end = pair.blocked.resolvedAt ?? nowIso;
  const from = pair.blockedAt > pair.blocked.createdAt ? pair.blockedAt : pair.blocked.createdAt;
  return round2(Math.max(0, diffDays(from, end)));
}

/** Construit la preuve d'une zone du ticket bloqué. */
function buildEvidence(pair: BlockedPair, zone: string, costJp: number, delai: number): Evidence {
  const { blocked, blocker } = pair;
  return {
    id: `${FAMILY}:${blocked.issueId}:${zone}`,
    zone,
    family: FAMILY,
    sourceIssueId: blocked.issueId,
    sourceKey: blocked.key,
    occurredAt: pair.blockedAt,
    costJp,
    method: 'computed',
    visible: blocked.visible,
    detail: {
      durationDays: delai,
      method: 'computed',
      formula: formulaFor(blocked, blocker, zone, costJp, delai),
      inputs: { delai: true, joursBloques: delai, ticketBloquant: blocker.key },
      familyLabel: FAMILY_LABEL,
      sourceSummary: blocked.visible ? blocked.summary : undefined,
    },
  };
}

/** Texte de formule lisible : le délai n'entre jamais dans l'addition. */
function formulaFor(
  blocked: IssueFact,
  blocker: IssueFact,
  zone: string,
  costJp: number,
  delai: number,
): string {
  const fin = blocked.resolvedAt ? `résolution du ${blocked.resolvedAt.slice(0, 10)}` : 'aujourd’hui (non résolu)';
  return (
    `Bloqué par ${blocker.key} (ticket de dette) : ${delai} jours calendaires` +
    ` jusqu’à la ${fin} ; part de la zone « ${zone} » : ${costJp} jours de retard.` +
    ` Délai, pas effort : hors addition.`
  );
}
