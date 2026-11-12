/**
 * Tests de l'identité stable des zones (item B24, §19 cas 10).
 *
 * Une zone, c'est un composant Jira. Son **nom** peut changer ; son
 * **identifiant** non. Ces tests fixent ce que l'app doit faire d'un
 * renommage (migrer l'historique, ne rien purger), d'une disparition (la
 * purge reste de rigueur) et d'une fusion (les deux histoires restent
 * séparées).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IssueFact } from '../core/types';
import { getSettings, listEvidence, listZoneWeeks, saveSettings, upsertZoneWeek } from '../platform/db/index';
import { replaceEvidence } from '../platform/db/index';
import { makeSettings } from '../core/settings';
import { startFakeDb } from '../mcp/testing/seed';
import {
  componentLabels,
  detectRenames,
  knownComponentLabels,
  syncComponentLabels,
} from './zoneRename';

/** Un ticket minimal : seules les zones et les composants interest. */
function fact(label: string, componentId: string): IssueFact {
  return {
    issueId: `i-${componentId}`,
    key: `PAY-${componentId}`,
    projectId: 'p1',
    projectKey: 'PAY',
    type: 'Tâche',
    isBug: false,
    isIncident: false,
    isDebt: false,
    zones: [label],
    createdAt: '2026-11-01T00:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    size: 'unknown',
    estimateJp: null,
    storyPoints: null,
    loggedSeconds: null,
    labels: [],
    components: [label],
    componentIds: [componentId],
    affectedServices: [],
    hasPostMortem: false,
    participants: 0,
    visible: true,
    summary: 'Ticket',
    description: '',
  } as IssueFact;
}

describe('detectRenames — renommage, disparition, fusion', () => {
  it('un identifiant connu dont le libellé change est un renommage', () => {
    const renames = detectRenames(new Map([['10001', 'facturation2']]), new Map([['10001', 'facturation']]));
    assert.deepEqual(renames, [{ componentId: '10001', from: 'facturation', to: 'facturation2' }]);
  });

  it('un identifiant disparu n’est pas un renommage', () => {
    const renames = detectRenames(new Map([['10002', 'paiements']]), new Map([['10001', 'facturation']]));
    assert.deepEqual(renames, [], 'une zone qui s’efface laisse la purge faire son travail');
  });

  it('une fusion ne migre rien : les deux histoires restent séparées', () => {
    // L'identifiant 10001 disparaît, 10002 prend son libellé : c'est une fusion.
    const renames = detectRenames(new Map([['10002', 'facturation']]), new Map([['10001', 'facturation']]));
    assert.deepEqual(renames, [], 'une fusion ne doit pas mélanger deux histoires');
  });

  it('un libellé repris d’un composant disparu n’est pas un renommage', () => {
    // 10001 s’efface, 10002 prend son nom : c’est une fusion.
    const renames = detectRenames(
      new Map([['10002', 'facturation'], ['10003', 'reporting']]),
      new Map([['10001', 'facturation'], ['10002', 'facturation2'], ['10003', 'reporting']]),
    );
    assert.deepEqual(renames, [], 'le nom repris appartenait à un autre composant');
  });

  it('un libellé inchangé n’est pas un renommage', () => {
    const renames = detectRenames(new Map([['10001', 'facturation']]), new Map([['10001', 'facturation']]));
    assert.deepEqual(renames, []);
  });
});

describe('componentLabels — les composants sans identifiant sont ignorés', () => {
  it('ne garde que les paires nom/identifiant', () => {
    const labels = componentLabels([fact('facturation', '10001')]);
    assert.equal(labels.get('10001'), 'facturation');
    const sansId = componentLabels([{ ...fact('legacy', 'x'), componentIds: [''] }]);
    assert.equal(sansId.size, 0, 'sans identifiant, pas d’identité stable : autant le dire');
  });
});

describe('syncComponentLabels — l’historique suit le renommage', () => {
  it('migre les preuves, l’instantané et la carte des équipes', async (t) => {
    await startFakeDb(t);
    await saveSettings({ ...makeSettings('p1', 'PAY'), teamByZone: { facturation: 'Paiements' } });
    await replaceEvidence('p1', [
      { id: 'ev1', projectId: 'p1', sourceIssueId: 'i-10001', sourceKey: 'PAY-1', zone: 'facturation', family: 'C1', costJp: 4, visible: true, occurredAt: '2026-11-01T00:00:00.000Z', detail: { durationDays: 1, method: 'computed', formula: 'x', inputs: {}, familyLabel: 'Incidents' } },
    ] as never);
    await upsertZoneWeek([{ projectId: 'p1', zone: 'facturation', week: '2026-W44', costJp: 3, byFamily: { C1: 3, C2: 0, C3: 0, C4: 0, C5: 0 } }] as never);

    // Premier passage : l'app voit le composant pour la première fois.
    await syncComponentLabels('p1', [fact('facturation', '10001')]);
    assert.equal((await knownComponentLabels('p1')).get('10001'), 'facturation');

    // Le composant est renommé : l'historique stocké doit suivre.
    const renames = await syncComponentLabels('p1', [fact('facturation2', '10001')]);
    assert.deepEqual(renames, [{ componentId: '10001', from: 'facturation', to: 'facturation2' }]);
    assert.equal((await listEvidence('p1'))[0]?.zone, 'facturation2', 'les preuves suivent le renommage');
    assert.equal((await listZoneWeeks('p1', ['2026-W44']))[0]?.zone, 'facturation2', 'l’instantané suit le renommage');
    const settings = await getSettings('p1');
    assert.equal(settings?.teamByZone['facturation2'], 'Paiements', 'la carte des équipes suit le renommage');
    assert.equal(settings?.teamByZone['facturation'], undefined, 'l’ancien libellé ne traîne plus');
  });
});
