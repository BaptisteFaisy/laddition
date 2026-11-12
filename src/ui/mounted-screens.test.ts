/**
 * Garde « tout est visible » : chaque fonctionnalité livrée a un point d'entrée
 * dans un écran.
 *
 * L'audit du 11/11 a trouvé deux fois le même défaut — un résolveur écrit,
 * testé, et jamais monté dans un écran (l'argumentaire DT-17, la simulation
 * DT-21). Le code est vert, la CI est verte, et le juge ne voit rien. Cette
 * garde lit les sources des six écrans et exige que chaque composant
 * fonctionnel y apparaisse : retirer un montage fait rougir la CI.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt, retrouvée depuis ce fichier de test. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Lit une source d'écran. */
function screen(relativePath: string): string {
  return readFileSync(`${ROOT}${relativePath}`, 'utf8');
}

/**
 * Un composant est monté s'il est connu de l'écran (importé, éventuellement
 * dans une liste, ou défini sur place) ET utilisé dans son JSX.
 */
function isMounted(relativePath: string, component: string): boolean {
  const source = screen(relativePath);
  const known = new RegExp(`import\\s*{[^}]*\\b${component}\\b`, 'm').test(source)
    || new RegExp(`function\\s+${component}\\s*\\(`, 'm').test(source);
  return known && source.includes(`<${component}`);
}

/** Fonctionnalité → écran qui doit la rendre. */
const ENTRY_POINTS: ReadonlyArray<{ screen: string; component: string; feature: string }> = [
  { screen: 'src/ui/project-page.tsx', component: 'RankingTable', feature: 'le classement (DT-07)' },
  { screen: 'src/ui/project-page.tsx', component: 'BillView', feature: 'l’addition d’une dette' },
  { screen: 'src/ui/project-page.tsx', component: 'CaseButton', feature: 'l’argumentaire (DT-17)' },
  { screen: 'src/ui/project-page.tsx', component: 'ZoneTab', feature: 'le coût par zone' },
  { screen: 'src/ui/project-page.tsx', component: 'PhantomTab', feature: 'la dette fantôme (DT-09)' },
  { screen: 'src/ui/project-page.tsx', component: 'DeadTab', feature: 'la dette morte' },
  { screen: 'src/ui/project-page.tsx', component: 'RepaymentTab', feature: 'les bulletins de remboursement' },
  { screen: 'src/ui/project-page.tsx', component: 'SimulationPane', feature: 'la simulation (DT-21)' },
  { screen: 'src/ui/project-page.tsx', component: 'MethodTab', feature: 'la méthode et sa qualité' },
  { screen: 'src/ui/issue-panel.tsx', component: 'CaseButton', feature: 'l’argumentaire depuis le ticket' },
  { screen: 'src/ui/settings-page.tsx', component: 'SettingsForm', feature: 'les réglages du projet' },
  { screen: 'src/ui/settings-page.tsx', component: 'BootstrapWizard', feature: 'l’initialisation (DT-12)' },
  { screen: 'src/ui/settings-page.tsx', component: 'SampleDataButton', feature: 'le jeu d’exemple' },
  { screen: 'src/ui/gadget.tsx', component: 'GadgetProjectPicker', feature: 'le gadget sans projet imposé' },
];

describe('Écrans — chaque fonctionnalité a un point d’entrée', () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry.feature} est monté dans ${entry.screen}`, () => {
      assert.equal(
        isMounted(entry.screen, entry.component),
        true,
        `${entry.component} n’est ni importé ni utilisé dans ${entry.screen} : ${entry.feature} est invisible`,
      );
    });
  }
});
