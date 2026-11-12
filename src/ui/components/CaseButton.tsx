import { useState } from 'react';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { Button, Fragment } from '../kit';
import { CasePanel } from './CasePanel';

/**
 * L'argumentaire d'une dette à la demande (DT-17, §7.6).
 *
 * Le bouton existe parce que la page d'argumentaire appelle le modèle : elle
 * n'est donc jamais chargée d'office, ni à l'ouverture d'un ticket ni à la
 * sélection d'une ligne du classement. Un clic, et la page s'affiche avec les
 * mêmes chiffres que l'outil MCP `get-debt-case`.
 */
export function CaseButton({ locale, issueKey }: { locale: Locale; issueKey: string | null }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (issueKey === null || issueKey === '') return null;
  return (
    <Fragment>
      <Button appearance="default" isDisabled={open} onClick={() => setOpen(true)}>
        {t(locale, 'case.button')}
      </Button>
      {open ? <CasePanel locale={locale} issueKey={issueKey} /> : null}
    </Fragment>
  );
}
