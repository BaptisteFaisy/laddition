import { view } from '@forge/bridge';
import { useEffect, useState } from '@forge/ui';
import type { AsyncState } from './async.ts';
import { errorMessage } from './async.ts';
import type { Locale } from './i18n/index.ts';
import { localeFrom } from './i18n/index.ts';

/** Ce dont un écran a besoin du contexte Forge, et rien de plus. */
export type ScreenContext = {
  projectId: string;
  projectKey: string;
  issueId: string | null;
  issueKey: string | null;
  siteUrl: string;
  locale: Locale;
};

/** Extrait le contexte sans jamais jeter : un champ manquant devient vide. */
export function readContext(raw: unknown): ScreenContext {
  const root = isRecord(raw) ? raw : {};
  const extension = isRecord(root['extension']) ? root['extension'] : {};
  const project = isRecord(extension['project']) ? extension['project'] : {};
  const issue = isRecord(extension['issue']) ? extension['issue'] : {};
  const locale = typeof root['locale'] === 'string' ? root['locale'] : null;
  return {
    projectId: textOf(project['id']),
    projectKey: textOf(project['key']),
    issueId: textOf(issue['id']) || null,
    issueKey: textOf(issue['key']) || null,
    siteUrl: textOf(root['siteUrl']),
    locale: localeFrom(locale),
  };
}

/** Contexte de l'écran courant, avec ses états de chargement et d'erreur. */
export function useScreenContext(): AsyncState<ScreenContext> {
  const [state, setState] = useState<AsyncState<ScreenContext>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await view.getContext();
        if (!cancelled) setState({ status: 'ready', data: readContext(raw) });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      }
    })();
  }, []);

  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
