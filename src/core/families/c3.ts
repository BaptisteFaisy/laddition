import type { Baseline, CostContext, Evidence, IssueFact } from '../types';
import { baselineKey, clipToPercentile, sizeClassOf, ticketDurationDays } from '../baseline';
import type { TicketDuration } from '../baseline';
import { DAY_MS, parseIso, round2 } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/**
 * Famille C3 — la lenteur (§9).
 *
 * Un ticket hors bug, terminé, n'aurait pas dû coûter plus que la médiane des
 * tickets de même type et de même taille : tout le surplus est du temps que la
 * dette a rendu nécessaire. Le coût retenu est ce surplus multiplié par le
 * coefficient d'occupation du projet.
 *
 * Le lot est raboté à son centile avant chiffrage : un ticket aberrant ne doit
 * pas emporter à lui seul le coût de la zone (§9 « cohérence du lot »).
 */

/** Nom lisible de la famille, affiché dans le détail d'une preuve. */
const FAMILY_LABEL = 'Lenteur';

/** Un ticket candidat, mesuré, avec ou sans référence utilisable. */
interface Measured {
  fact: IssueFact;
  duration: TicketDuration;
  baseline: Baseline | null;
  /** Surcoût brut en jours ouvrés, avant rabotage et coefficient. */
  rawOverrun: number;
  /** Vrai quand la référence existe et compte assez de tickets. */
  sufficient: boolean;
}

/**
 * Preuves de lenteur d'un lot de tickets.
 *
 * Rend une preuve par zone et par ticket (le coût se partage à parts égales,
 * §8). Un ticket sans référence assez fournie produit une preuve marquée
 * `insufficient` à coût nul : l'écran peut alors dire « données insuffisantes »
 * plutôt que d'inventer un chiffre.
 */
export function c3Slowness(facts: IssueFact[], ctx: CostContext): Evidence[] {
  const measured = facts.filter((fact) => isSlownessCandidate(fact, ctx)).map((fact) => measureTicket(fact, ctx));
  if (measured.length === 0) return [];

  const lotSize = measured.filter((item) => item.sufficient).length;
  const overruns = clipLot(measured, ctx.settings.clipPercentile);

  const evidence: Evidence[] = [];
  measured.forEach((item, index) => {
    evidence.push(...evidenceForTicket(item, overruns[index] as number, lotSize, ctx));
  });
  return evidence;
}

/** Ticket éligible : hors bug, hors incident, terminé dans la fenêtre d'analyse. */
function isSlownessCandidate(fact: IssueFact, ctx: CostContext): boolean {
  if (fact.isBug || fact.isIncident) return false;
  return resolvedWithinWindow(fact.resolvedAt, ctx);
}

/** Vrai quand la résolution tombe dans la fenêtre glissante du projet. */
function resolvedWithinWindow(resolvedAt: string | null, ctx: CostContext): boolean {
  const resolved = parseIso(resolvedAt);
  const now = parseIso(ctx.now);
  if (!resolved || !now) return false;
  const start = now.getTime() - ctx.settings.windowDays * DAY_MS;
  const at = resolved.getTime();
  return at >= start && at <= now.getTime();
}

/** Mesure un ticket : durée, référence applicable, surcoût brut. */
function measureTicket(fact: IssueFact, ctx: CostContext): Measured {
  const duration = ticketDurationDays(fact, ctx.spansByIssue.get(fact.issueId));
  const size = sizeClassOf(fact, ctx.settings);
  const baseline = ctx.baselines.get(baselineKey(fact.type, size)) ?? null;
  const sufficient = baseline !== null && baseline.sampleSize >= ctx.settings.minBaselineSample;
  const rawOverrun = sufficient ? Math.max(0, duration.days - (baseline as Baseline).medianDays) : 0;
  return { fact, duration, baseline, rawOverrun, sufficient };
}

/**
 * Rabote les surcoûts bruts du lot à son centile, en conservant l'ordre : le
 * résultat s'applique ticket par ticket. Les tickets sans référence gardent 0.
 */
function clipLot(items: Measured[], percentile: number): number[] {
  const result = items.map((item) => (item.sufficient ? item.rawOverrun : 0));
  const positions: number[] = [];
  items.forEach((item, index) => {
    if (item.sufficient) positions.push(index);
  });
  const clipped = clipToPercentile(
    positions.map((index) => result[index] as number),
    percentile,
  );
  positions.forEach((position, order) => {
    result[position] = clipped[order] as number;
  });
  return result;
}

/** Preuves d'un ticket : une par zone, coût partagé à parts égales. */
function evidenceForTicket(item: Measured, overrun: number, lotSize: number, ctx: CostContext): Evidence[] {
  const zones = zonesForIssue(item.fact, ctx.settings);
  const costJp = round2(overrun * ctx.settings.occupationCoefficient);
  const method = item.duration.approximated ? 'approximated' : 'computed';
  return splitAcrossZones(costJp, zones).map((share) => ({
    id: `C3:${item.fact.issueId}:${share.zone}`,
    zone: share.zone,
    family: 'C3',
    sourceIssueId: item.fact.issueId,
    sourceKey: item.fact.key,
    occurredAt: item.fact.resolvedAt ?? ctx.now,
    costJp: round2(share.costJp),
    method,
    ...(item.sufficient ? {} : { insufficient: true }),
    visible: item.fact.visible,
    detail: {
      durationDays: item.duration.days,
      method,
      formula: buildFormula(item, overrun, lotSize, ctx),
      inputs: {
        duree: item.duration.days,
        reference: item.baseline ? item.baseline.medianDays : null,
        echantillon: item.baseline ? item.baseline.sampleSize : 0,
        coefficient: ctx.settings.occupationCoefficient,
        centile: ctx.settings.clipPercentile,
      },
      familyLabel: FAMILY_LABEL,
      ...(item.fact.visible ? { sourceSummary: item.fact.summary } : {}),
    },
  }));
}

/** Texte de la formule, valeurs comprises : affiché tel quel dans le détail. */
function buildFormula(item: Measured, overrun: number, lotSize: number, ctx: CostContext): string {
  const size = sizeClassOf(item.fact, ctx.settings);
  if (!item.sufficient) {
    const found = item.baseline ? item.baseline.sampleSize : 0;
    return (
      `données insuffisantes : moins de ${ctx.settings.minBaselineSample} tickets de référence ` +
      `pour ${item.fact.type}:${size} (${found} trouvés) ; coût non chiffré`
    );
  }
  const reference = item.baseline ? item.baseline.medianDays : 0;
  const cost = round2(overrun * ctx.settings.occupationCoefficient);
  return (
    `max(0, ${formatNumber(item.duration.days)} − ${formatNumber(reference)}) × ` +
    `${formatNumber(ctx.settings.occupationCoefficient)} = ${formatNumber(cost)} j-p ; ` +
    `surcoût raboté au ${formatNumber(ctx.settings.clipPercentile)}e centile sur ${lotSize} surcoûts du lot`
  );
}

/** Nombre lisible : arrondi au centième, sans bruit de virgule flottante. */
function formatNumber(value: number): string {
  return String(round2(value));
}
