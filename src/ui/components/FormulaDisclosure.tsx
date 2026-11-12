import { Fragment, Text } from '../kit';
import type { EvidenceDetail, Family } from '../../core/types';
import { formulaOf, inputLabel, inputValue } from '../domain-strings';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDays, methodLabel, pair } from '../format';
import { Disclosure } from './Disclosure';

/**
 * Règle de transparence (§18) : chaque chiffre a sa formule à deux clics.
 * Clic 1 ouvre la ligne de preuve, clic 2 ouvre la formule.
 *
 * La formule et les noms d'entrées viennent de l'i18n (item D54) : le texte
 * écrit par le domaine reste affiché, mais en dernier, comme trace du calcul.
 */
export function FormulaDisclosure({
  locale,
  family,
  detail,
}: {
  locale: Locale;
  family: Family;
  detail: EvidenceDetail;
}): JSX.Element {
  return (
    <Disclosure label={t(locale, 'common.showFormula')} labelOpen={t(locale, 'common.hideFormula')}>
      <FormulaBody locale={locale} family={family} detail={detail} />
    </Disclosure>
  );
}

function FormulaBody({
  locale,
  family,
  detail,
}: {
  locale: Locale;
  family: Family;
  detail: EvidenceDetail;
}): JSX.Element {
  const inputs = Object.entries(detail.inputs);
  return (
    <Fragment>
      <Text>{pair(locale, t(locale, 'common.formula'), formulaOf(locale, family))}</Text>
      <Text>{pair(locale, t(locale, 'common.method'), methodLabel(locale, detail.method))}</Text>
      <Text>{pair(locale, t(locale, 'common.duration'), formatDays(locale, detail.durationDays))}</Text>
      <Text>{t(locale, 'evidence.inputs')}</Text>
      {inputs.map(([name, value]) => (
        <Text key={name}>{pair(locale, inputLabel(locale, name), inputValue(locale, value))}</Text>
      ))}
      <Text>{pair(locale, t(locale, 'evidence.rawFormula'), detail.formula)}</Text>
    </Fragment>
  );
}
