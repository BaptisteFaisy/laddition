import { Button, Cell, Fragment, Head, markTableRow, Row, Table, Text } from '../kit';
import type { Family, FamilyTotal } from '../../core/types';
import { BILLED_FAMILIES } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { familyLabel, formatDays, formatNumber, pair } from '../format';
import { RangeBadge } from './RangeBadge';

/**
 * Ventilation de l'addition par famille. La colonne « preuves » ouvre la liste
 * des tickets qui composent la ligne : c'est le premier des deux clics.
 * C5 est affichée à part, en jours de retard, hors addition.
 */
export function FamilyTable({
  locale,
  byFamily,
  onSelect,
}: {
  locale: Locale;
  byFamily: Record<Family, FamilyTotal>;
  onSelect: (family: Family) => void;
}): JSX.Element {
  const caption = t(locale, 'panel.families');
  return (
    <Fragment>
      <Table caption={caption} label={caption}>
        <Head>
          <Cell><Text>{t(locale, 'common.family')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.cost')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.evidence')}</Text></Cell>
        </Head>
        {BILLED_FAMILIES.map((family) => (
          <FamilyRow key={family} locale={locale} family={family} total={byFamily[family]} onSelect={onSelect} />
        ))}
      </Table>
      <Text>{pair(locale, familyLabel(locale, 'C5'), formatDays(locale, byFamily.C5.lowJp))}</Text>
      <Text>{t(locale, 'family.note.C5')}</Text>
    </Fragment>
  );
}

function FamilyRow({
  locale,
  family,
  total,
  onSelect,
}: {
  locale: Locale;
  family: Family;
  total: FamilyTotal;
  onSelect: (family: Family) => void;
}): JSX.Element {
  return (
    <Row>
      <Cell><Text>{familyLabel(locale, family)}</Text></Cell>
      <Cell><RangeBadge locale={locale} lowJp={total.lowJp} highJp={total.highJp} insufficient={total.insufficient} /></Cell>
      <Cell>
        <Button
          appearance="subtle-link"
          text={t(locale, 'common.evidenceCount', { count: formatNumber(locale, total.evidenceCount) })}
          onClick={() => onSelect(family)}
        />
      </Cell>
    </Row>
  );
}

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(FamilyRow);
