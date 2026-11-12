import assert from 'node:assert/strict';
import test from 'node:test';
import { formulaText, inputLabel, inputValue } from './domain-strings';

/**
 * Item D54/A54 : la formule brute du domaine (français, valeurs réelles) doit
 * s'afficher en anglais dans l'UI anglaise — une seule implémentation pour les
 * cinq familles. Chaque formule ci-dessous reprend le texte exact produit par
 * `src/core/families/c1..c5.ts` ; toute évolution du domaine doit les mettre
 * à jour, ce qui casse le test au lieu de casser la traduction en silence.
 */

/** Mots français (non anglais) qui ne doivent jamais survivre à la traduction. */
const FRENCH_LEFTOVERS =
  /\b(j-p|jours|ouvrés|temps|saisi|reprise|dette|refusée|refusées|réouverture|statuts|retard|arrêté|calcul|insuffisantes|coût|chiffré|centile|surcoûts|durée|approchée|personne|relecteur|relecteurs|absente)\b|[«»]|\baujourd’hui\b/;

const C1_CALC = '12 j ouvrés × 2 intervenant(s) (plafond 3) = 24 j-p + bonus post-mortem 1 j-p incident en cours, arrêté au 2026-11-11';
const C1_LOGGED = 'temps saisi 28800 s ÷ 7 h/j = 1,14 j-p (le temps saisi remplace le calcul)';
const C2_ACTIVE = '12,5 j ouvrés en cours × 1 personne = 12,5 j-p';
const C2_MISSING = '8 j ouvrés (création → résolution, historique de statuts absent) × 1 personne = 8 j-p';
const C3_FULL = 'max(0, 12 − 5) × 0.5 = 3.5 j-p ; surcoût raboté au 95e centile sur 12 surcoûts du lot ; durée approchée (création → résolution) : workflow sans statut actif';
const C3_POOR = 'données insuffisantes : moins de 5 tickets de référence pour Bug:m (2 trouvés) ; coût non chiffré';
const C4_FALLBACK =
  '1 réouverture(s) × 9 j ouvrés de reprise × 1 personne (temps en statut de revue compris, lu dans les séjours de statut) = 9 j-p ;' +
  ' part de la zone « api » : 9 j-p. Temps saisi du ticket absent non retenu : C4 mesure le temps de reprise,' +
  ' le temps saisi est déjà compté en C2/C3.' +
  ' PR refusées : source absente — repli assumé, le chiffre vient du temps passé en statut de revue (séjours de statut), pas de PR refusées.';
const C4_PRS =
  '1 réouverture(s) × 9 j ouvrés de reprise × 1 personne (temps en statut de revue compris, lu dans les séjours de statut) + PR refusée(s) repo#42 : 2 j de revue × 3 relecteur(s) = 15 j-p ;' +
  ' part de la zone « api » : 15 j-p. Temps saisi du ticket (2 h pour 7 h/j) non retenu : C4 mesure le temps de reprise,' +
  ' le temps saisi est déjà compté en C2/C3.';
const C5_DELAY =
  'Bloqué par ADD-9 (ticket de dette) : 4 jours calendaires passés bloqué pendant que la dette était ouverte (du 2026-10-01' +
  " jusqu'à la résolution de la dette le 2026-10-05) ; part de la zone « api » : 4 jours de retard. Délai, pas effort : hors addition.";

const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['C1 calculé', C1_CALC,
    '12 business days × 2 people involved (cap 3) = 24 p-d + post-mortem bonus 1 p-d incident still open, stopped at 2026-11-11'],
  ['C1 temps saisi', C1_LOGGED,
    'logged time 28800 s ÷ 7 h/day = 1.14 p-d (logged time replaces the computation)'],
  ['C2 statuts actifs', C2_ACTIVE,
    '12.5 business days in active statuses × 1 person = 12.5 p-d'],
  ['C2 historique absent', C2_MISSING,
    '8 business days (creation → resolution, status history unavailable) × 1 person = 8 p-d'],
  ['C3 surcoût', C3_FULL,
    'max(0, 12 − 5) × 0.5 = 3.5 p-d; overrun clipped at the 95th percentile across 12 overruns in the lot; approximated duration (creation → resolution): workflow with no active status'],
  ['C3 données insuffisantes', C3_POOR,
    'insufficient data: fewer than 5 reference tickets for Bug:m (2 found); no cost computed'],
  ['C4 repli PR absente', C4_FALLBACK,
    '1 reopening(s) × 9 business days of rework × 1 person (review-status time included, read from the status spans) = 9 p-d; share of zone "api": 9 p-d.' +
    ' Ticket logged time absent not kept: C4 measures the rework time; logged time is already counted in C2/C3.' +
    ' Rejected PRs: source absent — assumed fallback; the figure comes from time spent in review status (status spans), not from rejected PRs.'],
  ['C4 avec PR refusées', C4_PRS,
    '1 reopening(s) × 9 business days of rework × 1 person (review-status time included, read from the status spans) + Rejected PR(s) repo#42: 2 review days × 3 reviewer(s) = 15 p-d; share of zone "api": 15 p-d.' +
    ' Ticket logged time (2 h for 7 h/day) not kept: C4 measures the rework time; logged time is already counted in C2/C3.'],
  ['C5 retard induit', C5_DELAY,
    'Blocked by ADD-9 (debt ticket): 4 calendar days spent blocked while the debt was open (from 2026-10-01 up to the resolution of the debt on 2026-10-05); share of zone "api": 4 days of delay. Delay, not effort: excluded from the total.'],
];

for (const [name, french, english] of CASES) {
  test(`A54 — ${name} : formule traduite intégralement en anglais`, () => {
    assert.equal(formulaText('en', french), english);
    assert.doesNotMatch(formulaText('en', french), FRENCH_LEFTOVERS);
  });

  test(`A54 — ${name} : le français passe tel quel`, () => {
    assert.equal(formulaText('fr', french), french);
  });
}

test('A54 — fragment inconnu : rendu tel quel plutôt que perdu (§18)', () => {
  const inconnu = '12 j ouvrés × terme jamais vu = 24 j-p';
  const out = formulaText('en', inconnu);
  assert.match(out, /terme jamais vu/);
  assert.match(out, /12 business days × /);
});

test('A54 — virgule décimale française devenue point en anglais', () => {
  assert.equal(formulaText('en', '= 1,25 j-p'), '= 1.25 p-d');
  assert.equal(formulaText('fr', '= 1,25 j-p'), '= 1,25 j-p');
});

test('A14 — entrées C4 sans clé i18n : libellés locaux, valeur nulle = donnée absente', () => {
  assert.equal(inputLabel('en', 'prRefusees'), 'Rejected PRs (from the graph)');
  assert.equal(inputLabel('fr', 'prRefusees'), 'PR refusées (du graphe)');
  assert.equal(inputLabel('en', 'revueJp'), 'Rejected-PR review time (p-d)');
  assert.equal(inputLabel('en', 'inconnu'), 'inconnu');
  assert.equal(inputValue('en', null), '—');
});
