import { Cell, Head, Row, Table, Text } from '@forge/ui';
import type { RankedDebt } from '../../core/types.ts';
import type { QuarterCost, TeamCost } from '../api.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatJp } from '../format.ts';
import { RangeBadge } from './RangeBadge.tsx';

/** Les principales dettes du gadget : un classement tronqué, rien de calculé ici. */
export function TopDebtsTable({ locale, debts }: { locale: Locale; debts: RankedDebt[] }): JSX.Element {
  if (debts.length === 0) return <Text>{t(locale, 'gadget.empty')}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{t(locale, 'project.col.debt')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.range')}</Text></Cell>
      </Head>
      {debts.map((debt) => (
        <Row key={debt.debtIssueId}>
          <Cell>
            <Text>{debt.key}</Text>
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
  if (rows.length === 0) return <Text>{t(locale, 'gadget.empty')}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{t(locale, 'zones.col.team')}</Text></Cell>
        <Cell><Text>{t(locale, 'zones.col.cost')}</Text></Cell>
      </Head>
      {rows.map((row) => (
        <Row key={row.team}>
          <Cell><Text>{row.team || t(locale, 'zones.noTeam')}</Text></Cell>
          <Cell><Text>{formatJp(locale, row.costJp)}</Text></Cell>
        </Row>
      ))}
    </Table>
  );
}

/** Coût par trimestre : la tendance, pas la prévision. */
export function QuarterCostTable({ locale, rows }: { locale: Locale; rows: QuarterCost[] }): JSX.Element {
  if (rows.length === 0) return <Text>{t(locale, 'gadget.empty')}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{t(locale, 'gadget.quarter')}</Text></Cell>
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
