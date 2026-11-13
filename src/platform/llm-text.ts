/**
 * Textes de rédaction : consignes données au modèle et gabarits de repli,
 * en français et en anglais.
 *
 * Une interface anglaise rendait un argumentaire **français** : le prompt et le
 * gabarit étaient écrits en dur en français (défaut DT-17 relevé par l'audit,
 * visible sur la capture du chat Rovo). La langue est désormais un paramètre.
 *
 * Une seule structure, deux jeux de chaînes : aucune logique n'est dupliquée.
 * Les *faits* envoyés au modèle (`billFacts`, `evidenceFacts`) restent dans la
 * langue de rédaction — ce sont des données internes, pas du texte lu.
 */
import type { DebtBill, Evidence, Family, ProjectSettings } from '../core/types';
import { BILLED_FAMILIES } from '../core/types';
import { round2 } from '../core/time';

/** Langues de rédaction (les deux catalogues de l'application). */
export type TextLocale = 'fr' | 'en';

/** Nombre de preuves citées dans un brouillon ou un argumentaire. */
const MAX_CITED = 10;

/** Troncature d'un résumé de ticket cité. */
const MAX_SUMMARY = 90;

const FAMILY_LABELS: Record<TextLocale, Record<Family, string>> = {
  fr: { C1: 'Incidents', C2: 'Bugs', C3: 'Lenteur', C4: 'Retouches', C5: 'Retard induit' },
  en: { C1: 'Incidents', C2: 'Bugs', C3: 'Slowness', C4: 'Rework', C5: 'Induced delay' },
};

/** Vocabulaire d'un jeu de textes. */
interface Words {
  /** Unité de coût (« j-p » / « p-d »). */
  jp: string;
  /** « 90 jours » / « 90 days ». */
  days: (count: number) => string;
  /** « 4 preuve(s) » / « 4 item(s) of evidence ». */
  proofs: (count: number) => string;
  insufficient: string;
  noEvidence: string;
  hiddenProof: string;
  none: string;
}

const WORDS: Record<TextLocale, Words> = {
  fr: {
    jp: 'j-p',
    days: (count) => `${count} jours`,
    proofs: (count) => `${count} preuve(s)`,
    insufficient: 'données insuffisantes',
    noEvidence: '- Aucune preuve chiffrée sur la période.',
    hiddenProof: 'preuve masquée',
    none: 'aucune',
  },
  en: {
    jp: 'p-d',
    days: (count) => `${count} days`,
    proofs: (count) => `${count} item(s) of evidence`,
    insufficient: 'insufficient data',
    noEvidence: '- No costed evidence over the period.',
    hiddenProof: 'hidden evidence',
    none: 'none',
  },
};

/** Nombre à une décimale, virgule en français. */
function num(locale: TextLocale, value: number): string {
  const rounded = String(Math.round(value * 10) / 10);
  return locale === 'fr' ? rounded.replace('.', ',') : rounded;
}

/** Coût suffixé de son unité : « 62 j-p » / « 62 p-d ». */
function cost(locale: TextLocale, value: number): string {
  return `${num(locale, value)} ${WORDS[locale].jp}`;
}

/** Somme des preuves facturables (C5 en est exclue : c'est un délai). */
export function billedTotal(evidence: Evidence[]): number {
  return round2(evidence.filter((item) => BILLED.has(item.family)).reduce((sum, item) => sum + item.costJp, 0));
}

const BILLED: ReadonlySet<Family> = new Set(BILLED_FAMILIES);

/** « Incidents 3 j-p · Bugs 1,5 j-p », familles facturables seulement. */
export function familySummary(evidence: Evidence[], locale: TextLocale): string {
  const totals = new Map<Family, number>();
  for (const item of evidence) {
    if (!BILLED.has(item.family)) continue;
    totals.set(item.family, round2((totals.get(item.family) ?? 0) + item.costJp));
  }
  if (totals.size === 0) return WORDS[locale].none;
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family, total]) => `${FAMILY_LABELS[locale][family]} ${cost(locale, total)}`)
    .join(' · ');
}

/** Preuves citables, les plus coûteuses d'abord, masquées si invisibles. */
export function evidenceLines(evidence: Evidence[], locale: TextLocale): string[] {
  const sorted = evidence
    .filter((item) => BILLED.has(item.family))
    .sort((a, b) => b.costJp - a.costJp)
    .slice(0, MAX_CITED);
  if (sorted.length === 0) return [WORDS[locale].noEvidence];
  return sorted.map((item) => {
    const source = item.visible ? item.sourceKey : WORDS[locale].hiddenProof;
    const summary = item.visible && item.detail.sourceSummary
      ? ` — ${item.detail.sourceSummary.slice(0, MAX_SUMMARY)}`
      : '';
    return `- **${source}** · ${item.detail.familyLabel} · ${cost(locale, item.costJp)} · ${item.occurredAt.slice(0, 10)}${summary}`;
  });
}

/** Faits envoyés au modèle pour un argumentaire. */
export function billFacts(bill: DebtBill, locale: TextLocale): string {
  const word = WORDS[locale];
  const values = locale === 'fr'
    ? { key: 'TICKET', bill: 'ADDITION', repayment: 'REMBOURSEMENT', avoidable: 'COÛT ÉVITABLE', hidden: 'PREUVES MASQUÉES', unpriced: 'non chiffré' }
    : { key: 'TICKET', bill: 'BILL', repayment: 'REPAYMENT', avoidable: 'AVOIDABLE COST', hidden: 'HIDDEN EVIDENCE', unpriced: 'not priced' };
  const priced = (value: number | null): string => (value === null ? values.unpriced : cost(locale, value));
  return [
    `${values.key}: ${bill.key}`,
    `${values.bill}: ${num(locale, bill.lowJp)} – ${cost(locale, bill.highJp)}`,
    `${values.repayment}: ${priced(bill.repaymentJp)}`,
    `${values.avoidable}: ${priced(bill.avoidableJp)}`,
    `${values.hidden}: ${bill.hiddenCount}${locale === 'fr' ? '' : ` (${word.proofs(bill.hiddenCount)})`}`,
  ].join('\n');
}

/** Faits envoyés au modèle pour une zone. */
export function evidenceFacts(zone: string, evidence: Evidence[], settings: ProjectSettings, locale: TextLocale): string {
  const labels = locale === 'fr'
    ? { subject: 'SUJET', window: 'FENÊTRE', cost: 'COÛT OBSERVÉ', families: 'FAMILLES', proofs: 'PREUVES' }
    : { subject: 'SUBJECT', window: 'WINDOW', cost: 'OBSERVED COST', families: 'FAMILIES', proofs: 'EVIDENCE' };
  return [
    `${labels.subject}: ${zone}`,
    `${labels.window}: ${WORDS[locale].days(settings.windowDays)}`,
    `${labels.cost}: ${cost(locale, billedTotal(evidence))}${locale === 'fr' ? ' (hors délais)' : ' (delay excluded)'}`,
    `${labels.families}: ${familySummary(evidence, locale)}`,
    `${labels.proofs} (${evidence.length}):`,
    ...evidenceLines(evidence, locale),
  ].join('\n');
}

/** Consigne système du brouillon de ticket (DT-08). */
export function draftSystemPrompt(locale: TextLocale): string {
  if (locale === 'en') {
    return [
      'You write a technical-debt ticket for a Jira team, in English.',
      'Answer STRICTLY with a JSON object, no surrounding text, of the form:',
      '{"title": "<short, factual title>", "description": "<Markdown>"}',
      'The description contains: the zone, what the debt costs (figures provided),',
      'the cited evidence, then a measurable action proposal.',
      'Invent no figure: reuse only the ones provided.',
    ].join('\n');
  }
  return [
    'Tu rédiges un ticket de dette technique pour une équipe Jira, en français.',
    'Réponds STRICTEMENT par un objet JSON, sans texte autour, de la forme :',
    '{"title": "<titre court, factuel>", "description": "<Markdown>"}',
    'La description contient : la zone, ce que la dette coûte (chiffres fournis),',
    'les preuves citées, puis une proposition d’action mesurable.',
    'N’invente aucun chiffre : reprends uniquement ceux fournis.',
  ].join('\n');
}

/** Consigne système de l'argumentaire d'une page (DT-17). */
export function argumentaireSystemPrompt(locale: TextLocale): string {
  if (locale === 'en') {
    return [
      'You write a one-page case, in Markdown and in English, to get a technical debt prioritised.',
      'Structure: context, what the debt costs, what fixing it would cost, what it returns, limits.',
      'Reuse only the figures provided. Never assert causality:',
      'say “observed cost”, never “guaranteed gain”.',
    ].join('\n');
  }
  return [
    'Tu rédiges un argumentaire d’une page, en Markdown et en français, pour faire prioriser une dette technique.',
    'Structure : contexte, ce que coûte la dette, ce que coûterait de la traiter, ce que ça rapporte, limites.',
    'Reprends uniquement les chiffres fournis. Aucune causalité affirmée :',
    'parle de « coût observé », jamais de « gain garanti ».',
  ].join('\n');
}

/** Demande qui suit les faits, pour le brouillon. */
export function draftInstruction(locale: TextLocale): string {
  return locale === 'fr' ? 'Rédige le brouillon de ticket en JSON.' : 'Write the ticket draft as JSON.';
}

/** Demande qui suit les faits, pour l'argumentaire. */
export function argumentaireInstruction(locale: TextLocale): string {
  return locale === 'fr'
    ? 'Rédige l’argumentaire en Markdown, une page maximum.'
    : 'Write the case in Markdown, one page at most.';
}

/** Titre du brouillon de repli. */
export function draftTitle(zone: string, evidence: Evidence[], settings: ProjectSettings, locale: TextLocale): string {
  return locale === 'fr'
    ? `Dette technique — ${zone} : ${cost(locale, billedTotal(evidence))} sur ${WORDS[locale].days(settings.windowDays)}`
    : `Technical debt — ${zone}: ${cost(locale, billedTotal(evidence))} over ${WORDS[locale].days(settings.windowDays)}`;
}

/** Repli déterministe du brouillon : le gabarit se suffit à lui-même. */
export function templateDraft(zone: string, evidence: Evidence[], settings: ProjectSettings, locale: TextLocale): string {
  const total = billedTotal(evidence);
  const w = WORDS[locale];
  const head = locale === 'fr'
    ? ['## Zone', zone, '', '## Ce que la dette coûte',
      `- Coût observé : **${cost(locale, total)}** sur ${w.days(settings.windowDays)}, sur ${w.proofs(evidence.length)}.`,
      `- Familles : ${familySummary(evidence, locale)}.`, '', '## Preuves']
    : ['## Zone', zone, '', '## What the debt costs',
      `- Observed cost: **${cost(locale, total)}** over ${w.days(settings.windowDays)}, on ${w.proofs(evidence.length)}.`,
      `- Families: ${familySummary(evidence, locale)}.`, '', '## Evidence'];
  const tail = locale === 'fr'
    ? ['', '## Proposition',
      `- Traiter la zone \`${zone}\` sur une itération, puis laisser recalculer l’addition.`,
      `- Critère de réussite : coût observé de la zone en baisse sur ${w.days(settings.windowDays)}.`]
    : ['', '## Proposal',
      `- Work the \`${zone}\` zone for one iteration, then let the bill recompute.`,
      `- Success criterion: the zone's observed cost goes down over ${w.days(settings.windowDays)}.`];
  return [...head, ...evidenceLines(evidence, locale), ...tail].join('\n');
}

/** Repli déterministe de l'argumentaire d'une page. */
export function templateArgumentaire(
  bill: DebtBill,
  evidence: Evidence[],
  settings: ProjectSettings,
  locale: TextLocale,
): string {
  const w = WORDS[locale];
  const head = locale === 'fr'
    ? [`# Argumentaire — ${bill.key}`, '', '## Contexte',
      `Cette dette technique coûte **${num(locale, bill.lowJp)} à ${cost(locale, bill.highJp)}** sur ${w.days(settings.windowDays)}.`,
      `Calcul du ${bill.computedAt.slice(0, 10)}, sur ${w.proofs(evidence.length)} rattachée(s).`, '']
    : [`# Case — ${bill.key}`, '', '## Context',
      `This technical debt costs **${num(locale, bill.lowJp)} to ${cost(locale, bill.highJp)}** over ${w.days(settings.windowDays)}.`,
      `Computed on ${bill.computedAt.slice(0, 10)}, on ${w.proofs(evidence.length)} attached.`, ''];
  const limits = locale === 'fr'
    ? ['## Limites',
      '- Coût observé, jamais une causalité démontrée : le rapprochement est proposé, puis validé ou rejeté.',
      '- Les délais (famille C5) sont hors addition : ils ne sont pas additionnés aux j-p.',
      '- Une famille sans référence suffisante affiche « données insuffisantes » plutôt qu’un chiffre.', '']
    : ['## Limits',
      '- Observed cost, never proven causality: a match is proposed, then accepted or rejected by a human.',
      '- Delays (family C5) stay out of the bill: they are not added to the p-d.',
      '- A family without enough reference shows “insufficient data” rather than a figure.', ''];
  return [
    ...head,
    ...argumentaireFamilies(bill, locale),
    ...(locale === 'fr' ? ['## Preuves principales'] : ['## Main evidence']),
    ...evidenceLines(evidence, locale),
    '',
    ...argumentaireRepayment(bill, settings, locale),
    ...limits,
  ].join('\n');
}

/** Ventilation par famille de l'addition, en Markdown. */
export function argumentaireFamilies(bill: DebtBill, locale: TextLocale): string[] {
  const w = WORDS[locale];
  const head = locale === 'fr'
    ? ['## Ce que coûte la dette', '', `| Famille | Coût (${w.jp}) | Preuves |`, '|---|---|---|']
    : ['## What the debt costs', '', `| Family | Cost (${w.jp}) | Evidence |`, '|---|---|---|'];
  const lines = [...head];
  for (const family of BILLED_FAMILIES) {
    const total = bill.byFamily[family];
    const figure = total.insufficient ? w.insufficient : `${num(locale, total.lowJp)} – ${num(locale, total.highJp)}`;
    lines.push(`| ${FAMILY_LABELS[locale][family]} | ${figure} | ${total.evidenceCount} |`);
  }
  const hidden = locale === 'fr'
    ? `Preuves comptées mais masquées pour ce lecteur : ${bill.hiddenCount}.`
    : `Evidence counted but hidden from this reader: ${bill.hiddenCount}.`;
  lines.push('', hidden, '');
  return lines;
}

/** Remboursement et retour sur investissement, en Markdown. */
export function argumentaireRepayment(bill: DebtBill, settings: ProjectSettings, locale: TextLocale): string[] {
  const w = WORDS[locale];
  const unpriced = locale === 'fr'
    ? '- Remboursement non chiffré : la mesure avant/après n’est pas encore disponible.'
    : '- Repayment not priced: the before/after measurement is not available yet.';
  const lines = [locale === 'fr' ? '## Ce que ça rapporte' : '## What it returns', ''];
  lines.push(bill.repaymentJp === null
    ? unpriced
    : (locale === 'fr' ? `- Remboursement estimé : **${cost(locale, bill.repaymentJp)}**.` : `- Estimated repayment: **${cost(locale, bill.repaymentJp)}**.`));
  if (bill.avoidableJp !== null) {
    lines.push(locale === 'fr'
      ? `- Coût évitable sur deux trimestres : ${cost(locale, bill.avoidableJp)}.`
      : `- Avoidable cost over two quarters: ${cost(locale, bill.avoidableJp)}.`);
  }
  if (bill.roiLow !== null) {
    const high = num(locale, bill.roiHigh ?? bill.roiLow);
    lines.push(locale === 'fr'
      ? `- Retour sur investissement : ${num(locale, bill.roiLow)}× à ${high}×.`
      : `- Return on investment: ${num(locale, bill.roiLow)}× to ${high}×.`);
  }
  if (bill.paybackDays !== null) {
    const days = String(Math.round(bill.paybackDays));
    lines.push(locale === 'fr' ? `- Délai de retour : ${days} jours.` : `- Payback: ${days} days.`);
  }
  const rate = settings.dayRateEur;
  if (rate !== undefined && rate > 0) {
    const low = num(locale, bill.lowJp * rate);
    const high = num(locale, bill.highJp * rate);
    lines.push(locale === 'fr'
      ? `- Au taux de ${num(locale, rate)} € par ${w.jp} : ${low} € à ${high} €.`
      : `- At ${num(locale, rate)} € per ${w.jp}: €${low} to €${high}.`);
  }
  lines.push('');
  return lines;
}