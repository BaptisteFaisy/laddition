import type { ReactNode } from 'react';
import { Button, Cell, Fragment, Head, markTableRow, Row, Table, Text } from '../kit';
import type { RankedDebt } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDays, formatJp, formatRatio } from '../format';
import { RangeBadge } from './RangeBadge';
import { TicketLink } from './TicketLink';

/**
 * Le classement (DT-07) : coût décroissant, puis retour. Aucune colonne
 * assigné ou auteur : la vue ne totalise jamais par personne (§18).
 *
 * Chaque clé de dette est un lien vers le ticket (item D50) et un bouton ouvre
 * son addition dans la page. L'état vide propose le jeu d'exemple (item D47).
 */
export function RankingTable({
  locale,
  ranking,
  selectedId,
  onSelect,
  emptyAction,
}: {
  locale: Locale;
  ranking: RankedDebt[];
  selectedId: string | null;
  onSelect: (debtIssueId: string) => void;
  emptyAction?: ReactNode;
}): JSX.Element {
  const caption = t(locale, 'project.rankingCaption');
  if (ranking.length === 0) {
    return (
      <Fragment>
        <Text>{t(locale, 'project.rankingEmpty')}</Text>
        {emptyAction ?? null}
      </Fragment>
    );
  }
  return (
    <Table caption={caption} label={caption}>
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
        <TicketLink issueKey={row.key} />
        <Button
          appearance={selected ? 'primary' : 'subtle-link'}
          text={t(locale, 'project.showBill')}
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

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(RankingRow);
