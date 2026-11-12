import type { Family } from '../core/types';
import {
  CAVEAT_COMPARISON,
  CAVEAT_INSUFFICIENT_RECUL,
  CAVEAT_OTHER_CHANGES,
} from '../core/repayment';
import { UNKNOWN_TEAM } from '../resolvers/aggregate';
import type { Locale, MessageKey } from './i18n/index';
import { t } from './i18n/index';

/**
 * Chaînes produites par le domaine en français (formules, limites du bulletin,
 * équipe inconnue) : elles traversent l'UI anglaise (item D54).
 *
 * Sans toucher au domaine ni à `src/ui/i18n/**`, ce module les traduit à
 * l'affichage : les formules brutes des cinq familles passent par
 * `formulaText`, **une seule implémentation** — un dictionnaire de fragments
 * appliqué dans l'ordre du plus long au plus court. Un fragment inconnu reste
 * tel quel : mieux vaut du français que du silence sur le calcul (§18).
 */

/** Préfixe de la limite d'échantillon (`src/core/repayment.ts`, non exporté). */
const SAMPLE_CAVEAT_PREFIX = 'échantillon de ';

/** Formule i18n d'une famille, sans les coefficients (ils sont dans les entrées). */
const FORMULA_KEYS: Record<Family, MessageKey> = {
  C1: 'evidence.formula.C1',
  C2: 'evidence.formula.C2',
  C3: 'evidence.formula.C3',
  C4: 'evidence.formula.C4',
  C5: 'evidence.formula.C5',
};

/** Noms d'entrées écrits par le domaine, traduits à l'affichage. */
const INPUT_KEYS: Record<string, MessageKey> = {
  durationDays: 'input.durationDays',
  participants: 'input.participants',
  maxParticipants: 'input.maxParticipants',
  postMortem: 'input.postMortem',
  loggedSeconds: 'input.loggedSeconds',
  enCours: 'input.enCours',
  persons: 'input.persons',
  statusHistory: 'input.statusHistory',
  duree: 'input.duree',
  reference: 'input.reference',
  echantillon: 'input.echantillon',
  coefficient: 'input.coefficient',
  centile: 'input.centile',
  reouvertures: 'input.reouvertures',
  joursReprise: 'input.joursReprise',
  delai: 'input.delai',
  joursBloques: 'input.joursBloques',
  ticketBloquant: 'input.ticketBloquant',
};

/**
 * Entrées sans clé i18n (C4, item A14) : libellés littéraux bilingues, gardés
 * ici car `src/ui/i18n/**` est interdit au lot.
 */
const LOCAL_INPUT_LABELS: Record<string, Record<Locale, string>> = {
  prRefusees: { en: 'Rejected PRs (from the graph)', fr: 'PR refusées (du graphe)' },
  revueJp: { en: 'Rejected-PR review time (p-d)', fr: 'Temps de revue des PR refusées (j-p)' },
};

/**
 * Fragments français des formules du domaine (C1 à C5, `src/core/families/*`)
 * et leur anglais. Ordre impératif : du plus long au plus court, pour que les
 * phrases entières soient traduites avant les mots qu'elles contiennent.
 * Seuls les nombres, dates, clés et zones varient autour de ces fragments.
 */
const FORMULA_FRAGMENTS: ReadonlyArray<readonly [string, string]> = [
  // C4 — repli assumé quand la source n'expose pas les PR (item A14).
  [' PR refusées : source absente — repli assumé, le chiffre vient du temps passé en statut de revue (séjours de statut), pas de PR refusées.',
    ' Rejected PRs: source absent — assumed fallback; the figure comes from time spent in review status (status spans), not from rejected PRs.'],
  [' personne (temps en statut de revue compris, lu dans les séjours de statut)',
    ' person (review-status time included, read from the status spans)'],
  ['temps en statut de revue, lu dans les séjours de statut', 'review-status time, read from the status spans'],
  [' non retenu : C4 mesure le temps de reprise, le temps saisi est déjà compté en C2/C3.',
    ' not kept: C4 measures the rework time; logged time is already counted in C2/C3.'],
  // C1/C2 — temps saisi.
  [' j-p (le temps saisi remplace le calcul)', ' p-d (logged time replaces the computation)'],
  ['temps saisi ', 'logged time '],
  ['Temps saisi du ticket', 'Ticket logged time'],
  [' h/j = ', ' h/day = '],
  [' h pour ', ' h for '],
  [' h/j)', ' h/day)'],
  // C2 — origine de la durée.
  ['(création → résolution, historique de statuts absent)', '(creation → resolution, status history unavailable)'],
  ['(création → résolution, workflow sans statut actif)', '(creation → resolution, workflow with no active status)'],
  [' j ouvrés en cours × 1 personne = ', ' business days in active statuses × 1 person = '],
  [' × 1 personne = ', ' × 1 person = '],
  // C3 — surcoût et données insuffisantes.
  [' ; durée approchée (création → résolution) : historique de statuts absent',
    '; approximated duration (creation → resolution): status history unavailable'],
  [' ; durée approchée (création → résolution) : workflow sans statut actif',
    '; approximated duration (creation → resolution): workflow with no active status'],
  ['données insuffisantes : moins de ', 'insufficient data: fewer than '],
  [' tickets de référence pour ', ' reference tickets for '],
  [' trouvés) ; coût non chiffré', ' found); no cost computed'],
  [' j-p ; surcoût raboté au ', ' p-d; overrun clipped at the '],
  ['e centile sur ', 'th percentile across '],
  [' surcoûts du lot', ' overruns in the lot'],
  // C5 — retard induit.
  [' jours calendaires passés bloqué pendant que la dette était ouverte (du ',
    ' calendar days spent blocked while the debt was open (from '],
  ["jusqu'à aujourd'hui, blocage toujours en cours", 'up to today, blocking still in progress'],
  ["jusqu'à la résolution du ticket bloqué le ", 'up to the resolution of the blocked ticket on '],
  ["jusqu'à la résolution de la dette le ", 'up to the resolution of the debt on '],
  ['aujourd’hui', 'today'],
  ['Bloqué par ', 'Blocked by '],
  [' (ticket de dette) : ', ' (debt ticket): '],
  [' Délai, pas effort : hors addition.', ' Delay, not effort: excluded from the total.'],
  [' jours de retard.', ' days of delay.'],
  // C4 — termes de reprise et PR refusées.
  [' réouverture(s) × ', ' reopening(s) × '],
  [' j ouvrés de reprise × ', ' business days of rework × '],
  ['PR refusée(s) ', 'Rejected PR(s) '],
  [' j de revue × ', ' review days × '],
  [' j de revue', ' review days'],
  [' relecteur(s)', ' reviewer(s)'],
  // C1 — incident.
  ['incident en cours, arrêté au ', 'incident still open, stopped at '],
  ['+ bonus post-mortem ', '+ post-mortem bonus '],
  [' intervenant(s) (plafond ', ' people involved (cap '],
  // Fragments communs aux cinq familles.
  [' j ouvrés ', ' business days '],
  [' j-p ; part de la zone « ', ' p-d; share of zone "'],
  ['part de la zone « ', 'share of zone "'],
  [' » : ', '": '],
  ['en cours', 'in active statuses'],
  [' j-p.', ' p-d.'],
  [' j-p', ' p-d'],
  [' ; ', '; '],
  [' : ', ': '],
];

/** Formule d'une famille, dans la langue de l'écran. */
export function formulaOf(locale: Locale, family: Family): string {
  return t(locale, FORMULA_KEYS[family]);
}

/**
 * Formule brute du domaine (valeurs réelles incluses), dans la langue de
 * l'écran : une seule implémentation pour les cinq familles (item D54/A54).
 * En français elle est rendue telle quelle ; sinon les fragments connus sont
 * traduits et la virgule décimale devient un point. Ce qui n'est pas reconnu
 * reste en français plutôt que de disparaître (§18).
 */
export function formulaText(locale: Locale, formula: string): string {
  if (locale === 'fr') return formula;
  let out = formula;
  for (const [fr, en] of FORMULA_FRAGMENTS) {
    out = out.split(fr).join(en);
  }
  return out.replace(/(\d),(\d)/g, '$1.$2');
}

/** Nom d'une entrée de formule, dans la langue de l'écran (sinon le nom brut). */
export function inputLabel(locale: Locale, name: string): string {
  const key = INPUT_KEYS[name];
  if (key) return t(locale, key);
  return LOCAL_INPUT_LABELS[name]?.[locale] ?? name;
}

/** Valeur d'une entrée de formule, mise en forme sans chaîne française. */
export function inputValue(locale: Locale, value: number | string | boolean | null): string {
  if (value === null) return t(locale, 'common.none');
  if (typeof value === 'boolean') return t(locale, value ? 'common.yes' : 'common.no');
  return String(value);
}

/**
 * Limite d'un bulletin de remboursement, traduite quand elle est reconnue.
 * Une limite inconnue est rendue telle quelle : mieux vaut du français que du
 * silence sur ce qui borne le chiffre (§18).
 */
export function caveatLabel(locale: Locale, caveat: string): string {
  if (caveat === CAVEAT_COMPARISON) return t(locale, 'caveat.comparison');
  if (caveat === CAVEAT_OTHER_CHANGES) return t(locale, 'caveat.otherChanges');
  if (caveat === CAVEAT_INSUFFICIENT_RECUL) return t(locale, 'caveat.insufficientWindow');
  if (caveat.startsWith(SAMPLE_CAVEAT_PREFIX)) {
    return t(locale, 'caveat.sample', { weeks: caveat.slice(SAMPLE_CAVEAT_PREFIX.length) });
  }
  return caveat;
}

/** Libellé d'équipe : le domaine écrit « équipe non renseignée » en français. */
export function teamLabel(locale: Locale, team: string | undefined): string {
  if (!team || team === UNKNOWN_TEAM) return t(locale, 'zones.noTeam');
  return team;
}
