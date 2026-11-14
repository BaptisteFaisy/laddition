import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formulaText, inputLabel, inputValue, methodText, zoneLabel } from './domain-strings';

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

/**
 * Textes de méthode de la simulation (`core/simulation.ts:methodTextOf`),
 * repris mot pour mot : toute évolution du domaine casse ces cas au lieu de
 * laisser du français apparaître en silence sous une interface anglaise.
 */
const SIM_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['bulletin publié : 3,4 − 0,6 = 2,8 j-p par semaine (coût de zone avant − après)',
    'published bulletin: 3.4 − 0.6 = 2.8 p-d per week (zone cost before − after)'],
  ['bulletin publié : aucune baisse observée (avant 3,4, après 3,4 j-p par semaine)',
    'published bulletin: no observed drop (before 3.4, after 3.4 p-d per week)'],
  ['addition stockée : 12 j-p évités sur deux trimestres (persistance déjà appliquée)',
    'stored bill: 12 p-d avoided over two quarters (persistence already applied)'],
  ['aucune addition stockée : capacité non chiffrable',
    'no stored bill: capacity cannot be priced'],
  ['addition stockée sans coût évitable chiffré (addition basse nulle ou absente)',
    'stored bill with no priced avoidable cost (null or missing low bill)'],
  ['dette absente du projet : sélection inconnue, aucun chiffre',
    'debt missing from the project: unknown selection, no figure'],
];

for (const [french, english] of SIM_METHODS) {
  test(`D54 — simulation : « ${french.slice(0, 28)}… » traduite intégralement`, () => {
    assert.equal(methodText('en', french), english);
    assert.doesNotMatch(methodText('en', french), FRENCH_LEFTOVERS);
  });
}

/**
 * Garde anti-dérive : les phrases de méthode sont lues dans la SOURCE du
 * domaine (`src/core/simulation.ts`), pas recopiées. Si le domaine ajoute ou
 * modifie une phrase sans que `SIM_METHOD_PHRASES` suive, la traduction laisse
 * du français à l’écran et ce test rougit — au lieu de le découvrir dans une
 * capture ou devant un juge (motif de `src/ui/table-rows.test.ts`).
 */
const SIM_SOURCE = readFileSync(
  new URL('../core/simulation.ts', import.meta.url),
  'utf8',
);

/** Phrases françaises retournées par `methodTextOf` et par la ligne inconnue. */
function domainMethodPhrases(): string[] {
  const body = SIM_SOURCE.slice(SIM_SOURCE.indexOf('function methodTextOf('));
  const literals = [
    ...body.matchAll(/return [`']([^`']+)[`']/g),
    ...SIM_SOURCE.matchAll(/methodText: ['`]([^`']+)['`]/g),
  ];
  return literals.map((match) => match[1] ?? '').filter((text) => text.length > 0);
}

test('D54 — garde : toute phrase de méthode du domaine est traduite sans français', () => {
  const phrases = domainMethodPhrases();
  assert.ok(phrases.length >= 5, `peu de phrases extraites (${phrases.length}) : la garde est aveugle`);
  const leaks = phrases
    .map((phrase) => methodText('en', interpolate(phrase)))
    .filter((text) => FRENCH_LEFTOVERS.test(text))
    .filter((text) => !/[{}]/.test(text));
  assert.deepEqual(leaks, [], `français rendu à l’écran : ${leaks.join(' | ')}`);
});

/** Remplace les interpolations `${…}` d’une phrase par une valeur numérique. */
function interpolate(phrase: string): string {
  return phrase.replace(/\$\{[^}]*\}/g, '1.5');
}

/** Première phrase de méthode, pour le cas « le français passe tel quel ». */
const FIRST_SIM = SIM_METHODS[0] as readonly [string, string];

test('D54 — simulation : le français passe tel quel, fragment inconnu conservé', () => {
  assert.equal(methodText('fr', FIRST_SIM[0]), FIRST_SIM[0]);
  const inconnu = 'origine jamais vue : 3 j-p';
  assert.match(methodText('en', inconnu), /origine jamais vue/);
  assert.match(methodText('en', inconnu), /3 p-d/);
});

test('D54 — zone du domaine : « non classé » et vide rendus dans la langue de l’écran', () => {
  assert.equal(zoneLabel('en', 'non classé'), 'Unclassified');
  assert.equal(zoneLabel('en', ''), 'Unclassified');
  assert.equal(zoneLabel('fr', 'non classé'), 'Non classé');
  assert.equal(zoneLabel('en', 'api'), 'api');
});
