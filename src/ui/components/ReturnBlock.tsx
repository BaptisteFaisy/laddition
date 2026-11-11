import { Fragment, Heading, Text } from '../kit';
import type { DebtBill } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDays, formatJp, formatRatio, pair } from '../format';

/** Le retour (§11) : ce que la clôture rapporterait, ou pourquoi il n'est pas chiffré. */
export function ReturnBlock({ locale, bill }: { locale: Locale; bill: DebtBill }): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'panel.return')}</Heading>
      {bill.repaymentJp === null ? (
        <Text>{t(locale, 'panel.noRepayment')}</Text>
      ) : (
        <Fragment>
          <Text>{pair(locale, t(locale, 'project.col.repayment'), formatJp(locale, bill.repaymentJp))}</Text>
          <Text>{pair(locale, t(locale, 'panel.avoidable'), formatJp(locale, bill.avoidableJp))}</Text>
          <Text>
            {pair(locale, t(locale, 'panel.roi'), `${formatRatio(locale, bill.roiLow)} – ${formatRatio(locale, bill.roiHigh)}`)}
          </Text>
          <Text>{pair(locale, t(locale, 'panel.payback'), formatDays(locale, bill.paybackDays))}</Text>
        </Fragment>
      )}
    </Fragment>
  );
}
