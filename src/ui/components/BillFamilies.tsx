import { useState } from 'react';
import { Fragment, Heading } from '../kit';
import type { Family } from '../../core/types';
import type { DebtBillView } from '../api';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { EvidenceList } from './EvidenceList';
import { FamilyTable } from './FamilyTable';

/**
 * Familles + preuves d'une addition. Choisir une famille filtre la liste :
 * clic 1 sur la ligne, clic 2 sur la formule de la preuve.
 */
export function BillFamilies({ locale, view }: { locale: Locale; view: DebtBillView }): JSX.Element {
  const [family, setFamily] = useState<Family | null>(null);
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'panel.families')}</Heading>
      <FamilyTable locale={locale} byFamily={view.bill.byFamily} onSelect={(next) => setFamily(next)} />
      <Heading size="small">{t(locale, 'panel.evidence')}</Heading>
      <EvidenceList locale={locale} evidence={view.evidence} family={family} />
    </Fragment>
  );
}
