import type { Request } from '@forge/resolver';
import type { BootstrapProgress } from '../core/types.ts';
import { startBootstrap as startBootstrapJob } from '../jobs/consumer.ts';
import { projectIdOf } from '../jobs/projects.ts';
import type { Failure } from '../jobs/support.ts';
import { guard, payloadOf } from '../jobs/support.ts';

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
