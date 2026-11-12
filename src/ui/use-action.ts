import { useState } from 'react';
import { errorMessage } from './async';

/**
 * État d'une action réseau déclenchée par un bouton : occupé, réussi, échoué.
 *
 * Un seul endroit pour « verrouiller le bouton pendant l'appel, afficher le
 * résultat, ne jamais mentir sur un échec » (items D52, D59).
 */
export type ActionState = {
  busy: boolean;
  done: boolean;
  failure: string | null;
};

export type Action = ActionState & { start: () => void };

export function useAction(run: () => Promise<void>, onDone?: (() => void) | undefined): Action {
  const [state, setState] = useState<ActionState>({ busy: false, done: false, failure: null });

  const start = () => {
    setState({ busy: true, done: false, failure: null });
    void (async () => {
      try {
        await run();
        setState({ busy: false, done: true, failure: null });
        if (onDone) onDone();
      } catch (error) {
        setState({ busy: false, done: false, failure: errorMessage(error) });
      }
    })();
  };

  return { ...state, start };
}
