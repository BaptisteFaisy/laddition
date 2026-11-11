import { useEffect, useState } from '@forge/ui';

/**
 * Chargement d'une donnée distante, sans page blanche : tout écran affiche
 * soit un chargement, soit une erreur explicite, soit la donnée (§14).
 */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

export type ResolverState<T> = {
  state: AsyncState<T>;
  reload: () => void;
};

/**
 * Appelle `load` dès que `key` change (et à chaque `reload()`).
 * `key` vide ou `load` nul : on reste en chargement, l'écran n'appelle rien.
 */
export function useResolver<T>(key: string, load: (() => Promise<T>) | null): ResolverState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === '' || load === null) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const data = await load();
        if (!cancelled) setState({ status: 'ready', data });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      }
    })();
  }, [key, attempt]);

  return { state, reload: () => setAttempt(attempt + 1) };
}

/** Message lisible pour n'importe quelle erreur jetée par un resolver. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
