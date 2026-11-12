/**
 * item 83 — test du garde-fou de couverture (tools/coverage_threshold.mjs).
 * Lancé par : node --test tools/coverage_threshold.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, aggregateCore, THRESHOLD } from './coverage_threshold.mjs';

const SAMPLE = [
  'SF:src/core/bill.ts',
  'LF:100',
  'LH:98',
  'end_of_record',
  'SF:src/core/bill.test.ts',
  'LF:50',
  'LH:50',
  'end_of_record',
  'SF:src/core/families/c1.ts',
  'LF:20',
  'LH:19',
  'end_of_record',
  'SF:src/ui/links.ts',
  'LF:10',
  'LH:5',
  'end_of_record',
].join('\n');

test('parseLcov extrait SF/LF/LH par enregistrement', () => {
  const files = parseLcov(SAMPLE);
  assert.equal(files.length, 4);
  assert.deepEqual(files[0], { file: 'src/core/bill.ts', found: 100, hit: 98 });
});

test('aggregateCore ne retient que src/core hors *.test.ts', () => {
  const agg = aggregateCore(parseLcov(SAMPLE));
  assert.equal(agg.found, 120); // bill.ts (100) + families/c1.ts (20)
  assert.equal(agg.hit, 117); // 98 + 19
  assert.ok(Math.abs(agg.percent - 97.5) < 1e-9);
});

test('aggregateCore sur rapport vide ne divise pas par zéro', () => {
  const agg = aggregateCore([]);
  assert.deepEqual(agg, { found: 0, hit: 0, percent: 0 });
});

test('le seuil est un entier franc (pas de rouge au dixième de point)', () => {
  assert.ok(Number.isInteger(THRESHOLD));
  assert.ok(THRESHOLD > 0 && THRESHOLD <= 100);
});
