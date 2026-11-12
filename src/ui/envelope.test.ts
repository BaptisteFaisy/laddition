import assert from 'node:assert/strict';
import test from 'node:test';
import { isFailureEnvelope, unwrap } from './envelope';

test('unwrap rejette l\'enveloppe d\'échec avec le message du serveur (D45)', () => {
  assert.throws(
    () => unwrap({ ok: false, error: 'projet « 1 » sans réglages : ouvrir l\'écran Réglages' }),
    /sans réglages/,
  );
});

test('unwrap ne confond pas une donnée avec une enveloppe d\'échec', () => {
  assert.equal(isFailureEnvelope({ ok: true }), false);
  assert.equal(isFailureEnvelope({ ok: false }), false);
  assert.equal(isFailureEnvelope(null), false);
  assert.equal(isFailureEnvelope('texte'), false);
  assert.deepEqual(unwrap({ ok: true }), { ok: true });
});

test('unwrap déballe le corps quand invoke enveloppe la réponse', () => {
  assert.deepEqual(unwrap({ body: { lowJp: 1 } }), { lowJp: 1 });
});

test('unwrap rend la donnée nue telle quelle', () => {
  assert.deepEqual(unwrap([1, 2, 3]), [1, 2, 3]);
  assert.equal(unwrap('ok'), 'ok');
  assert.equal(unwrap(null), null);
});
