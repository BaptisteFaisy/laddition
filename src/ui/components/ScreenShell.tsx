import { useCallback, useEffect, useState } from 'react';
import { Fragment } from '../kit';
import { getSettings } from '../api';
import type { ScreenContext } from '../context';
import { useScreenContext } from '../context';
import { DemoFlagProvider } from '../demo-flag';
import type { Locale } from '../../i18n/index';
import { DEFAULT_LOCALE } from '../../i18n/index';
import { SiteUrlProvider } from '../site-url';
import { DemoBanner } from './DemoBanner';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

/**
 * Enveloppe commune des six écrans.
 *
 * Elle lit le contexte Forge une fois, affiche chargement ou erreur, puis
 * délègue le rendu à `children`. Le bandeau « données d'exemple » est posé ici
 * (item D58) : une seule fois pour toutes, donc présent sur les six écrans,
 * y compris quand la donnée d'un écran échoue.
 */
export function ScreenShell({
  children,
  locale,
  projectKeyHint,
}: {
  children: (context: ScreenContext) => JSX.Element;
  locale?: Locale | undefined;
  /** Clé de projet choisie dans l'écran, quand le contexte n'en fournit pas (gadget). */
  projectKeyHint?: string;
}): JSX.Element {
  const state = useScreenContext();
  const fallback = locale ?? DEFAULT_LOCALE;
  if (state.status === 'loading') return <LoadingState locale={fallback} />;
  if (state.status === 'error') return <ErrorState locale={fallback} message={state.message} />;
  return (
    <ReadyShell context={state.data} projectKeyHint={projectKeyHint ?? ''}>
      {children}
    </ReadyShell>
  );
}

/** Coquille une fois le contexte connu : bandeau, adresse du site, écran. */
function ReadyShell({
  context,
  projectKeyHint,
  children,
}: {
  context: ScreenContext;
  projectKeyHint: string;
  children: (context: ScreenContext) => JSX.Element;
}): JSX.Element {
  const demo = useDemoData(context.projectId, projectKeyHint);
  return (
    <SiteUrlProvider siteUrl={context.siteUrl}>
      <DemoFlagProvider value={demo}>
        <Fragment>
          <DemoBanner locale={context.locale} demoData={demo.demoData} />
          {children(context)}
        </Fragment>
      </DemoFlagProvider>
    </SiteUrlProvider>
  );
}

/**
 * Marqueur « jeu d'exemple » du projet, lu une fois par écran.
 *
 * Un échec de lecture ne casse pas l'écran : le bandeau reste absent et
 * l'écran affiche sa propre erreur. `refresh` fait relire le marqueur après un
 * chargement ou un retrait du jeu d'exemple.
 */
function useDemoData(projectId: string, projectKey: string): { demoData: boolean; refresh: () => void } {
  const [demoData, setDemoData] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (projectId === '' && projectKey === '') return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getSettings(projectId, projectKey);
        if (!cancelled) setDemoData(settings.demoData);
      } catch {
        if (!cancelled) setDemoData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectKey, attempt]);

  return { demoData, refresh };
}
