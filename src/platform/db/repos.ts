/**
 * Surface publique des dépôts Forge SQL.
 *
 * Le détail est rangé par domaine dans `repos/` (faits, preuves, additions,
 * projet) pour qu'aucun fichier ne dépasse la taille d'un écran ; ce fichier
 * n'est qu'un point d'entrée : `import { upsertIssueFacts } from './repos.ts'`.
 */

export * from './repos/issues.ts';
export * from './repos/costs.ts';
export * from './repos/bills.ts';
export * from './repos/project.ts';
