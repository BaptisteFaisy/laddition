/**
 * Test du bloc de retour (item 55).
 *
 * Le retour et le délai de retour doivent montrer leur formule et leurs
 * entrées (§5 principe 1, §18 « deux clics »). Le rendu se fait sans DOM : les
 * `.tsx` sont transpilés à la volée et `@forge/react` est remplacé par un
 * double neutre.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import * as ts from 'typescript';

import type { DebtBill } from '../../core/types';
import { formatJp } from '../format';

/** Double de `@forge/react` : des composants neutres, sans navigateur. */
const FAKE_REACT = pathToFileURL(join(tmpdir(), 'laddition-fake-forge-react.mjs')).href;

writeFileSync(
  fileURLToPath(FAKE_REACT),
  [
    'const stub = (name) => (props) => props.children ?? null;',
    ...[
      'Badge', 'Box', 'Button', 'DynamicTable', 'Form', 'FormFooter', 'FormSection', 'Heading', 'Label',
      'Link', 'ProgressBar', 'RadioGroup', 'SectionMessage', 'Select', 'Spinner', 'Stack', 'Tab', 'TabList',
      'TabPanel', 'Tabs', 'Text', 'Textfield',
    ].map((name) => `export const ${name} = stub('${name}');`),
  ].join('\n'),
);

/** Charge les `.tsx` (que node ne sait pas lire) et double `@forge/react`. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@forge/react') return { url: FAKE_REACT, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: url,
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});

const { ReturnBlock } = await import('./ReturnBlock');
const { Disclosure } = await import('./Disclosure');

/** Une addition factice : le bloc de retour n'a besoin que de ses chiffres. */
const BILL = {
  debtIssueId: 'd1',
  key: 'PAY-1',
  computedAt: '2026-01-01',
  lowJp: 20,
  highJp: 30,
  byFamily: {},
  evidenceIds: [],
  hiddenCount: 0,
  repaymentJp: 18,
  avoidableJp: 12.6,
  roiLow: 0.7,
  roiHigh: 1.05,
  paybackDays: 180,
};

/** Éléments d'un type donné, en déroulant les composants sans DOM. */
function findByType(node: unknown, type: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) findByType(child, type, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) {
    found.push(node);
    return found;
  }
  const rendered =
    typeof element.type === 'function'
      ? (element.type as (props: unknown) => unknown)(element.props)
      : element.props?.children;
  return findByType(rendered, type, found);
}

/** Textes affichés dans un sous-arbre. */
function textsOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) textsOf(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props) textsOf(props.children, out);
  }
  return out;
}

/** Contenu textuel d'une divulgation. */
function contentOf(disclosure: unknown): string[] {
  const props = (disclosure as { props?: { children?: unknown } }).props;
  return textsOf(props?.children);
}

describe('ReturnBlock — le retour montre sa méthode (item 55)', () => {
  it('divulgue la formule du retour et celle du délai, avec leurs entrées', () => {
    const tree = ReturnBlock({ locale: 'fr', bill: BILL as unknown as DebtBill });
    const disclosures = findByType(tree, Disclosure);
    assert.equal(disclosures.length, 2, 'deux divulgations : retour et délai de retour');

    const roi = contentOf(disclosures[0]);
    assert.ok(roi.some((line) => line.includes('÷')), `formule du retour absente : ${roi.join(' | ')}`);
    assert.ok(roi.some((line) => line.includes(formatJp('fr', BILL.avoidableJp))), 'coût évitable en entrée');
    assert.ok(roi.some((line) => line.includes(formatJp('fr', BILL.repaymentJp))), 'remboursement en entrée');

    const payback = contentOf(disclosures[1]);
    assert.ok(payback.some((line) => line.includes('÷')), `formule du délai absente : ${payback.join(' | ')}`);
    assert.ok(payback.some((line) => line.includes(formatJp('fr', BILL.repaymentJp))), 'remboursement en entrée');
    const weekly = (BILL.repaymentJp * 7) / BILL.paybackDays;
    assert.ok(payback.some((line) => line.includes(formatJp('fr', weekly))), 'coût hebdomadaire en entrée');
  });
});
