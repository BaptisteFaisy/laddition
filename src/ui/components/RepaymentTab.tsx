import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { Repayment } from '../../core/types';
import { getRepaymentReport } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDate, formatJp, pair } from '../format';
import { AsyncView } from './AsyncView';

/** Bulletins de remboursement (§11) : une comparaison, jamais une causalité. */
export function RepaymentTab({ locale, projectId }: { locale: Locale; projectId: string }): JSX.Element {
  const resolver = useResolver(projectId, () => getRepaymentReport(projectId));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(items) => <RepaymentTable locale={locale} items={items} />}
    />
  );
}

function RepaymentTable({ locale, items }: { locale: Locale; items: Repayment[] }): JSX.Element {
  if (items.length === 0) return <Text>{t(locale, 'repay.empty')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'repay.title')}</Text>
      <Text>{t(locale, 'repay.body')}</Text>
      <Table>
        <Head>
          <Cell><Text>{t(locale, 'repay.col.debt')}</Text></Cell>
          <Cell><Text>{t(locale, 'repay.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'repay.col.before')}</Text></Cell>
          <Cell><Text>{t(locale, 'repay.col.after')}</Text></Cell>
          <Cell><Text>{t(locale, 'repay.col.weeks')}</Text></Cell>
        </Head>
        {items.map((repayment) => (
          <RepaymentRow key={repayment.debtIssueId} locale={locale} repayment={repayment} />
        ))}
      </Table>
    </Fragment>
  );
}

function RepaymentRow({ locale, repayment }: { locale: Locale; repayment: Repayment }): JSX.Element {
  return (
    <Row>
      <Cell>
        <Text>{repayment.key}</Text>
        <Text>{formatDate(locale, repayment.closedAt)}</Text>
      </Cell>
      <Cell><Text>{repayment.zone || t(locale, 'common.unclassified')}</Text></Cell>
      <Cell><Text>{formatJp(locale, repayment.beforeRate)}</Text></Cell>
      <Cell><Text>{formatJp(locale, repayment.afterRate)}</Text></Cell>
      <Cell>
        <Text>
          {t(locale, 'repay.weeksValue', { before: repayment.weeksBefore, after: repayment.weeksAfter })}
        </Text>
        <Text>{pair(locale, t(locale, 'repay.caveats'), repayment.caveats.join(' · '))}</Text>
        <Text>{repayment.publishedAt ? formatDate(locale, repayment.publishedAt) : t(locale, 'repay.unpublished')}</Text>
      </Cell>
    </Row>
  );
}
