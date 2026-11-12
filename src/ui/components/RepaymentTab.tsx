import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { Repayment } from '../../core/types';
import { getRepaymentReport } from '../api';
import { useResolver } from '../async';
import { caveatLabel } from '../domain-strings';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDate, formatJp, pair } from '../format';
import { AsyncView } from './AsyncView';
import { TicketLink } from './TicketLink';

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
  const caption = t(locale, 'repay.title');
  return (
    <Fragment>
      <Text>{t(locale, 'repay.body')}</Text>
      <Table caption={caption} label={caption} empty={t(locale, 'repay.empty')}>
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
        <TicketLink issueKey={repayment.key} />
        <Text>{formatDate(locale, repayment.closedAt)}</Text>
      </Cell>
      <Cell><Text>{repayment.zone || t(locale, 'common.unclassified')}</Text></Cell>
      <Cell><Text>{formatJp(locale, repayment.beforeRate)}</Text></Cell>
      <Cell><Text>{formatJp(locale, repayment.afterRate)}</Text></Cell>
      <Cell>
        <Text>
          {t(locale, 'repay.weeksValue', { before: repayment.weeksBefore, after: repayment.weeksAfter })}
        </Text>
        <Caveats locale={locale} caveats={repayment.caveats} />
        <Text>{repayment.publishedAt ? formatDate(locale, repayment.publishedAt) : t(locale, 'repay.unpublished')}</Text>
      </Cell>
    </Row>
  );
}

/** Limites du bulletin, dans la langue de l'écran (item D54). */
function Caveats({ locale, caveats }: { locale: Locale; caveats: string[] }): JSX.Element {
  const text = caveats.map((caveat) => caveatLabel(locale, caveat)).join(' · ');
  return <Text>{pair(locale, t(locale, 'repay.caveats'), text)}</Text>;
}
