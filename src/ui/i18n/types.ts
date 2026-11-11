import { en } from './en.ts';

/** Toutes les clés de message : l'anglais fait foi, le français doit suivre. */
export type MessageKey = keyof typeof en;

/** Dictionnaire complet : une traduction incomplète ne compile pas. */
export type Messages = Record<MessageKey, string>;

/** Valeurs injectées dans un message (`{name}`). */
export type MessageVars = Record<string, string | number>;
