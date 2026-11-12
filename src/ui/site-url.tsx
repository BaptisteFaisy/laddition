import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Adresse du site courant, lue une fois par `ScreenShell` et partagée par tous
 * les liens de l'écran (item D50). Sans contexte, les liens rendent du texte :
 * une clé de ticket reste lisible même quand l'adresse manque.
 */
const SiteUrlContext = createContext<string>('');

export function SiteUrlProvider({ siteUrl, children }: { siteUrl: string; children: ReactNode }): JSX.Element {
  return <SiteUrlContext.Provider value={siteUrl}>{children}</SiteUrlContext.Provider>;
}

/** Adresse du site courant, ou une chaîne vide quand elle est inconnue. */
export function useSiteUrl(): string {
  return useContext(SiteUrlContext);
}
