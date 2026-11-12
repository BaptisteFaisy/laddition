import assert from 'node:assert/strict';
import test from 'node:test';
import { canLink, issueUrl, projectUrl } from './links';

const SITE = 'https://pay.atlassian.net';

test('issueUrl compose l\'adresse d\'un ticket (D50)', () => {
  assert.equal(issueUrl(SITE, 'PAY-77'), 'https://pay.atlassian.net/browse/PAY-77');
});

test('issueUrl ne duplique pas la barre oblique du site', () => {
  assert.equal(issueUrl(`${SITE}/`, 'PAY-77'), 'https://pay.atlassian.net/browse/PAY-77');
});

test('projectUrl compose l\'adresse d\'un projet', () => {
  assert.equal(projectUrl(SITE, 'PAY'), 'https://pay.atlassian.net/browse/PAY');
});

test('canLink refuse un site ou une clé vide', () => {
  assert.equal(canLink(SITE, 'PAY-77'), true);
  assert.equal(canLink('', 'PAY-77'), false);
  assert.equal(canLink(SITE, ''), false);
});
