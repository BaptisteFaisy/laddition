import { Cell, Head, markTableRow, Row, Table, Text } from '../kit';
import type { Evidence, Family } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { familyLabel, formatDate, formatJp, formatPercent } from '../format';
import { FormulaDisclosure } from './FormulaDisclosure';
import { TicketLink } from './TicketLink';

/**
 * Les preuves d'une addition, chacune ouvrant sa formule (règle des 2 clics).
 *
 * La clé du ticket source est un lien (item D50) ; une preuve que le lecteur ne
 * peut pas ouvrir reste masquée, sans clé (item D63, §18 « Droits ») ; une
 * famille non chiffrable affiche « données insuffisantes » au lieu de 0
 * (item D56) ; et la part imputée à la dette est visible quand elle est connue
 * (item D57, recette §20 n°2).
 */
export function EvidenceList({
  locale,
  evidence,
  family,
  emptyKey = 'panel.evidenceEmpty',
  caption,
  shares,
}: {
  locale: Locale;
  evidence: Evidence[];
  family?: Family | null | undefined;
  emptyKey?: 'panel.evidenceEmpty' | 'common.empty';
  caption?: string;
  shares?: Record<string, number>;
}): JSX.Element {
  const rows = family ? evidence.filter((item) => item.family === family) : evidence;
  const title = caption ?? t(locale, 'panel.evidence');
  const withShare = shares !== undefined;
  return (
    <Table caption={title} label={title} empty={t(locale, emptyKey)}>
      <Head>
        <Cell><Text>{t(locale, 'common.source')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.date')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.cost')}</Text></Cell>
        {withShare ? <Cell><Text>{t(locale, 'evidence.col.share')}</Text></Cell> : null}
        <Cell><Text>{t(locale, 'common.formula')}</Text></Cell>
      </Head>
      {rows.map((item) => (
        <EvidenceRow key={item.id} locale={locale} evidence={item} share={shares?.[item.id]} withShare={withShare} />
      ))}
    </Table>
  );
}

function EvidenceRow({
  locale,
  evidence,
  share,
  withShare,
}: {
  locale: Locale;
  evidence: Evidence;
  share?: number;
  withShare: boolean;
}): JSX.Element {
  return (
    <Row>
      <Cell>
        {evidence.visible ? <TicketLink issueKey={evidence.sourceKey} /> : null}
        {evidence.visible ? null : <Text>{t(locale, 'common.hiddenItems', { count: 1 })}</Text>}
        <Text>{familyLabel(locale, evidence.family)}</Text>
      </Cell>
      <Cell><Text>{formatDate(locale, evidence.occurredAt)}</Text></Cell>
      <Cell><CostCell locale={locale} evidence={evidence} /></Cell>
      {withShare ? <Cell><Text>{formatPercent(locale, share)}</Text></Cell> : null}
      <Cell><FormulaDisclosure locale={locale} family={evidence.family} detail={evidence.detail} /></Cell>
    </Row>
  );
}

/** Coût d'une preuve : « données insuffisantes » remplace un zéro sans sens. */
function CostCell({ locale, evidence }: { locale: Locale; evidence: Evidence }): JSX.Element {
  if (evidence.insufficient) return <Text>{t(locale, 'common.insufficient')}</Text>;
  return <Text>{formatJp(locale, evidence.costJp)}</Text>;
}

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(EvidenceRow);
