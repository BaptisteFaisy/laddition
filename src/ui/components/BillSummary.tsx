import { Fragment, Text } from '../kit';
import type { DebtBillView } from '../api';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatNumber, pair } from '../format';
import { BillFamilies } from './BillFamilies';
import { MatchList } from './MatchList';
import { RangeBadge } from './RangeBadge';
import { ReturnBlock } from './ReturnBlock';
import { TicketLink } from './TicketLink';

/**
 * Le corps d'une addition : la dette et sa zone, la fourchette, les familles,
 * les preuves, les rapprochements, le retour.
 *
 * La clé de la dette est cliquable (item D50) et le bandeau « données
 * d'exemple » n'est plus posé ici : `ScreenShell` le pose une fois pour les six
 * écrans (item D58).
 */
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
  const visible = new Set(view.evidence.filter((item) => item.visible).map((item) => item.id));
  return (
    <Fragment>
      {view.zone === '' ? <Text>{t(locale, 'panel.noZone')}</Text> : null}
      <Text>{t(locale, 'common.debt')}</Text>
      <TicketLink issueKey={bill.key} />
      <Text>{pair(locale, t(locale, 'common.zone'), view.zone || t(locale, 'common.unclassified'))}</Text>
      <RangeBadge locale={locale} lowJp={bill.lowJp} highJp={bill.highJp} />
      <Text>{t(locale, 'panel.range', { days: formatNumber(locale, settings.windowDays) })}</Text>
      {bill.hiddenCount > 0 ? <Text>{t(locale, 'panel.hidden', { count: bill.hiddenCount })}</Text> : null}
      <BillFamilies locale={locale} view={view} />
      <MatchList
        locale={locale}
        debtIssueId={bill.debtIssueId}
        matches={view.pendingMatches}
        visibleEvidenceIds={visible}
        onChanged={onChanged}
      />
      <ReturnBlock locale={locale} bill={bill} />
    </Fragment>
  );
}
