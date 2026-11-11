import { Fragment, Text } from '@forge/ui';
import type { EvidenceDetail } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatDays, methodLabel, pair } from '../format.ts';
import { Disclosure } from './Disclosure.tsx';

/**
 * Règle de transparence (§18) : chaque chiffre a sa formule à deux clics.
 * Clic 1 ouvre la ligne de preuve, clic 2 ouvre la formule.
 */
export function FormulaDisclosure({ locale, detail }: { locale: Locale; detail: EvidenceDetail }): JSX.Element {
  return (
    <Disclosure label={t(locale, 'common.showFormula')} labelOpen={t(locale, 'common.hideFormula')}>
      <Fragment>
        <Text>{pair(locale, t(locale, 'common.formula'), detail.formula)}</Text>
        <Text>{pair(locale, t(locale, 'common.method'), methodLabel(locale, detail.method))}</Text>
        <Text>{pair(locale, t(locale, 'common.duration'), formatDays(locale, detail.durationDays))}</Text>
      </Fragment>
    </Disclosure>
  );
}
