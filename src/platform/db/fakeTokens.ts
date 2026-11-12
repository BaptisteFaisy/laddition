/**
 * Lexique du double SQL : les jetons d'une requête.
 *
 * Le double de Forge SQL (`fakeSql.ts`) n'a pas besoin d'un analyseur complet :
 * il faut seulement reconnaître ce que la couche de stockage écrit — des
 * identifiants, des littéraux, des points d'interrogation et une ponctuation
 * simple. Ce fichier fait ce travail, et rien d'autre.
 */

/** Nature d'un jeton. */
export type TokenKind = 'word' | 'text' | 'number' | 'param' | 'punct';

/** Un jeton : sa nature, son texte brut, sa valeur décodée. */
export interface Token {
  kind: TokenKind;
  text: string;
  value: string | number | null;
}

/** Ponctuation à un caractère. */
const PUNCTUATION = '()=<>,*';

/** Opérateurs à deux caractères. */
const DOUBLE_OPERATORS = ['<=', '>=', '!=', '<>'];

/** Découpe une requête en jetons. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? '';
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '?') {
      tokens.push({ kind: 'param', text: '?', value: null });
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const read = readQuoted(sql, index);
      tokens.push({ kind: 'text', text: read.raw, value: read.value });
      index = read.next;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const read = readNumber(sql, index);
      tokens.push({ kind: 'number', text: read.raw, value: read.value });
      index = read.next;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const read = readWord(sql, index);
      tokens.push({ kind: 'word', text: read.raw, value: read.raw });
      index = read.next;
      continue;
    }
    const pair = sql.slice(index, index + 2);
    if (DOUBLE_OPERATORS.includes(pair)) {
      tokens.push({ kind: 'punct', text: pair, value: null });
      index += 2;
      continue;
    }
    if (PUNCTUATION.includes(char)) {
      tokens.push({ kind: 'punct', text: char, value: null });
      index += 1;
      continue;
    }
    throw new Error(`double SQL : caractère inattendu « ${char} »`);
  }
  return tokens;
}

/** Lit une chaîne entre apostrophes ou guillemets, échappements compris. */
function readQuoted(sql: string, start: number): { raw: string; value: string; next: number } {
  const quote = sql[start];
  let index = start + 1;
  let value = '';
  while (index < sql.length) {
    const char = sql[index];
    if (char === '\\' && index + 1 < sql.length) {
      value += sql[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (char === quote) {
      if (sql[index + 1] === quote) {
        value += quote;
        index += 2;
        continue;
      }
      return { raw: sql.slice(start, index + 1), value, next: index + 1 };
    }
    value += char;
    index += 1;
  }
  throw new Error('double SQL : chaîne non terminée');
}

/** Lit un nombre (entier ou décimal). */
function readNumber(sql: string, start: number): { raw: string; value: number; next: number } {
  let index = start;
  while (index < sql.length && /[0-9.eE+-]/.test(sql[index] ?? '')) {
    // Un signe ne fait partie du nombre que s'il suit un exposant.
    if ((sql[index] === '+' || sql[index] === '-') && !/[eE]/.test(sql[index - 1] ?? '')) break;
    index += 1;
  }
  const raw = sql.slice(start, index);
  return { raw, value: Number(raw), next: index };
}

/** Lit un identifiant (lettres, chiffres, `_`, `.`, `$`). */
function readWord(sql: string, start: number): { raw: string; next: number } {
  let index = start;
  while (index < sql.length && /[A-Za-z0-9_.$]/.test(sql[index] ?? '')) index += 1;
  return { raw: sql.slice(start, index), next: index };
}

/** Vrai si le jeton est le mot-clé donné (casse indifférente). */
export function isKeyword(token: Token | undefined, word: string): boolean {
  return token !== undefined && token.kind === 'word' && token.text.toUpperCase() === word.toUpperCase();
}

/** Texte d'un jeton, chaîne vide s'il n'y en a pas. */
export function tokenText(token: Token | undefined): string {
  return token?.text ?? '';
}

/** Découpe une liste de jetons sur les virgules de premier niveau. */
export function splitByComma(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === '(') depth += 1;
    if (token.kind === 'punct' && token.text === ')') depth -= 1;
    if (token.kind === 'punct' && token.text === ',' && depth === 0) {
      groups.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  groups.push(current);
  return groups.filter((group) => group.length > 0);
}
