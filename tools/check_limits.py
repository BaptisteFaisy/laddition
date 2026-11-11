#!/usr/bin/env python3
"""Couche 0 — les deux règles de taille du dépôt.

  * tout fichier de code fait moins de 500 lignes ;
  * toute fonction fait moins de 50 lignes.

Usage : python3 tools/check_limits.py [racine]
Sortie : une ligne par infraction, code de sortie 1 s'il y en a une.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MAX_FILE_LINES = 500
MAX_FUNCTION_LINES = 50
EXCLUDED_DIRS = {'node_modules', 'dist', 'build', '.git', '__pycache__', '.forge'}
SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.py'}

# Début d'une fonction : `function x(`, `export function x(`, `const x = (`,
# `const x = async (`, `def x(`, `async def x(`.
FUNCTION_START = re.compile(
    r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w+|'
    r'(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(|'
    r'(?:const|let)\s+\w+\s*=\s*(?:async\s*)?function\b|'
    r'(?:async\s+)?def\s+\w+)'
)


def iter_files(root: Path):
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix not in SUFFIXES:
            continue
        if any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        yield path


def count_file(path: Path) -> int:
    return len(path.read_text(encoding='utf-8', errors='replace').splitlines())


def function_spans(lines: list[str]) -> list[tuple[int, int]]:
    """Intervalles (début, fin) des fonctions, par équilibrage d'accolades.

    Pour Python, on s'arrête à la première ligne non vide qui n'est plus
    indentée sous la définition.
    """
    spans: list[tuple[int, int]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not FUNCTION_START.match(line):
            index += 1
            continue
        end = find_end(lines, index, line)
        spans.append((index + 1, end + 1))
        index = end + 1
    return spans


def find_end(lines: list[str], start: int, first_line: str) -> int:
    """Dernière ligne de la fonction ouverte en `start`."""
    if 'def ' in first_line and 'function' not in first_line and '=>' not in first_line:
        return find_end_python(lines, start, first_line)
    depth = 0
    seen = False
    for index in range(start, len(lines)):
        for char in lines[index]:
            if char == '{':
                depth += 1
                seen = True
            elif char == '}':
                depth -= 1
        if seen and depth <= 0:
            return index
    return len(lines) - 1


def find_end_python(lines: list[str], start: int, first_line: str) -> int:
    indent = len(first_line) - len(first_line.lstrip())
    last = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        current = len(line) - len(line.lstrip())
        if current <= indent:
            break
        last = index
    return last


def check(root: Path) -> list[str]:
    problems: list[str] = []
    for path in iter_files(root):
        relative = path.relative_to(root)
        total = count_file(path)
        if total >= MAX_FILE_LINES:
            problems.append('%s : %d lignes (maximum %d)' % (relative, total, MAX_FILE_LINES))
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        for start, end in function_spans(lines):
            length = end - start + 1
            if length >= MAX_FUNCTION_LINES:
                problems.append(
                    '%s:%d : fonction de %d lignes (maximum %d)'
                    % (relative, start, length, MAX_FUNCTION_LINES)
                )
    return problems


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    problems = check(root)
    for problem in problems:
        print('KO ' + problem)
    if problems:
        print('\n%d infraction(s) à la règle de taille.' % len(problems))
        return 1
    print('OK — tous les fichiers font moins de %d lignes, toutes les fonctions moins de %d.'
          % (MAX_FILE_LINES, MAX_FUNCTION_LINES))
    return 0


if __name__ == '__main__':
    sys.exit(main())
