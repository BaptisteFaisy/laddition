/**
 * Types partagés du double SQL (`fakeSql.ts`).
 *
 * Un fichier à part pour qu'aucun module du double n'ait à importer un autre
 * module du double juste pour un type : les dépendances restent à sens unique
 * (`fakeSql` → `fakeSelect`/`fakeMutate` → `fakeStore`/`fakeCondition`).
 */

/** Une ligne SQL : des colonnes nommées, des valeurs inconnues. */
export type FakeRow = Record<string, unknown>;

/** Une source de ligne : la table (ou son alias) et la ligne lue. */
export interface RowSource {
  alias: string;
  row: FakeRow;
}

/** Une ligne combinée : une ligne par source de la requête (jointures). */
export interface CombinedRow {
  sources: RowSource[];
}
