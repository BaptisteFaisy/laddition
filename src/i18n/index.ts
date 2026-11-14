import { en } from './en';
import { fr } from './fr';
import type { MessageKey, MessageVars, Messages } from './types';

export type { MessageKey, MessageVars, Messages } from './types';

/** Langues livrées (§18). L'anglais est la langue par défaut. */
export type Locale = 'en' | 'fr';

export const DEFAULT_LOCALE: Locale = 'en';

const DICTIONARIES: Record<Locale, Messages> = { en, fr };

/** Choisit la langue à partir de la locale Atlassian (« fr-FR » → `fr`). */
export function localeFrom(raw: string | null | undefined): Locale {
  if (typeof raw === 'string' && raw.toLowerCase().startsWith('fr')) return 'fr';
  return DEFAULT_LOCALE;
}

/**
 * Traduit une clé. Ne jette jamais : une clé inconnue retombe sur l'anglais,
 * puis sur la clé elle-même, pour qu'un écran ne casse jamais sur un libellé.
 */
export function t(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const dictionary: Messages = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const raw = dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(raw, vars);
}

/** Remplace les `{name}` d'un message par leurs valeurs. */
function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
