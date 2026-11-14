import { Fragment, Text } from '../kit';
import type { Family } from '../../core/types';
import { formulaOf } from '../../i18n/domain-strings';
import type { Locale } from '../../i18n/index';
import { familyLabel, pair } from '../format';

/** Les cinq familles et leur formule, sans les coefficients (item D54). */
const FAMILIES: readonly Family[] = ['C1', 'C2', 'C3', 'C4', 'C5'];

/**
 * Liste des formules, dans la langue de l'écran.
 *
 * Sert là où les réglages ne sont pas chargés (le gadget, item D40) : la
 * méthode reste à un clic de chaque chiffre, sans transporter tout l'état.
 */
export function FormulaList({ locale }: { locale: Locale }): JSX.Element {
  return (
    <Fragment>
      {FAMILIES.map((family) => (
        <Text key={family}>{pair(locale, familyLabel(locale, family), formulaOf(locale, family))}</Text>
      ))}
    </Fragment>
  );
}
