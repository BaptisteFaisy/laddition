import { Fragment, Text } from '../kit';
import type { DebtBillView } from '../api';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatNumber } from '../format';
import { BillFamilies } from './BillFamilies';
import { DemoBanner } from './DemoBanner';
import { MatchList } from './MatchList';
import { RangeBadge } from './RangeBadge';
import { ReturnBlock } from './ReturnBlock';

/** Le corps d'une addition : fourchette, familles, preuves, rapprochements, retour. */
export function BillSummary({
  locale,
  view,
  onChanged,
}: {
  locale: Locale;
  view: DebtBillView;
  onChanged: () => void;
}): JSX.Element {
  const { bill, settings } = view;
  return (
    <Fragment>
      <DemoBanner locale={locale} demoData={settings.demoData} />
      {view.zone === '' ? <Text>{t(locale, 'panel.noZone')}</Text> : null}
      <RangeBadge locale={locale} lowJp={bill.lowJp} highJp={bill.highJp} />
      <Text>{t(locale, 'panel.range', { days: formatNumber(locale, settings.windowDays) })}</Text>
      {bill.hiddenCount > 0 ? <Text>{t(locale, 'panel.hidden', { count: bill.hiddenCount })}</Text> : null}
      <BillFamilies locale={locale} view={view} />
      <MatchList locale={locale} debtIssueId={bill.debtIssueId} matches={view.pendingMatches} onChanged={onChanged} />
      <ReturnBlock locale={locale} bill={bill} />
    </Fragment>
  );
}
