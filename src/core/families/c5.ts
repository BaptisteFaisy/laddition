import type { CostContext, Evidence, IssueFact, IssueLink } from '../types';
import { diffDays, round2 } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/** Famille « retard induit » (§9, lot S) — un délai, jamais de l'effort. */
const FAMILY = 'C5' as const;
const FAMILY_LABEL = 'Retard induit (hors addition)';

/** Type de lien Jira qui exprime un blocage. */
const BLOCKS = 'blocks';

/** Un ticket bloqué, la dette qui le bloque, et la fenêtre de blocage mesurée. */
interface BlockedPair {
  blocked: IssueFact;
  blocker: IssueFact;
  /** Début retenu du blocage, jamais avant la création des deux tickets. */
  from: string;
  /** Fin du blocage : la dette est résolue, ou le ticket bloqué l'est, ou `now`. */
  to: string;
}

/**
 * C5 — retard induit (§9).
 *
 * Un ticket bloqué par un ticket de dette (lien `blocks`, de la dette vers le
 * ticket bloqué) subit un retard. Le chiffre retenu est le nombre de jours
 * calendaires passés bloqué **pendant que la dette était ouverte** : depuis la
 * création du ticket bloqué (jamais avant celle de la dette) jusqu'à la
 * résolution de la dette, ou jusqu'à la résolution du ticket bloqué s'il a été
 * débloqué avant, ou jusqu'à `now` quand les deux courent encore.
 *
 * Une dette encore ouverte et un ticket encore bloqué produisent donc bien un
 * retard — le retard s'accumule, il n'attend pas la clôture de la dette.
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
    const delai = blockedCalendarDays(pair);
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
    const blocker = factsById.get(link.fromIssueId);
    if (!blocked || !blocker) continue;
    pairs.push(windowOf(blocked, blocker, nowIso));
  }
  return pairs;
}

/**
 * Fenêtre de blocage : le blocage ne peut pas commencer avant la création du
 * ticket bloqué ni avant celle de la dette, et s'arrête au premier des deux
 * événements qui le termine — la dette résolue, le ticket bloqué résolu, ou
 * `now` quand rien n'est encore terminé.
 */
function windowOf(blocked: IssueFact, blocker: IssueFact, nowIso: string): BlockedPair {
  return {
    blocked,
    blocker,
    from: latest(blocked.createdAt, blocker.createdAt),
    to: earliest(blocked.resolvedAt ?? nowIso, blocker.resolvedAt ?? nowIso),
  };
}

/** Normalise un type de lien Jira (`Blocks`, `blocks ` … → `blocks`). */
function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

/** Jours calendaires de la fenêtre de blocage, jamais négatifs. */
function blockedCalendarDays(pair: BlockedPair): number {
  return round2(Math.max(0, diffDays(pair.from, pair.to)));
}

/** La plus récente des deux dates ISO. */
function latest(a: string, b: string): string {
  return a > b ? a : b;
}

/** La plus ancienne des deux dates ISO. */
function earliest(a: string, b: string): string {
  return a < b ? a : b;
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
    occurredAt: pair.to,
    costJp,
    method: 'computed',
    visible: blocked.visible,
    detail: {
      durationDays: delai,
      method: 'computed',
      formula: formulaFor(pair, zone, costJp, delai),
      inputs: {
        delai: true,
        joursBloques: delai,
        ticketBloquant: blocker.key,
        detteEncoreOuverte: blocker.resolvedAt === null,
      },
      familyLabel: FAMILY_LABEL,
      sourceSummary: blocked.visible ? blocked.summary : undefined,
    },
  };
}

/** Texte de formule lisible : le délai n'entre jamais dans l'addition. */
function formulaFor(pair: BlockedPair, zone: string, costJp: number, delai: number): string {
  return (
    `Bloqué par ${pair.blocker.key} (ticket de dette) : ${delai} jours calendaires passés bloqué` +
    ` pendant que la dette était ouverte (du ${day(pair.from)} ${endLabel(pair)}) ;` +
    ` part de la zone « ${zone} » : ${costJp} jours de retard.` +
    ` Délai, pas effort : hors addition.`
  );
}

/**
 * Ce qui a mis fin au blocage, en clair : la dette résolue, le ticket bloqué
 * résolu le premier, ou rien encore — le retard continue de courir.
 */
function endLabel(pair: BlockedPair): string {
  const { blocked, blocker } = pair;
  const debtEnd = blocker.resolvedAt;
  const ticketEnd = blocked.resolvedAt;
  if (debtEnd === null && ticketEnd === null) return "jusqu'à aujourd'hui, blocage toujours en cours";
  if (debtEnd === null) return `jusqu'à la résolution du ticket bloqué le ${day(ticketEnd)}`;
  if (ticketEnd === null) return `jusqu'à la résolution de la dette le ${day(debtEnd)}`;
  return ticketEnd <= debtEnd
    ? `jusqu'à la résolution du ticket bloqué le ${day(ticketEnd)}`
    : `jusqu'à la résolution de la dette le ${day(debtEnd)}`;
}

/** Date ISO réduite au jour, pour la formule affichée. */
function day(iso: string | null): string {
  return iso === null ? 'aujourd’hui' : iso.slice(0, 10);
}
