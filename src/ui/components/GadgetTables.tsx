import { Cell, Head, Row, Table, Text } from '../kit';
import type { RankedDebt } from '../../core/types';
import type { QuarterCost, TeamCost } from '../api';
import { teamLabel } from '../domain-strings';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatJp } from '../format';
import { RangeBadge } from './RangeBadge';
import { TicketLink } from './TicketLink';

/**
 * Les trois tableaux du gadget. Chaque clé de dette est cliquable (item D50),
 * chaque tableau porte son nom et son état vide (item D61), et l'équipe
 * inconnue est dite dans la langue de l'écran (item D54).
 */
export function TopDebtsTable({ locale, debts }: { locale: Locale; debts: RankedDebt[] }): JSX.Element {
  const caption = t(locale, 'gadget.top');
  return (
    <Table caption={caption} label={caption} empty={t(locale, 'gadget.empty')}>
      <Head>
        <Cell><Text>{t(locale, 'project.col.debt')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.range')}</Text></Cell>
      </Head>
      {debts.map((debt) => (
        <Row key={debt.debtIssueId}>
          <Cell>
            <TicketLink issueKey={debt.key} />
            <Text>{debt.zone || t(locale, 'common.unclassified')}</Text>
          </Cell>
          <Cell><RangeBadge locale={locale} lowJp={debt.lowJp} highJp={debt.highJp} /></Cell>
        </Row>
      ))}
    </Table>
  );
}

/** Coût par équipe : une équipe n'est pas une personne (§18). */
export function TeamCostTable({ locale, rows }: { locale: Locale; rows: TeamCost[] }): JSX.Element {
  const caption = t(locale, 'gadget.team');
  return (
    <Table caption={caption} label={caption} empty={t(locale, 'gadget.empty')}>
      <Head>
        <Cell><Text>{t(locale, 'zones.col.team')}</Text></Cell>
        <Cell><Text>{t(locale, 'zones.col.cost')}</Text></Cell>
      </Head>
      {rows.map((row) => (
        <Row key={row.team}>
          <Cell><Text>{teamLabel(locale, row.team)}</Text></Cell>
          <Cell><Text>{formatJp(locale, row.costJp)}</Text></Cell>
        </Row>
      ))}
    </Table>
  );
}

/** Coût par trimestre : la tendance, pas la prévision. */
export function QuarterCostTable({ locale, rows }: { locale: Locale; rows: QuarterCost[] }): JSX.Element {
  const caption = t(locale, 'gadget.quarter');
  return (
    <Table caption={caption} label={caption} empty={t(locale, 'gadget.empty')}>
      <Head>
        <Cell><Text>{t(locale, 'gadget.quarterCol')}</Text></Cell>
        <Cell><Text>{t(locale, 'zones.col.cost')}</Text></Cell>
      </Head>
      {rows.map((row) => (
        <Row key={row.quarter}>
          <Cell><Text>{row.quarter}</Text></Cell>
          <Cell><Text>{formatJp(locale, row.costJp)}</Text></Cell>
        </Row>
      ))}
    </Table>
  );
}
