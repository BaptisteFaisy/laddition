import { useEffect, useState } from 'react';
import type { BootstrapProgress } from '../core/types';
import { bootstrapProgress } from './api';
import { errorMessage } from './async';

/** Intervalle de relecture de l'avancement, en millisecondes. */
const POLL_MS = 3000;

/**
 * Avancement de l'initialisation (DT-12), relu tant qu'elle n'est pas finie.
 *
 * `attempt` force une relecture immédiate : le lancement passe par là pour que
 * la barre s'affiche sans attendre le prochain tour.
 */
export function useBootstrapProgress(projectId: string, attempt: number): BootstrapState {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await bootstrapProgress(projectId);
        if (cancelled) return;
        setProgress(next);
        if (next && !next.finished) timer = setTimeout(poll, POLL_MS);
      } catch (error) {
        if (!cancelled) setFailure(errorMessage(error));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, attempt]);

  return { progress, failure, setProgress, setFailure };
}

export type BootstrapState = {
  progress: BootstrapProgress | null;
  failure: string | null;
  setProgress: (progress: BootstrapProgress | null) => void;
  setFailure: (failure: string | null) => void;
};
