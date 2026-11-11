/**
 * Famille C1 — incidents (§9).
 *
 * Un incident coûte sa durée de résolution en jours ouvrés, multipliée par le
 * nombre d'intervenants plafonné par `settings.maxIncidentPeople`. Le temps
 * saisi, quand il existe, remplace ce calcul ; un post-mortem lié ajoute un
 * bonus forfaitaire. Le coût est ensuite partagé entre les zones du ticket (§8).
 *
 * Fonction pure : l'instant de référence vient de `ctx.now`, aucune I/O.
 */

import type { CostContext, CostMethod, Evidence, EvidenceDetail, IssueFact, ProjectSettings } from '../types';
import { addDays, businessDaysBetween, parseIso, round2, secondsToJp } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/** Nom lisible de la famille, affiché dans le détail d'une preuve. */
const FAMILY_LABEL = 'Incidents';

/** Coût d'un incident avant partage entre ses zones. */
interface IncidentCost {
  costJp: number;
  method: CostMethod;
  /** Intervenants effectivement comptés, après plafond. */
  people: number;
  /** Plafond appliqué, rappelé dans le détail. */
  cap: number;
}

/**
 * Preuves C1 d'un lot de tickets : une preuve par zone et par incident retenu.
 * Retenus : incidents dont la date d'occurrence (résolution, sinon création)
 * tombe dans la fenêtre d'analyse.
 */
export function c1Incidents(facts: IssueFact[], ctx: CostContext): Evidence[] {
  const windowStart = addDays(ctx.now, -ctx.settings.windowDays);
  const evidence: Evidence[] = [];

  for (const fact of facts) {
    if (!fact.isIncident) continue;
    if (!occurredInWindow(fact, windowStart, ctx.now)) continue;

    const durationDays = businessDaysBetween(fact.createdAt, fact.resolvedAt ?? ctx.now);
    const cost = incidentCost(fact, durationDays, ctx.settings);
    const detail = buildDetail(fact, durationDays, cost, ctx.settings, ctx.now);

    for (const share of splitAcrossZones(cost.costJp, zonesForIssue(fact, ctx.settings))) {
      evidence.push({
        id: `C1:${fact.issueId}:${share.zone}`,
        zone: share.zone,
        family: 'C1',
        sourceIssueId: fact.issueId,
        sourceKey: fact.key,
        occurredAt: fact.resolvedAt ?? fact.createdAt,
        costJp: round2(Math.max(0, share.costJp)),
        method: cost.method,
        visible: fact.visible,
        detail,
      });
    }
  }

  return evidence;
}

/** Vrai quand la date d'occurrence du ticket tombe dans [début de fenêtre, now]. */
function occurredInWindow(fact: IssueFact, windowStartIso: string, nowIso: string): boolean {
  const at = parseIso(fact.resolvedAt ?? fact.createdAt);
  const start = parseIso(windowStartIso);
  const end = parseIso(nowIso);
  if (!at || !start || !end) return false;
  return at.getTime() >= start.getTime() && at.getTime() <= end.getTime();
}

/**
 * Coût d'un incident : durée × intervenants plafonnés, remplacé par le temps
 * saisi quand il existe, puis majoré du bonus post-mortem. Jamais négatif.
 */
function incidentCost(fact: IssueFact, durationDays: number, settings: ProjectSettings): IncidentCost {
  const cap = Math.max(0, settings.maxIncidentPeople);
  const people = Math.min(Math.max(0, fact.participants), cap);
  const loggedJp = secondsToJp(fact.loggedSeconds, settings.hoursPerDay);
  const baseJp = loggedJp === null ? Math.max(0, durationDays) * people : loggedJp;
  const withBonus = fact.hasPostMortem ? baseJp + Math.max(0, settings.postMortemBonusJp) : baseJp;

  return {
    costJp: round2(Math.max(0, withBonus)),
    method: loggedJp === null ? 'computed' : 'logged',
    people,
    cap,
  };
}

/** Détail affiché au clic : formule, valeurs d'entrée, source. */
function buildDetail(
  fact: IssueFact,
  durationDays: number,
  cost: IncidentCost,
  settings: ProjectSettings,
  nowIso: string,
): EvidenceDetail {
  const inputs: Record<string, number | string | boolean | null> = {
    durationDays: round2(durationDays),
    participants: Math.max(0, fact.participants),
    maxParticipants: cost.cap,
    postMortem: fact.hasPostMortem,
    loggedSeconds: fact.loggedSeconds,
  };
  if (fact.resolvedAt === null) inputs.enCours = true;

  return {
    durationDays: round2(durationDays),
    method: cost.method,
    formula: formulaOf(fact, durationDays, cost, settings, nowIso),
    inputs,
    familyLabel: FAMILY_LABEL,
    sourceSummary: fact.summary,
  };
}

/** Texte de la formule avec les valeurs réelles, affiché tel quel (§18). */
function formulaOf(
  fact: IssueFact,
  durationDays: number,
  cost: IncidentCost,
  settings: ProjectSettings,
  nowIso: string,
): string {
  const parts: string[] = [];
  const loggedJp = secondsToJp(fact.loggedSeconds, settings.hoursPerDay);

  if (loggedJp === null) {
    const baseJp = Math.max(0, durationDays) * cost.people;
    parts.push(
      `${fmt(durationDays)} j ouvrés × ${fmt(cost.people)} intervenant(s) ` +
        `(plafond ${fmt(cost.cap)}) = ${fmt(baseJp)} j-p`,
    );
  } else {
    parts.push(
      `temps saisi ${fmt(fact.loggedSeconds ?? 0)} s ÷ ${fmt(settings.hoursPerDay)} h/j ` +
        `= ${fmt(loggedJp)} j-p (le temps saisi remplace le calcul)`,
    );
  }

  if (fact.hasPostMortem) parts.push(`+ bonus post-mortem ${fmt(settings.postMortemBonusJp)} j-p`);
  if (fact.resolvedAt === null) parts.push(`incident en cours, arrêté au ${nowIso.slice(0, 10)}`);

  return parts.join(' ');
}

/** Nombre lisible : deux décimales au plus, virgule française. */
function fmt(value: number): string {
  return String(round2(value)).replace('.', ',');
}
