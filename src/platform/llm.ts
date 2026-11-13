/**
 * Forge LLM — pertinence des rapprochements (§10) et rédaction (§17).
 *
 * `@forge/llm` authentifie l'app côté plateforme (Claude en priorité, résolu
 * une fois par invocation). Le LLM est toujours facultatif : chaque fonction a
 * un repli déterministe (gabarit), donc le produit fonctionne sans modèle ; un
 * échec ne remonte jamais à l'écran.
 *
 * Stabilité (§18) : le score est mis en cache par empreinte SHA-256 des deux
 * textes comparés — un texte inchangé n'est jamais repayé. Le cache est rendu
 * persistant par un `ScoreStore` (C30, SQL `score_cache` ; repli mémoire). Le
 * débit est borné par `ratelimit.ts` (C31) : plafond atteint → repli, sans
 * appeler le modèle. Transport injectable pour tester sans réseau.
 */
import type { Message } from '@forge/llm';
import { createHash } from 'node:crypto';
import { clamp, round2 } from '../core/time';
import type { DebtBill, Evidence, ProjectSettings } from '../core/types';
import type { TextLocale } from './llm-text';
import {
  argumentaireInstruction,
  argumentaireSystemPrompt,
  billFacts,
  draftInstruction,
  draftSystemPrompt,
  evidenceFacts,
  draftTitle,
  templateArgumentaire,
  templateDraft,
} from './llm-text';
import { logShort, shortError } from './log';
import { acquireLlmBudget } from './ratelimit';

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

/** Raison rendue quand le plafond de débit a été atteint (C31). */
export const BUDGET_UNAVAILABLE = 'plafond LLM atteint (score neutre)';

/** Bornes de texte envoyées au modèle : on ne lui donne pas un roman. */
const MAX_INPUT_CHARS = 1_500;


const SCORE_SYSTEM = [
  'Tu mesures la dette technique d’une équipe.',
  'On te donne une PREUVE (un fait passé qui a coûté du temps) et un TICKET DE DETTE.',
  'Réponds STRICTEMENT par un objet JSON, sans texte autour, de la forme :',
  '{"relevance": <nombre entre 0 et 1>, "rationale": "<une phrase>"}',
  '0 = aucun rapport ; 1 = la preuve est directement causée par ce ticket de dette.',
  'N’invente rien : juge seulement les deux textes fournis.',
].join('\n');

/** Score de pertinence mis en cache par empreinte. */
export interface RelevanceResult {
  relevance: number;
  rationale: string;
  fingerprint: string;
}

/** Un score mis en cache : chiffre + justification (une phrase). */
export interface CachedScore {
  relevance: number;
  rationale: string;
}

/** Cache des scores : clé = empreinte, valeur = score et justification. */
export type ScoreCache = Map<string, CachedScore>;

/** Enregistrement persistant d'un score (implémenté en SQL par le lot C). */
export interface ScoreRecord {
  fingerprint: string;
  relevance: number;
  rationale: string;
}

/**
 * Store persistant des scores (C30). Le lot C l'implémente sur `score_cache` ;
 * `setScoreStore(null)` (défaut) retombe sur la mémoire de l'invocation.
 */
export interface ScoreStore {
  loadCachedScores(): Promise<ScoreRecord[]>;
  saveCachedScores(records: ScoreRecord[]): Promise<void>;
}

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

// --- Cache persistant (C30) ---

let scoreStore: ScoreStore | null = null;
const memoryScores: ScoreCache = new Map();

/** Enregistre le store persistant ; `null` restaure le repli mémoire. */
export function setScoreStore(store: ScoreStore | null): void {
  scoreStore = store;
}

/** Ouvre le cache de l'invocation : store SQL si présent, sinon mémoire (C30). */
export async function openScoreCache(): Promise<ScoreCache> {
  if (!scoreStore) return memoryScores;
  try {
    return new Map(
      (await scoreStore.loadCachedScores()).map((r): [string, CachedScore] => [r.fingerprint, { relevance: r.relevance, rationale: r.rationale }]),
    );
  } catch (error) {
    logShort(`llm cache load: ${shortError(error)}`);
    return memoryScores;
  }
}

/** Enregistre un score frais ; best-effort, ne jette jamais (jamais de throw). */
async function persistScore(fingerprint: string, score: CachedScore): Promise<void> {
  if (!scoreStore) return;
  try {
    await scoreStore.saveCachedScores([{ fingerprint, ...score }]);
  } catch (error) {
    logShort(`llm cache save: ${shortError(error)}`);
  }
}

// --- Empreinte et score de pertinence ---

/** Empreinte stable des deux textes comparés (clé de cache, §18). */
export function fingerprintOf(a: string, b: string): string {
  return createHash('sha256').update(`${a}\u0000${b}`).digest('hex');
}

/**
 * Score de pertinence entre une preuve et un ticket de dette (§10).
 * Le cache évite de repayer un couple déjà évalué : si aucun des deux textes
 * n'a changé, l'empreinte est identique et le score est resservi tel quel.
 * Un échec du modèle ou un plafond de débit n'est jamais mis en cache (C43).
 */
export async function scoreRelevance(
  evidenceText: string,
  debtText: string,
  cache: ScoreCache,
): Promise<RelevanceResult> {
  const fingerprint = fingerprintOf(evidenceText, debtText);
  const cached = cache.get(fingerprint);
  if (cached) return { ...cached, fingerprint };
  const outcome = await askModel(
    SCORE_SYSTEM,
    `PREUVE:\n"""\n${clipText(evidenceText)}\n"""\n\nTICKET DE DETTE:\n"""\n${clipText(debtText)}\n"""`,
    TOKENS_SCORE,
    TEMP_SCORE,
  );
  if (outcome.status !== 'text') {
    const rationale = outcome.status === 'blocked' ? BUDGET_UNAVAILABLE : UNAVAILABLE;
    return { relevance: 0, rationale, fingerprint };
  }
  const score = parseScore(outcome.text);
  if (score.rationale === UNAVAILABLE) return { ...score, fingerprint }; // échec, pas de cache
  cache.set(fingerprint, score);
  await persistScore(fingerprint, score);
  return { ...score, fingerprint };
}

/** Lit `{relevance, rationale}` ; toute forme douteuse rend le repli. */
function parseScore(raw: string | null): CachedScore {
  const parsed = parseObject(raw);
  if (!parsed) return { relevance: 0, rationale: UNAVAILABLE };
  const value = parsed['relevance'];
  const rationale = parsed['rationale'];
  if (typeof value !== 'number' || !Number.isFinite(value)) return { relevance: 0, rationale: UNAVAILABLE };
  if (typeof rationale !== 'string' || rationale.trim().length === 0) return { relevance: 0, rationale: UNAVAILABLE };
  return { relevance: round2(clamp(value, 0, 1)), rationale: clipText(rationale, 200) };
}

// --- Rédaction ---

/** Brouillon de ticket pour une zone sans ticket de dette (DT-08). */
export async function draftDebtTicket(
  zone: string,
  evidence: Evidence[],
  settings: ProjectSettings,
  locale: TextLocale = 'en',
): Promise<Draft> {
  const facts = evidenceFacts(zone, evidence, settings, locale);
  const prompt = `${facts}\n\n${draftInstruction(locale)}`;
  const outcome = await askModel(draftSystemPrompt(locale), prompt, TOKENS_DRAFT, TEMP_WRITING);
  const parsed = outcome.status === 'text' ? parseObject(outcome.text) : null;
  const title = asText(parsed?.['title']);
  const description = asText(parsed?.['description']);
  if (title && description) return { title: clipText(title, 160), description, source: 'model' };
  return { title: draftTitle(zone, evidence, settings, locale), description: templateDraft(zone, evidence, settings, locale), source: 'template' };
}

/** Argumentaire d'une page pour un ticket de dette (DT-17, §7.6). */
export async function writeArgumentaire(
  bill: DebtBill,
  evidence: Evidence[],
  settings: ProjectSettings,
  locale: TextLocale = 'en',
): Promise<Argumentaire> {
  const facts = [billFacts(bill, locale), evidenceFacts(bill.key, evidence, settings, locale)].join('\n\n');
  const outcome = await askModel(
    argumentaireSystemPrompt(locale),
    `${facts}\n\n${argumentaireInstruction(locale)}`,
    TOKENS_ARGUMENTAIRE,
    TEMP_WRITING,
  );
  const markdown = outcome.status === 'text' ? asText(outcome.text) : null;
  if (markdown) return { markdown, source: 'model' };
  return { markdown: templateArgumentaire(bill, evidence, settings, locale), source: 'template' };
}

// Les textes et gabarits de rédaction vivent dans `llm-text.ts` (fr/en).

// --- Accès au modèle (transport injectable, jamais de throw) ---

/** Requête minimale envoyée à `chat()`. */
export interface LlmChatRequest {
  model: string;
  temperature: number;
  max_completion_tokens: number;
  messages: Message[];
}

/** Réponse minimale de `chat()` : ce dont ce module a besoin. */
export interface LlmChatResponse {
  choices: Array<{ message: { content: Message['content'] } }>;
}

/** Catalogue minimal rendu par `list()`. */
export interface LlmModelList {
  models: Array<{ model: string; status: string }>;
}

/** Transport LLM injectable : les tests n'appellent jamais le modèle. */
export interface LlmTransport {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  list(): Promise<LlmModelList>;
}

/** Transport réel : `@forge/llm`, importé à la demande (le runtime Forge n'existe pas hors plateforme ; un import au niveau supérieur jetterait à l'import, même pour les appels injectés). */
const forgeTransport: LlmTransport = {
  chat: (request) => import('@forge/llm').then((mod) => mod.chat(request)),
  list: () => import('@forge/llm').then((mod) => mod.list()),
};
let llmTransport: LlmTransport = forgeTransport;
let resolvedModel: string | null = null;

/** Remplace le transport (tests) ; `null` restaure `@forge/llm`. */
export function setLlmTransport(transport: LlmTransport | null): void {
  llmTransport = transport ?? forgeTransport;
  resolvedModel = null;
}

async function resolveModel(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  try {
    const catalog = await llmTransport.list();
    const active = catalog.models.filter((model) => model.status === 'active');
    const claude = active.find((model) => CLAUDE_HINTS.some((hint) => model.model.toLowerCase().includes(hint)));
    resolvedModel = claude?.model ?? FALLBACK_MODEL;
  } catch (error) {
    logShort(`llm list: ${shortError(error)}`);
    resolvedModel = FALLBACK_MODEL;
  }
  return resolvedModel;
}

/** Issue d'un appel : texte exploitable, plafond atteint, ou échec distinct. */
type AskOutcome = { status: 'text'; text: string } | { status: 'blocked' } | { status: 'failed' };

/** Un appel au modèle, borné par le limiteur ; ne jette jamais. */
async function askModel(
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): Promise<AskOutcome> {
  const verdict = acquireLlmBudget(maxTokens);
  if (!verdict.allowed) {
    logShort(`llm budget: ${verdict.reason}`);
    return { status: 'blocked' };
  }
  try {
    const model = await resolveModel();
    const response = await llmTransport.chat({
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
    const text = content.trim();
    return text.length > 0 ? { status: 'text', text } : { status: 'failed' };
  } catch (error) {
    logShort(`llm chat: ${shortError(error)}`);
    return { status: 'failed' };
  }
}

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

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clipText(text: string, max = MAX_INPUT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function num(value: number): string {
  return String(round2(value)).replace('.', ',');
}