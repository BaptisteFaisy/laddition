import type { Request } from '@forge/resolver';
import type { BootstrapProgress } from '../core/types';
import { startBootstrap as startBootstrapJob } from '../jobs/consumer';
import { projectIdOf } from '../jobs/projects';
import type { Failure } from '../jobs/support';
import { guard, payloadOf } from '../jobs/support';

/**
 * DT-12 : lancer l'initialisation depuis l'écran.
 *
 * Le travail lui-même est un enchaînement de lots dans la file (`jobs/consumer.ts`) :
 * ce résolveur ne fait que créer l'état de progression et pousser le premier
 * lot, puis rend cet état pour que la barre s'affiche tout de suite.
 */
export async function startBootstrap(
  request: Request<unknown>,
): Promise<BootstrapProgress | Failure> {
  return guard(async () => startBootstrapJob(await projectIdOf(payloadOf(request))));
}
