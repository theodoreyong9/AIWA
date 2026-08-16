import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertImplementsTransport, createUnconnectedTransport } from '../public/js/core/transport/transport.js';

test('a fully-conforming object passes the structural check', () => {
  const conforming = {
    connect: async () => {},
    send: async () => true,
    onMessage: () => {},
    onPeerJoin: () => {},
    onPeerLeave: () => {},
  };
  const check = assertImplementsTransport(conforming);
  assert.equal(check.valid, true);
  assert.deepEqual(check.missing, []);
});

test('a partial implementation is caught, naming exactly what is missing', () => {
  const partial = { connect: async () => {}, send: async () => true };
  const check = assertImplementsTransport(partial);
  assert.equal(check.valid, false);
  assert.deepEqual(check.missing.sort(), ['onMessage', 'onPeerJoin', 'onPeerLeave']);
});

test('null or undefined is caught, not thrown on', () => {
  assert.equal(assertImplementsTransport(null).valid, false);
  assert.equal(assertImplementsTransport(undefined).valid, false);
});

test('an unconnected transport throws a clear, diagnosable error on every method, not a silent no-op', async () => {
  const t = createUnconnectedTransport();
  await assert.rejects(() => t.connect('room', 'app'), /before a concrete backend was connected/);
  await assert.rejects(() => t.send('peer', {}), /before a concrete backend was connected/);
  assert.throws(() => t.onMessage(() => {}), /before a concrete backend was connected/);
  assert.throws(() => t.onPeerJoin(() => {}), /before a concrete backend was connected/);
  assert.throws(() => t.onPeerLeave(() => {}), /before a concrete backend was connected/);
});

test('an unconnected transport itself satisfies the structural contract (all methods present, just not usable yet)', () => {
  const check = assertImplementsTransport(createUnconnectedTransport());
  assert.equal(check.valid, true);
});
