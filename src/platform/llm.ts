/**
 * Forge LLM — pertinence des rapprochements (§10) et rédaction (§17).
 *
 * Aucune clé d'API ici : `@forge/llm` authentifie l'app côté plateforme. Le
 * modèle est résolu une fois par invocation via `list()` (Claude en priorité),
 * puis appelé avec `chat()`.
 *
 * Le LLM est toujours facultatif : chaque fonction a un repli déterministe
 * (gabarit construit à partir des preuves), donc le produit fonctionne sans
 * modèle. Un échec ne remonte jamais à l'écran : il donne le repli.
 *
 * Stabilité (§18) : le score de pertinence est mis en cache par empreinte
 * SHA-256 des deux textes comparés. Deux textes identiques donnent toujours le
 * même score, et un texte inchangé n'est jamais repayé.
 */
import { chat, list } from '@forge/llm';
import type { Message } from '@forge/llm';
import { createHash } from 'node:crypto';
import { clamp, round2 } from '../core/time';
import { BILLED_FAMILIES } from '../core/types';
import type { DebtBill, Evidence, Family, ProjectSettings } from '../core/types';
import { logShort, shortError } from './log';

/** Le modèle demandé à `chat()` : Claude, seul modèle autorisé par §17. */
const CLAUDE_HINTS: readonly string[] = ['claude', 'anthropic'];

/** Modèle de repli si `list()` ne répond pas : nom court accepté par Forge. */
const FALLBACK_MODEL = 'claude';

const TOKENS_SCORE = 200;
const TOKENS_DRAFT = 900;
const TOKENS_ARGUMENTAIRE = 1_200;

/** Score : température nulle, le même texte doit donner le même chiffre. */
const TEMP_SCORE = 0;
const TEMP_WRITING = 0.3;

/** Raison rendue quand le modèle n'a rien donné d'exploitable. */
const UNAVAILABLE = 'modèle indisponible';

/** Bornes de texte envoyées au modèle : on ne lui donne pas un roman. */
const MAX_INPUT_CHARS = 1_500;

/** Nombre de preuves citées dans un brouillon ou un argumentaire. */
const MAX_CITED = 10;

const FAMILY_LABELS: Record<Family, string> = {
  C1: 'Incidents',
  C2: 'Bugs',
  C3: 'Lenteur',
  C4: 'Retouches',
  C5: 'Retard induit',
};

const BILLED: ReadonlySet<Family> = new Set(BILLED_FAMILIES);

const SCORE_SYSTEM = [
  'Tu mesures la dette technique d’une équipe.',
  'On te donne une PREUVE (un fait passé qui a coûté du temps) et un TICKET DE DETTE.',
  'Réponds STRICTEMENT par un objet JSON, sans texte autour, de la forme :',
  '{"relevance": <nombre entre 0 et 1>, "rationale": "<une phrase>"}',
  '0 = aucun rapport ; 1 = la preuve est directement causée par ce ticket de dette.',
  'N’invente rien : juge seulement les deux textes fournis.',
].join('\n');

const DRAFT_SYSTEM = [
  'Tu rédiges un ticket de dette technique pour une équipe Jira.',
  'Réponds STRICTEMENT par un objet JSON, sans texte autour, de la forme :',
  '{"title": "<titre court, factuel>", "description": "<Markdown>"}',
  'La description contient : la zone, ce que la dette coûte (chiffres fournis),',
  'les preuves citées, puis une proposition d’action mesurable.',
  'N’invente aucun chiffre : reprends uniquement ceux fournis.',
].join('\n');

const ARGUMENTAIRE_SYSTEM = [
  'Tu rédiges un argumentaire d’une page, en Markdown, pour faire prioriser une dette technique.',
  'Structure : contexte, ce que coûte la dette, ce que coûterait de la traiter, ce que ça rapporte, limites.',
  'Reprends uniquement les chiffres fournis. Aucune causalité affirmée :',
  'parle de « coût observé », jamais de « gain garanti ».',
].join('\n');

/** Score de pertinence mis en cache par empreinte. */
export interface RelevanceResult {
  relevance: number;
  rationale: string;
  fingerprint: string;
}

/** Cache des scores : clé = empreinte, valeur = score et justification. */
export type ScoreCache = Map<string, { relevance: number; rationale: string }>;

/** Brouillon de ticket ; `source` dit si le modèle a servi. */
export interface Draft {
  title: string;
  description: string;
  source: 'model' | 'template';
}

/** Argumentaire d'une page ; `source` dit si le modèle a servi. */
export interface Argumentaire {
  markdown: string;
  source: 'model' | 'template';
}

// ---------------------------------------------------------------------------
// Empreinte et score de pertinence
// ---------------------------------------------------------------------------

/** Empreinte stable des deux textes comparés (clé de cache, §18). */
export function fingerprintOf(a: string, b: string): string {
  return createHash('sha256').update(`${a}\u0000${b}`).digest('hex');
}

/**
 * Score de pertinence entre une preuve et un ticket de dette (§10).
 * Le cache évite de repayer un couple déjà évalué : si aucun des deux textes
 * n'a changé, l'empreinte est identique et le score est resservi tel quel.
 */
export async function scoreRelevance(
  evidenceText: string,
  debtText: string,
  cache: ScoreCache,
): Promise<RelevanceResult> {
  const fingerprint = fingerprintOf(evidenceText, debtText);
  const cached = cache.get(fingerprint);
  if (cached) return { ...cached, fingerprint };
  const raw = await askModel(
    SCORE_SYSTEM,
    `PREUVE:\n"""\n${clipText(evidenceText)}\n"""\n\nTICKET DE DETTE:\n"""\n${clipText(debtText)}\n"""`,
    TOKENS_SCORE,
    TEMP_SCORE,
  );
  const score = parseScore(raw);
  cache.set(fingerprint, score);
  return { ...score, fingerprint };
}

/** Lit `{relevance, rationale}` ; toute forme douteuse rend le repli. */
function parseScore(raw: string | null): { relevance: number; rationale: string } {
  const parsed = parseObject(raw);
  if (!parsed) return { relevance: 0, rationale: UNAVAILABLE };
  const value = parsed['relevance'];
  const rationale = parsed['rationale'];
  if (typeof value !== 'number' || !Number.isFinite(value)) return { relevance: 0, rationale: UNAVAILABLE };
  if (typeof rationale !== 'string' || rationale.trim().length === 0) return { relevance: 0, rationale: UNAVAILABLE };
  return { relevance: round2(clamp(value, 0, 1)), rationale: clipText(rationale, 200) };
}

// ---------------------------------------------------------------------------
// Rédaction
// ---------------------------------------------------------------------------

/** Brouillon de ticket pour une zone sans ticket de dette (DT-08). */
export async function draftDebtTicket(
  zone: string,
  evidence: Evidence[],
  settings: ProjectSettings,
): Promise<Draft> {
  const facts = evidenceFacts(zone, evidence, settings);
  const raw = await askModel(
    DRAFT_SYSTEM,
    `${facts}\n\nRédige le brouillon de ticket en JSON.`,
    TOKENS_DRAFT,
    TEMP_WRITING,
  );
  const parsed = parseObject(raw);
  const title = asText(parsed?.['title']);
  const description = asText(parsed?.['description']);
  if (title && description) return { title: clipText(title, 160), description, source: 'model' };
  return templateDraft(zone, evidence, settings);
}

/** Argumentaire d'une page pour un ticket de dette (DT-17, §7.6). */
export async function writeArgumentaire(
  bill: DebtBill,
  evidence: Evidence[],
  settings: ProjectSettings,
): Promise<Argumentaire> {
  const facts = [billFacts(bill), evidenceFacts(bill.key, evidence, settings)].join('\n\n');
  const raw = await askModel(
    ARGUMENTAIRE_SYSTEM,
    `${facts}\n\nRédige l’argumentaire en Markdown, une page maximum.`,
    TOKENS_ARGUMENTAIRE,
    TEMP_WRITING,
  );
  const markdown = asText(raw);
  if (markdown) return { markdown, source: 'model' };
  return { markdown: templateArgumentaire(bill, evidence, settings), source: 'template' };
}

/** Repli déterministe : le gabarit se suffit à lui-même, sans modèle. */
function templateDraft(zone: string, evidence: Evidence[], settings: ProjectSettings): Draft {
  const total = billedTotal(evidence);
  const title = `Dette technique — ${zone} : ${num(total)} j-p sur ${settings.windowDays} jours`;
  const lines = [
    '## Zone',
    zone,
    '',
    '## Ce que la dette coûte',
    `- Coût observé : **${num(total)} j-p** sur ${settings.windowDays} jours, sur ${evidence.length} preuve(s).`,
    `- Familles : ${familySummary(evidence)}.`,
    '',
    '## Preuves',
    ...evidenceLines(evidence),
    '',
    '## Proposition',
    `- Traiter la zone \`${zone}\` sur une itération, puis laisser recalculer l’addition.`,
    `- Critère de réussite : coût observé de la zone en baisse sur ${settings.windowDays} jours.`,
  ];
  return { title: clipText(title, 160), description: lines.join('\n'), source: 'template' };
}

/** Repli déterministe de l'argumentaire. */
function templateArgumentaire(bill: DebtBill, evidence: Evidence[], settings: ProjectSettings): string {
  return [
    `# Argumentaire — ${bill.key}`,
    '',
    '## Contexte',
    `Cette dette technique coûte **${num(bill.lowJp)} à ${num(bill.highJp)} j-p** sur ${settings.windowDays} jours.`,
    `Calcul du ${bill.computedAt.slice(0, 10)}, sur ${evidence.length} preuve(s) rattachée(s).`,
    '',
    ...argumentaireFamilies(bill),
    '## Preuves principales',
    ...evidenceLines(evidence),
    '',
    ...argumentaireRepayment(bill, settings),
    '## Limites',
    '- Coût observé, jamais une causalité démontrée : le rapprochement est proposé, puis validé ou rejeté.',
    '- Les délais (famille C5) sont hors addition : ils ne sont pas additionnés aux j-p.',
    '- Une famille sans référence suffisante affiche « données insuffisantes » plutôt qu’un chiffre.',
    '',
  ].join('\n');
}

/** Ventilation par famille de l'addition, en Markdown. */
function argumentaireFamilies(bill: DebtBill): string[] {
  const lines = ['## Ce que coûte la dette', '', '| Famille | Coût (j-p) | Preuves |', '|---|---|---|'];
  for (const family of BILLED_FAMILIES) {
    const total = bill.byFamily[family];
    const cost = total.insufficient ? 'données insuffisantes' : `${num(total.lowJp)} – ${num(total.highJp)}`;
    lines.push(`| ${FAMILY_LABELS[family]} | ${cost} | ${total.evidenceCount} |`);
  }
  lines.push('', `Preuves comptées mais masquées pour ce lecteur : ${bill.hiddenCount}.`, '');
  return lines;
}

/** Remboursement et retour sur investissement, en Markdown. */
function argumentaireRepayment(bill: DebtBill, settings: ProjectSettings): string[] {
  const lines = ['## Ce que ça rapporte', ''];
  if (bill.repaymentJp === null) {
    lines.push('- Remboursement non chiffré : la mesure avant/après n’est pas encore disponible.');
  } else {
    lines.push(`- Remboursement estimé : **${num(bill.repaymentJp)} j-p**.`);
  }
  if (bill.avoidableJp !== null) lines.push(`- Coût évitable sur deux trimestres : ${num(bill.avoidableJp)} j-p.`);
  if (bill.roiLow !== null) lines.push(`- Retour sur investissement : ${num(bill.roiLow)}× à ${num(bill.roiHigh ?? bill.roiLow)}×.`);
  if (bill.paybackDays !== null) lines.push(`- Délai de retour : ${Math.round(bill.paybackDays)} jours.`);
  const rate = settings.dayRateEur;
  if (rate !== undefined && rate > 0) {
    lines.push(`- Au taux de ${num(rate)} € par j-p : ${num(bill.lowJp * rate)} € à ${num(bill.highJp * rate)} €.`);
  }
  lines.push('');
  return lines;
}

// ---------------------------------------------------------------------------
// Faits fournis au modèle (aucun chiffre inventé)
// ---------------------------------------------------------------------------

/** Résumé factuel d'une zone et de ses preuves, en clair pour le modèle. */
function evidenceFacts(zone: string, evidence: Evidence[], settings: ProjectSettings): string {
  return [
    `SUJET: ${zone}`,
    `FENÊTRE: ${settings.windowDays} jours`,
    `COÛT OBSERVÉ: ${num(billedTotal(evidence))} j-p (hors délais)`,
    `FAMILLES: ${familySummary(evidence)}`,
    `PREUVES (${evidence.length}):`,
    ...evidenceLines(evidence),
  ].join('\n');
}

/** Résumé factuel d'une addition, en clair pour le modèle. */
function billFacts(bill: DebtBill): string {
  return [
    `TICKET: ${bill.key}`,
    `ADDITION: ${num(bill.lowJp)} à ${num(bill.highJp)} j-p`,
    `REMBOURSEMENT: ${bill.repaymentJp === null ? 'non chiffré' : `${num(bill.repaymentJp)} j-p`}`,
    `COÛT ÉVITABLE: ${bill.avoidableJp === null ? 'non chiffré' : `${num(bill.avoidableJp)} j-p`}`,
    `PREUVES MASQUÉES: ${bill.hiddenCount}`,
  ].join('\n');
}

/** Preuves citables, les plus coûteuses d'abord, masquées si invisibles. */
function evidenceLines(evidence: Evidence[]): string[] {
  const sorted = evidence
    .filter((item) => BILLED.has(item.family))
    .sort((a, b) => b.costJp - a.costJp)
    .slice(0, MAX_CITED);
  if (sorted.length === 0) return ['- Aucune preuve chiffrée sur la période.'];
  return sorted.map((item) => {
    const source = item.visible ? item.sourceKey : 'preuve masquée';
    const summary = item.visible && item.detail.sourceSummary ? ` — ${clipText(item.detail.sourceSummary, 90)}` : '';
    return `- **${source}** · ${item.detail.familyLabel} · ${num(item.costJp)} j-p · ${item.occurredAt.slice(0, 10)}${summary}`;
  });
}

/** Somme des preuves facturables (C5 en est exclue : c'est un délai). */
function billedTotal(evidence: Evidence[]): number {
  return round2(evidence.filter((item) => BILLED.has(item.family)).reduce((sum, item) => sum + item.costJp, 0));
}

/** « Incidents 3 j-p · Bugs 1,5 j-p », familles facturables seulement. */
function familySummary(evidence: Evidence[]): string {
  const totals = new Map<Family, number>();
  for (const item of evidence) {
    if (!BILLED.has(item.family)) continue;
    totals.set(item.family, round2((totals.get(item.family) ?? 0) + item.costJp));
  }
  if (totals.size === 0) return 'aucune';
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family, cost]) => `${FAMILY_LABELS[family]} ${num(cost)} j-p`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Accès au modèle
// ---------------------------------------------------------------------------

/** Modèle résolu pour l'invocation : Claude si la liste le propose. */
let resolvedModel: string | null = null;

async function resolveModel(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  try {
    const catalog = await list();
    const active = catalog.models.filter((model) => model.status === 'active');
    const claude = active.find((model) =>
      CLAUDE_HINTS.some((hint) => model.model.toLowerCase().includes(hint)),
    );
    resolvedModel = claude?.model ?? FALLBACK_MODEL;
  } catch (error) {
    logShort(`llm list: ${shortError(error)}`);
    resolvedModel = FALLBACK_MODEL;
  }
  return resolvedModel;
}

/** Un appel au modèle ; rend `null` au moindre problème (jamais de throw). */
async function askModel(
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): Promise<string | null> {
  try {
    const model = await resolveModel();
    const response = await chat({
      model,
      temperature,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const first = response.choices[0];
    const content = first ? textOf(first.message.content) : '';
    return content.trim().length > 0 ? content.trim() : null;
  } catch (error) {
    logShort(`llm chat: ${shortError(error)}`);
    return null;
  }
}

/** Contenu d'un message (chaîne simple ou parties texte). */
function textOf(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Premier objet JSON d'une réponse de modèle ; `null` si la forme est douteuse. */
function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Valeur textuelle non vide d'un champ inconnu. */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Tronque un texte pour l'affichage ou l'envoi au modèle. */
function clipText(text: string, max = MAX_INPUT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Nombre lisible en français, deux décimales au plus, sans bruit flottant. */
function num(value: number): string {
  return String(round2(value)).replace('.', ',');
}
