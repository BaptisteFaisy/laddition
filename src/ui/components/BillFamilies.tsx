import { Fragment, Heading, useState } from '@forge/ui';
import type { Family } from '../../core/types.ts';
import type { DebtBillView } from '../api.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { EvidenceList } from './EvidenceList.tsx';
import { FamilyTable } from './FamilyTable.tsx';

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
