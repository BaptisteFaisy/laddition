import { Cell, Fragment, Head, Row, Table, Text } from '@forge/ui';
import type { DeadDebt } from '../../core/types.ts';
import { listDeadDebt } from '../api.ts';
import { useResolver } from '../async.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatDate, formatNumber } from '../format.ts';
import { AsyncView } from './AsyncView.tsx';

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
  if (items.length === 0) return <Text>{t(locale, 'dead.empty')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'dead.title')}</Text>
      <Text>{t(locale, 'dead.body', { days: formatNumber(locale, deadDays) })}</Text>
      <Table>
        <Head>
          <Cell><Text>{t(locale, 'dead.col.debt')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.days')}</Text></Cell>
          <Cell><Text>{t(locale, 'dead.col.lastEvidence')}</Text></Cell>
        </Head>
        {items.map((debt) => (
          <Row key={debt.debtIssueId}>
            <Cell><Text>{debt.key}</Text></Cell>
            <Cell><Text>{debt.zone || t(locale, 'common.unclassified')}</Text></Cell>
            <Cell><Text>{formatNumber(locale, debt.daysWithoutEvidence)}</Text></Cell>
            <Cell><Text>{debt.lastEvidenceAt ? formatDate(locale, debt.lastEvidenceAt) : t(locale, 'dead.never')}</Text></Cell>
          </Row>
        ))}
      </Table>
    </Fragment>
  );
}
