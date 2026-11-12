#!/usr/bin/env python3
"""Garde de structure du dépôt (items F83 + règle d'architecture centrale).

Deux contrôles, bon marché et déterministes :

1. **Tests par dossier** : tout dossier de `src/` qui contient du code doit
   contenir au moins un fichier `*.test.*`, sauf exceptions explicites
   (listées et commentées ci-dessous). Un nouveau dossier sans test fait
   rougir la CI au lieu de passer inaperçu.

2. **Pureté du domaine** : aucun fichier de `src/core/**` ne peut importer
   `@forge/*`. C'est la règle d'architecture centrale (ARCHITECTURE.md, §15) :
   le domaine est du TypeScript pur, testé par `node --test` sans transpile.

Usage : python3 tools/check_structure.py [racine]
Sortie : une ligne par infraction, code de sortie 1 s'il y en a une.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CODE_SUFFIXES = {'.ts', '.tsx', '.js', '.mjs'}
IGNORED_DIRS = {'node_modules', 'dist', '.git', '__pycache__'}

# Dossiers exemptés de fichier de test, avec la raison :
TEST_EXEMPT_DIRS = {
    # Point d'entrée : ré-exports fins, contrôlés par tools/check_manifest_exports.mjs
    # (chaque `handler:` du manifest doit correspondre à un export réel).
    'src',
    # Écrans UI Kit 2 : composants déclaratifs derrière la façade kit.tsx ;
    # la logique qu'ils affichent vit dans src/resolvers et src/core (testées),
    # et leur rendu se vérifie dans le navigateur (recette §20).
    'src/ui',
    'src/ui/components',
    'src/ui/i18n',
    # Adaptateurs fins du resolver : assemblage sans branche métier ;
    # les chiffres qu'ils rendent sont ceux de src/core (testé) et ils sont
    # exercés sur le runtime par les sondes (?action=report / ?action=bill).
    'src/resolvers',
    # Jobs Forge (triggers, consumer, webtriggers) : invocablent le domaine et
    # les adaptateurs ; testés sur le runtime par les sondes d'exploitation
    # (docs/VALIDATIONS.md) — un harnais Forge hors ligne n'existe pas.
    'src/jobs',
    # Repos SQL (src/platform/db/repos) : requêtes Forge SQL pures — le moteur
    # SQL n'existe que sur le runtime Forge, aucun harnais hors ligne ;
    # exercées sur le runtime par les sondes (?action=report, ?action=recalc).
    # Le schéma des tables, lui, est testé hors ligne (src/platform/db/schema.test.ts).
    'src/platform/db/repos',
}

FORGE_IMPORT = re.compile(r"""(?:from\s+['"]@forge/|require\(\s*['"]@forge/|import\(\s*['"]@forge/)""")


def code_files(root: Path):
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix not in CODE_SUFFIXES:
            continue
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        yield path


def check_tests_per_dir(src: Path) -> list[str]:
    """Un dossier de src/ avec du code doit porter un *.test.* (sauf exception)."""
    problems: list[str] = []
    dirs_with_code: dict[str, bool] = {}
    for path in code_files(src):
        relative_dir = path.parent.relative_to(src.parent).as_posix()
        has_test = '.test.' in path.name
        dirs_with_code[relative_dir] = dirs_with_code.get(relative_dir, False) or has_test
    for relative_dir, has_test in sorted(dirs_with_code.items()):
        if has_test or relative_dir in TEST_EXEMPT_DIRS:
            continue
        problems.append(
            '%s : aucun fichier de test dans ce dossier '
            '(ajouter un *.test.* ou motiver l\'exception dans TEST_EXEMPT_DIRS)' % relative_dir
        )
    return problems


def check_core_purity(src: Path) -> list[str]:
    """Aucun import @forge/* dans src/core/** (domaine pur)."""
    problems: list[str] = []
    core = src / 'core'
    if not core.is_dir():
        return problems
    for path in code_files(core):
        for number, line in enumerate(
                path.read_text(encoding='utf-8', errors='replace').splitlines(), start=1):
            if FORGE_IMPORT.search(line):
                problems.append(
                    '%s:%d : import @forge/* interdit dans src/core/** (domaine pur)'
                    % (path.relative_to(src.parent).as_posix(), number)
                )
    return problems


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    src = root / 'src'
    if not src.is_dir():
        print('KO — src/ introuvable sous %s' % root)
        return 1
    problems = check_tests_per_dir(src) + check_core_purity(src)
    for problem in problems:
        print('KO ' + problem)
    if problems:
        print('\n%d infraction(s) de structure.' % len(problems))
        return 1
    print('OK — chaque dossier de src/ porte ses tests (ou une exception motivée), '
          'src/core/ n\'importe aucun @forge/*.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
