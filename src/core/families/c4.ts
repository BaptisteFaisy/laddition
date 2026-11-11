import type { CostContext, Evidence, IssueFact } from '../types.ts';
import { reworkCount, reworkDays } from '../duration.ts';
import { addDays, parseIso, round2 } from '../time.ts';
import { splitAcrossZones, zonesForIssue } from '../zones.ts';

/** Famille « retouches » (§9, lot S). */
const FAMILY = 'C4' as const;
const FAMILY_LABEL = 'Retouches';

/** Une reprise est portée par une seule personne (§9). */
const REWORK_PEOPLE = 1;

/**
 * C4 — retouches (§9).
 *
 * Un ticket rouvert puis retravaillé coûte le temps de reprise : les jours
 * ouvrés écoulés entre chaque réouverture et la résolution suivante. Le coût
 * est porté par une personne, puis partagé entre les zones du ticket.
 *
 * Choix explicite : même quand `fact.loggedSeconds` est renseigné, C4 ne
 * remplace pas la mesure par le temps saisi. C4 chiffre le *temps de reprise*
 * (le retour en arrière), alors que le temps saisi du ticket est déjà compté
 * par C2 (bugs) et C3 (lenteur) ; le retenir ici compterait deux fois le même
 * travail. La formule affichée le dit au lecteur.
 */
export function c4Rework(facts: IssueFact[], ctx: CostContext): Evidence[] {
  const evidence: Evidence[] = [];
  for (const fact of facts) {
    const spans = ctx.spansByIssue.get(fact.issueId) ?? [];
    const reouvertures = reworkCount(spans);
    if (reouvertures === 0) continue;
    if (!lastResolutionInWindow(fact, ctx)) continue;
    const joursReprise = round2(reworkDays(spans, ctx.now));
    if (joursReprise <= 0) continue;
    const costJp = round2(joursReprise * REWORK_PEOPLE);
    for (const share of splitAcrossZones(costJp, zonesForIssue(fact, ctx.settings))) {
      evidence.push(
        buildEvidence(fact, share.zone, round2(share.costJp), reouvertures, joursReprise, ctx),
      );
    }
  }
  return evidence;
}

/** La dernière résolution du ticket doit tomber dans la fenêtre d'analyse. */
function lastResolutionInWindow(fact: IssueFact, ctx: CostContext): boolean {
  const resolved = parseIso(fact.resolvedAt);
  const now = parseIso(ctx.now);
  if (!resolved || !now) return false;
  const start = parseIso(addDays(ctx.now, -ctx.settings.windowDays));
  if (!start) return false;
  return resolved.getTime() >= start.getTime() && resolved.getTime() <= now.getTime();
}

/** Construit la preuve d'une zone à partir du coût partagé. */
function buildEvidence(
  fact: IssueFact,
  zone: string,
  costJp: number,
  reouvertures: number,
  joursReprise: number,
  ctx: CostContext,
): Evidence {
  return {
    id: `${FAMILY}:${fact.issueId}:${zone}`,
    zone,
    family: FAMILY,
    sourceIssueId: fact.issueId,
    sourceKey: fact.key,
    occurredAt: fact.resolvedAt ?? ctx.now,
    costJp,
    method: 'computed',
    visible: fact.visible,
    detail: {
      durationDays: joursReprise,
      method: 'computed',
      formula: formulaFor(fact, zone, costJp, reouvertures, joursReprise, ctx.settings.hoursPerDay),
      inputs: { reouvertures, joursReprise },
      familyLabel: FAMILY_LABEL,
      sourceSummary: fact.visible ? fact.summary : undefined,
    },
  };
}

/** Texte de formule lisible, valeurs incluses (transparence §18). */
function formulaFor(
  fact: IssueFact,
  zone: string,
  costJp: number,
  reouvertures: number,
  joursReprise: number,
  hoursPerDay: number,
): string {
  const logged = loggedHint(fact.loggedSeconds, hoursPerDay);
  return (
    `${reouvertures} réouverture(s) × ${joursReprise} j ouvrés de reprise × ${REWORK_PEOPLE} personne` +
    ` = ${costJp} j-p ; part de la zone « ${zone} » : ${costJp} j-p.` +
    ` Temps saisi du ticket${logged} non retenu : C4 mesure le temps de reprise,` +
    ` le temps saisi est déjà compté en C2/C3.`
  );
}

/** Rappel du temps saisi, sans jamais l'utiliser comme coût. */
function loggedHint(seconds: number | null, hoursPerDay: number): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ' absent';
  return ` (${round2(seconds / 3600)} h pour ${hoursPerDay} h/j)`;
}
