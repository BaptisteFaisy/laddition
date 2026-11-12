import { useState } from 'react';
import { Fragment, Heading } from '../kit';
import type { Attribution, Family } from '../../core/types';
import type { DebtBillView } from '../api';
import { listDebtAttributions } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { EvidenceList } from './EvidenceList';
import { FamilyTable } from './FamilyTable';

/**
 * Familles + preuves d'une addition. Choisir une famille filtre la liste :
 * clic 1 sur la ligne, clic 2 sur la formule de la preuve.
 *
 * Les parts d'attribution sont affichées quand le resolver les donne
 * (item D57, recette §20 n°2) : on voit que la somme ne dépasse pas 100 %.
 */
export function BillFamilies({ locale, view }: { locale: Locale; view: DebtBillView }): JSX.Element {
  const [family, setFamily] = useState<Family | null>(null);
  const debtIssueId = view.bill.debtIssueId;
  const resolver = useResolver(debtIssueId, () => listDebtAttributions(debtIssueId));
  const shares = resolver.state.status === 'ready' ? shareMapOf(resolver.state.data) : undefined;
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'panel.families')}</Heading>
      <FamilyTable locale={locale} byFamily={view.bill.byFamily} onSelect={setFamily} />
      <Heading size="small">{t(locale, 'panel.evidence')}</Heading>
      <EvidenceList locale={locale} evidence={view.evidence} family={family} shares={shares} />
    </Fragment>
  );
}

/** Part de chaque preuve dans cette dette, indexée par identifiant de preuve. */
function shareMapOf(attributions: Attribution[]): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const item of attributions) shares[item.evidenceId] = item.share;
  return shares;
}
