import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { DeadDebt } from '../../core/types';
import { listDeadDebt } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatDate, formatNumber } from '../format';
import { AsyncView } from './AsyncView';
import { TicketLink } from './TicketLink';

/** Dette morte (DT-09) : un ticket de dette sans preuve depuis N jours. */
export function DeadTab({
  locale,
  projectId,
  deadDays,
}: {
  locale: Locale;
  projectId: string;
  deadDays: number;
}): JSX.Element {
  const resolver = useResolver(projectId, () => listDeadDebt(projectId));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(items) => <DeadTable locale={locale} deadDays={deadDays} items={items} />}
    />
  );
}

function DeadTable({
  locale,
  deadDays,
  items,
}: {
  locale: Locale;
  deadDays: number;
  items: DeadDebt[];
}): JSX.Element {
  const caption = t(locale, 'dead.title');
  return (
    <Fragment>
      <Text>{t(locale, 'dead.body', { days: formatNumber(locale, deadDays) })}</Text>
      <Table caption={caption} label={caption} empty={t(locale, 'dead.empty')}>
        <Head>
          <Cell><Text>{t(locale, 'dead.col.debt')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.days')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.lastEvidence')}</Text></Cell>
        </Head>
        {items.map((debt) => (
          <Row key={debt.debtIssueId}>
            <Cell><TicketLink issueKey={debt.key} /></Cell>
            <Cell><Text>{debt.zone || t(locale, 'common.unclassified')}</Text></Cell>
            <Cell><Text>{formatNumber(locale, debt.daysWithoutEvidence)}</Text></Cell>
            <Cell><Text>{debt.lastEvidenceAt ? formatDate(locale, debt.lastEvidenceAt) : t(locale, 'dead.never')}</Text></Cell>
          </Row>
        ))}
      </Table>
    </Fragment>
  );
}
