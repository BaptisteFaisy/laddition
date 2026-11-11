import { Cell, Head, Row, Table, Text } from '@forge/ui';
import type { Evidence, Family } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { familyLabel, formatDate, formatJp } from '../format.ts';
import { FormulaDisclosure } from './FormulaDisclosure.tsx';

/** Les preuves d'une addition, chacune ouvrant sa formule (règle des 2 clics). */
export function EvidenceList({
  locale,
  evidence,
  family,
  emptyKey = 'panel.evidenceEmpty',
}: {
  locale: Locale;
  evidence: Evidence[];
  family?: Family | null | undefined;
  emptyKey?: 'panel.evidenceEmpty' | 'common.empty';
}): JSX.Element {
  const rows = family ? evidence.filter((item) => item.family === family) : evidence;
  if (rows.length === 0) return <Text>{t(locale, emptyKey)}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{t(locale, 'common.source')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.date')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.cost')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.formula')}</Text></Cell>
      </Head>
      {rows.map((item) => (
        <EvidenceRow key={item.id} locale={locale} evidence={item} />
      ))}
    </Table>
  );
}

function EvidenceRow({ locale, evidence }: { locale: Locale; evidence: Evidence }): JSX.Element {
  const source = evidence.visible ? evidence.sourceKey : t(locale, 'common.hiddenItems', { count: 1 });
  return (
    <Row>
      <Cell>
        <Text>{source}</Text>
        <Text>{familyLabel(locale, evidence.family)}</Text>
      </Cell>
      <Cell><Text>{formatDate(locale, evidence.occurredAt)}</Text></Cell>
      <Cell><Text>{formatJp(locale, evidence.costJp)}</Text></Cell>
      <Cell><FormulaDisclosure locale={locale} detail={evidence.detail} /></Cell>
    </Row>
  );
}
