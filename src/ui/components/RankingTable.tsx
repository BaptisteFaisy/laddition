import { Button, Cell, Head, Row, Table, Text } from '@forge/ui';
import type { RankedDebt } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatDays, formatJp, formatRatio } from '../format.ts';
import { RangeBadge } from './RangeBadge.tsx';

/**
 * Le classement (DT-07) : coût décroissant, puis retour. Aucune colonne
 * assigné ou auteur : la vue ne totalise jamais par personne (§18).
 */
export function RankingTable({
  locale,
  ranking,
  selectedId,
  onSelect,
}: {
  locale: Locale;
  ranking: RankedDebt[];
  selectedId: string | null;
  onSelect: (debtIssueId: string) => void;
}): JSX.Element {
  if (ranking.length === 0) return <Text>{t(locale, 'project.rankingEmpty')}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{t(locale, 'project.col.debt')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.zone')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.range')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.repayment')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.return')}</Text></Cell>
        <Cell><Text>{t(locale, 'project.col.payback')}</Text></Cell>
      </Head>
      {ranking.map((row) => (
        <RankingRow key={row.debtIssueId} locale={locale} row={row} selected={selectedId === row.debtIssueId} onSelect={onSelect} />
      ))}
    </Table>
  );
}

function RankingRow({
  locale,
  row,
  selected,
  onSelect,
}: {
  locale: Locale;
  row: RankedDebt;
  selected: boolean;
  onSelect: (debtIssueId: string) => void;
}): JSX.Element {
  const repayment = row.repaymentJp === null ? t(locale, 'project.unpriced') : formatJp(locale, row.repaymentJp);
  return (
    <Row>
      <Cell>
        <Button
          appearance={selected ? 'primary' : 'subtle-link'}
          text={row.key}
          onClick={() => onSelect(row.debtIssueId)}
        />
      </Cell>
      <Cell><Text>{row.zone || t(locale, 'common.unclassified')}</Text></Cell>
      <Cell><RangeBadge locale={locale} lowJp={row.lowJp} highJp={row.highJp} /></Cell>
      <Cell><Text>{repayment}</Text></Cell>
      <Cell><Text>{formatRatio(locale, row.roiLow)}</Text></Cell>
      <Cell><Text>{formatDays(locale, row.paybackDays)}</Text></Cell>
    </Row>
  );
}
