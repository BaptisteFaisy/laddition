import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Marqueur « jeu d'exemple » partagé par un écran et son bandeau (item D58).
 *
 * `ScreenShell` le pose une fois ; un écran qui charge ou retire le jeu
 * d'exemple appelle `refresh()` pour que le bandeau suive immédiatement.
 */
export type DemoFlag = {
  demoData: boolean;
  refresh: () => void;
};

const DemoFlagContext = createContext<DemoFlag>({ demoData: false, refresh: () => undefined });

export function DemoFlagProvider({ value, children }: { value: DemoFlag; children: ReactNode }): JSX.Element {
  return <DemoFlagContext.Provider value={value}>{children}</DemoFlagContext.Provider>;
}

/** Marqueur courant, et le moyen de le faire relire après un changement. */
export function useDemoFlag(): DemoFlag {
  return useContext(DemoFlagContext);
}
