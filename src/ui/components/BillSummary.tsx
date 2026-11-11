import { Fragment, Text } from '@forge/ui';
import type { DebtBillView } from '../api.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatNumber } from '../format.ts';
import { BillFamilies } from './BillFamilies.tsx';
import { DemoBanner } from './DemoBanner.tsx';
import { MatchList } from './MatchList.tsx';
import { RangeBadge } from './RangeBadge.tsx';
import { ReturnBlock } from './ReturnBlock.tsx';

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
