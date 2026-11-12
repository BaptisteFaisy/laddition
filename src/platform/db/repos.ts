/**
 * Surface publique des dépôts Forge SQL.
 *
 * Le détail est rangé par domaine dans `repos/` (faits, preuves, additions,
 * projet, scores, purge) pour qu'aucun fichier ne dépasse la taille d'un
 * écran ; ce fichier n'est qu'un point d'entrée :
 * `import { upsertIssueFacts } from './repos'`.
 */

export * from './repos/issues';
export * from './repos/costs';
export * from './repos/bills';
export * from './repos/project';
export * from './repos/scores';
export * from './repos/purge';
