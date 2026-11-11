import { useState } from 'react';
import { Button, Fragment } from '../kit';

/**
 * Révélation en un clic, réutilisée partout où un chiffre doit pouvoir
 * montrer sa méthode (§18 « chaque chiffre en deux clics au plus »).
 */
export function Disclosure({
  label,
  labelOpen,
  children,
}: {
  label: string;
  labelOpen: string;
  children: JSX.Element;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <Button appearance="subtle-link" text={open ? labelOpen : label} onClick={() => setOpen(!open)} />
      {open ? children : null}
    </Fragment>
  );
}
