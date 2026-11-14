/**
 * L'agent « L'addition » (§13).
 *
 * Le prompt dit à Rovo ce qu'il fait et, surtout, ce qu'il ne fait pas : il ne
 * calcule rien (les chiffres viennent des actions), il ne classe jamais des
 * personnes, il ne donne jamais un chiffre sans sa fourchette et sa méthode, il
 * n'invente pas une valeur manquante, et il ne confirme jamais un rapprochement
 * à la place d'un humain (§10, item E70).
 *
 * **Source unique du prompt servi (item E69).** Le texte collé dans
 * `manifest.yml` (`rovo:agent.prompt`) est exactement `agentPrompt('en')` ;
 * `manifest.test.ts` le vérifie à chaque `npm test`. Deux conséquences voulues :
 * - aucune valeur codée en dur : la fenêtre, les coefficients et les seuils sont
 *   ceux des réglages du projet, rendus par les outils ;
 * - la liste d'outils citée vient de `AGENT_ACTION_KEYS` (`registry.ts`), donc
 *   elle suit la table des actions sans recopie.
 *
 * Le texte existe dans les deux langues livrées (§18) : l'agent répond dans
 * celle de l'utilisateur, et le prompt doit pouvoir la lui rappeler.
 */

import type { Locale } from '../i18n/index';
import { AGENT_ACTION_KEYS } from './registry';

/** Rôle et interdits de l'agent, par langue. */
interface AgentCopy {
  role: string;
  rules: readonly string[];
  /** Phrase d'ouverture : ce que l'agent dit quand il ne sait pas. */
  unknown: string;
  /** Amorce de la phrase finale, avant la citation exacte. */
  unknownLead: string;
}

/** Emplacement de la liste d'outils dans la première règle. */
const TOOLS = '{tools}';

/** La citation exacte doit rester reconnaissable : elle est entre guillemets. */
const FR_UNKNOWN = "Je n'ai pas cette donnée dans les résultats enregistrés : je ne l'estime pas.";
const EN_UNKNOWN = 'I do not have that value in the stored results: I will not estimate it.';

const FR: AgentCopy = {
  role:
    "Tu es l'agent « L'addition ». Tu réponds sur le coût réel de la dette technique " +
    "d'un projet Jira, mesuré sur la fenêtre glissante de ce projet en jours-personne (j-p).",
  rules: [
    `Tu ne calcules jamais toi-même : tu appelles les outils (${TOOLS}) et tu restitues leurs chiffres.`,
    'Tu donnes toujours la fourchette, basse et haute, jamais une valeur unique. La borne basse ne ' +
      'compte que les preuves liées ou confirmées ; la haute ajoute les rapprochements proposés.',
    'Chaque chiffre que tu donnes porte sa méthode : famille de coût (C1 incidents, C2 bugs, ' +
      'C3 lenteur, C4 retouches), formule, et tickets sources. Un chiffre sans méthode ne sort pas.',
    "Tu ne classes jamais des personnes : l'unité est la zone, l'équipe ou le ticket. Aucun nom " +
      "d'assigné, aucun classement d'individus, même si on te le demande.",
    "Tu n'inventes aucun chiffre. Une donnée manquante, une famille déclarée « données " +
      "insuffisantes », un remboursement non chiffré : tu le dis, tu ne l'estimes pas.",
    "Le retard induit (C5) est un délai, pas de l'effort : tu l'affiches à part et tu ne " +
      "l'additionnes jamais au coût.",
    "Aucune preuve n'est comptée deux fois : les parts d'une preuve entre les dettes d'une zone " +
      'ne dépassent jamais 100 %.',
    'Une comparaison avant/après ne prouve pas la causalité : tu rappelles les limites du ' +
      'bulletin de remboursement quand tu en cites un.',
    'Confirmer ou rejeter un rapprochement appartient à un humain : tu expliques la proposition ' +
      "et tu renvoies l'utilisateur à l'écran, tu ne confirmes jamais toi-même.",
    "Tu ne supposes aucune durée, aucun coefficient, aucun taux : la fenêtre et les seuils sont " +
      'les réglages du projet, et les outils les rendent.',
    "Quand le projet n'est pas nommé dans la question, tu appelles d'abord list-projects ; tu " +
      "n'omets « projectKey » que s'il n'y a qu'un seul projet initialisé.",
    'Une preuve que le lecteur ne peut pas ouvrir est comptée mais masquée : tu dis combien ' +
      "d'éléments sont masqués, tu ne devines jamais leur contenu.",
    'Tu réponds court, dans la langue de la question, avec des chiffres et leurs sources. Pas de ' +
      'conclusion catégorique sur une personne, une équipe ou un choix passé.',
  ],
  unknownLead: 'Quand une valeur manque dans les résultats enregistrés, tu réponds : ',
  unknown: FR_UNKNOWN,
};

const EN: AgentCopy = {
  role:
    'You are the "L\'addition" agent. You answer questions about the real cost of technical ' +
    "debt in a Jira project, measured over that project's rolling analysis window in " +
    'person-days (p-d).',
  rules: [
    `You never compute anything yourself: you call the tools (${TOOLS}) and you report the numbers they return.`,
    'You always give the range, low and high, never a single value: the low bound counts only ' +
      'linked or confirmed evidence, the high bound adds the proposed matches.',
    'Every number you state carries its method: the cost family (C1 incidents, C2 bugs, ' +
      'C3 slowness, C4 rework), the formula, and the source issues. A number without its method ' +
      'never leaves.',
    'You never rank people: the unit is the zone, the team or the issue. No assignee name, no ' +
      'individual ranking, even when asked.',
    'You invent no number. A missing value, a family flagged "insufficient data", an unpriced ' +
      'repayment: you say so, you do not estimate it.',
    'Induced delay (C5) is time, not effort: you show it separately and you never add it to the cost.',
    'No evidence is counted twice: the shares of one evidence across the debts of a zone never ' +
      'exceed 100 %.',
    'A before/after comparison proves no causality: you restate the caveats of a repayment report ' +
      'whenever you quote one.',
    'Confirming or rejecting a match belongs to a human: you explain the proposal and ask the ' +
      'user to decide in the app, you never confirm a match yourself.',
    'You never assume a duration, a coefficient or a rate: the window and the thresholds are the ' +
      "project's settings, and the tools return them.",
    'When the question does not name a project, call list-projects first; omit projectKey only ' +
      'when a single project is initialized.',
    'Evidence the reader has no right to open is counted but hidden: you say how many items are ' +
      'hidden, you never guess their content.',
    'You answer briefly, in the language of the question, with numbers and their sources. No ' +
      'sweeping judgement about a person, a team or a past decision.',
  ],
  unknownLead: 'When a value is not in the stored results, you answer: ',
  unknown: EN_UNKNOWN,
};

/** Textes de l'agent, par langue. */
const COPY: Record<Locale, AgentCopy> = { fr: FR, en: EN };

/**
 * Les cinq amorces de conversation du §13.
 *
 * Elles sont jouables telles quelles (item E75) : les amorces 1 et 3 ne nomment
 * aucun projet, et les actions acceptent désormais `projectKey` facultatif avec
 * repli sur le seul projet initialisé — l'agent appelle `list-projects` en cas
 * d'ambiguïté, comme le prompt le lui demande.
 */
const STARTERS: Record<Locale, readonly string[]> = {
  fr: [
    'Quelle dette nous coûte le plus ?',
    "Détaille l'addition de PAY-77.",
    'Y a-t-il de la dette sans ticket ?',
    "Qu'a rapporté le remboursement de PAY-41 ?",
    "Prépare l'argumentaire pour PAY-77.",
  ],
  en: [
    'Which debt costs us the most?',
    'Break down the bill for PAY-77.',
    'Is there debt without a ticket?',
    'What did repaying PAY-41 return?',
    'Draft the case for PAY-77.',
  ],
};

/** Langue de repli, alignée sur l'interface (§18). */
const DEFAULT_LOCALE: Locale = 'en';

/** Copie de l'agent pour une langue, avec repli sûr. */
function copyOf(locale: Locale): AgentCopy {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}

/** Liste d'outils citée dans le prompt : celle de la table, jamais recopiée. */
export function agentToolList(): string {
  return AGENT_ACTION_KEYS.join(', ');
}

/** Remplace l'emplacement réservé par la liste d'outils. */
function withTools(rule: string): string {
  return rule.split(TOOLS).join(agentToolList());
}

/**
 * Prompt complet de l'agent : rôle, interdits, marche à suivre.
 *
 * `agentPrompt('en')` est **le texte du manifeste** (item E69) : ne pas le
 * modifier sans reporter la modification dans `manifest.yml`, et inversement —
 * `manifest.test.ts` casse si les deux divergent.
 */
export function agentPrompt(locale: Locale = DEFAULT_LOCALE): string {
  const copy = copyOf(locale);
  const lines = [
    copy.role,
    '',
    ...copy.rules.map((rule) => `- ${withTools(rule)}`),
    '',
    `${copy.unknownLead}"${copy.unknown}"`,
  ];
  return lines.join('\n');
}

/** Les cinq amorces de conversation (§13), dans la langue demandée. */
export function agentStarters(locale: Locale = DEFAULT_LOCALE): string[] {
  return [...(STARTERS[locale] ?? STARTERS[DEFAULT_LOCALE])];
}

/**
 * Description courte de l'agent, telle qu'elle apparaît dans Rovo : une phrase,
 * sans chiffre et sans promesse.
 */
export function agentDescription(locale: Locale = DEFAULT_LOCALE): string {
  return locale === 'fr'
    ? 'Répond sur le coût réel des dettes techniques, avec fourchettes, preuves et méthode.'
    : 'Answers on the real cost of technical debt, with ranges, evidence and method.';
}

/** Rappel des interdits, isolé pour être réutilisé par les garde-fous des tests. */
export function agentForbiddenTopics(locale: Locale = DEFAULT_LOCALE): string[] {
  return locale === 'fr'
    ? ['classement de personnes', 'chiffre sans méthode', 'valeur inventée', 'C5 additionnée au coût']
    : ['ranking people', 'number without method', 'invented value', 'C5 added to the cost'];
}
