import { useState } from 'react';
import { getDebtBill } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../../i18n/index';
import { AsyncView } from './AsyncView';
import { BillSummary } from './BillSummary';

/**
 * Une addition complète, chargée par identifiant de ticket de dette.
 * Réutilisée par la page projet et par le panneau du ticket : une seule
 * implémentation de l'affichage, donc un seul jeu de chiffres (recette 9).
 */
export function BillView({
  locale,
  debtIssueId,
  onChanged,
}: {
  locale: Locale;
  debtIssueId: string;
  onChanged?: (() => void) | undefined;
}): JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const resolver = useResolver(`${debtIssueId}#${refresh}`, () => getDebtBill(debtIssueId));
  const changed = () => {
    setRefresh(refresh + 1);
    if (onChanged) onChanged();
  };
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(view) => <BillSummary locale={locale} view={view} onChanged={changed} />}
    />
  );
}
