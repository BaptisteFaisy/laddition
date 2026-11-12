#!/usr/bin/env node
/**
 * item 83 — résumé de couverture sur src/core (le domaine pur) + garde-fou franc.
 *
 * Lance la suite complète avec --experimental-test-coverage (mesuré à 4,4 s le
 * 12/11, très sous la borne de ~2 min fixée par l'item 83), exporte le rapport
 * lcov, agrège la couverture de lignes de src/core hors fichiers de test,
 * puis compare au seuil.
 *
 * Seuil : mesuré à 97,27 % le 2026-11-12, arrondi à l'entier inférieur (97).
 * Échec franc si la couverture passe SOUS ce seuil — pas de rouge pour un
 * dixième de point.
 *
 * Usage : node tools/coverage_threshold.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const THRESHOLD = 97;

/** Parse un rapport lcov en listes {file, found, hit} (SF/LF/LH). */
export function parseLcov(text) {
  const files = [];
  for (const record of text.split('end_of_record')) {
    const sf = record.match(/SF:(.+)/);
    if (!sf) continue;
    files.push({
      file: sf[1].trim(),
      found: Number(record.match(/LF:(\d+)/)?.[1] ?? 0),
      hit: Number(record.match(/LH:(\d+)/)?.[1] ?? 0),
    });
  }
  return files;
}

/** Agrège lignes trouvées/couvertes pour src/core, hors *.test.ts. */
export function aggregateCore(files) {
  let found = 0;
  let hit = 0;
  for (const f of files) {
    const p = f.file.split(path.sep).join('/');
    if (!/(^|\/)src\/core\//.test(p)) continue;
    if (p.endsWith('.test.ts')) continue;
    found += f.found;
    hit += f.hit;
  }
  return { found, hit, percent: found > 0 ? (100 * hit) / found : 0 };
}

function runCoverageTo(lcovPath) {
  const r = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-strip-types',
      '--experimental-test-coverage',
      '--test-reporter=lcov',
      `--test-reporter-destination=${lcovPath}`,
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      '--import',
      './tools/strip_ts_loader.mjs',
      'src/**/*.test.ts',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return r.status ?? 1;
}

function main() {
  const lcovPath = path.join(os.tmpdir(), `laddition-coverage-${process.pid}.info`);
  const status = runCoverageTo(lcovPath);
  if (status !== 0) {
    console.error(`couverture : la suite de tests a échoué (code ${status})`);
    process.exit(status);
  }
  const agg = aggregateCore(parseLcov(fs.readFileSync(lcovPath, 'utf8')));
  fs.rmSync(lcovPath, { force: true });
  const pct = agg.percent.toFixed(2);
  console.log(`couverture src/core (hors tests) : ${agg.hit}/${agg.found} lignes = ${pct} %`);
  if (agg.found === 0) {
    console.error('couverture : aucune ligne src/core trouvée dans le rapport lcov');
    process.exit(1);
  }
  if (agg.percent < THRESHOLD) {
    console.error(`couverture : ${pct} % < seuil ${THRESHOLD} % — garde-fou déclenché`);
    process.exit(1);
  }
  console.log(`couverture : ${pct} % >= seuil ${THRESHOLD} % — OK`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();
