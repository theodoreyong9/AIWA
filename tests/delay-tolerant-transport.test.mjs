import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDelayTolerantTransport } from '../public/js/core/transport/delay-tolerant-transport.js';

function fakeSender({ up = true } = {}) {
  const sent = [];
  const fn = async (peerId, data) => {
    if (!up) return false;
    sent.push({ peerId, data });
    return true;
  };
  return { fn, sent, setUp: (v) => { up = v; } };
}

test('send while the network is up delivers immediately and leaves nothing queued', async () => {
  const { fn, sent } = fakeSender({ up: true });
  const t = createDelayTolerantTransport(fn);
  const delivered = await t.send('peerA', { hello: 1 });
  assert.equal(delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(t.queueDepth('peerA'), 0);
});

test('send while the network is down stays queued, durably, not lost', async () => {
  const sender = fakeSender({ up: false });
  const t = createDelayTolerantTransport(sender.fn);
  const delivered = await t.send('peerA', { hello: 1 });
  assert.equal(delivered, false);
  assert.equal(t.queueDepth('peerA'), 1);
  assert.equal(sender.sent.length, 0);
});

test('flush() delivers everything queued once the contact window opens', async () => {
  const sender = fakeSender({ up: false });
  const t = createDelayTolerantTransport(sender.fn);
  await t.send('peerA', 'msg1');
  await t.send('peerA', 'msg2');
  assert.equal(t.queueDepth('peerA'), 2);

  sender.setUp(true); // contact window opens
  const sentCount = await t.flush();

  assert.equal(sentCount, 2);
  assert.equal(t.queueDepth('peerA'), 0);
  assert.deepEqual(sender.sent.map((s) => s.data), ['msg1', 'msg2']); // FIFO order preserved
});

test('a message never overtakes an earlier one still stuck — flush stops at the first failure per peer', async () => {
  let allowCount = 0;
  const sent = [];
  const flaky = async (peerId, data) => {
    if (allowCount <= 0) return false;
    allowCount--;
    sent.push(data);
    return true;
  };
  const t = createDelayTolerantTransport(flaky);
  await t.send('peerA', 'msg1');
  await t.send('peerA', 'msg2');
  await t.send('peerA', 'msg3');

  allowCount = 1; // only the FIRST attempt in the next flush will succeed
  await t.flush();

  assert.deepEqual(sent, ['msg1']);
  assert.equal(t.queueDepth('peerA'), 2, 'msg2 and msg3 must remain queued, not be skipped over');
});

test('different peers have independent queues — one stuck peer does not block another', async () => {
  const upFor = new Set(['peerB']);
  const sent = [];
  const partial = async (peerId, data) => {
    if (!upFor.has(peerId)) return false;
    sent.push({ peerId, data });
    return true;
  };
  const t = createDelayTolerantTransport(partial);
  await t.send('peerA', 'to-a'); // peerA is down, stays queued
  await t.send('peerB', 'to-b'); // peerB is up, delivered immediately

  assert.equal(t.queueDepth('peerA'), 1);
  assert.equal(t.queueDepth('peerB'), 0);
  assert.deepEqual(sent, [{ peerId: 'peerB', data: 'to-b' }]);
});

test('broadcast (peerId=null) has its own queue, independent of per-peer queues', async () => {
  const sender = fakeSender({ up: false });
  const t = createDelayTolerantTransport(sender.fn);
  await t.send(null, 'broadcast-msg');
  await t.send('peerA', 'direct-msg');

  assert.equal(t.queueDepth(null), 1);
  assert.equal(t.queueDepth('peerA'), 1);
  assert.equal(t.totalQueueDepth(), 2);
});

test('inbound message delivery dispatches to registered listeners', () => {
  const t = createDelayTolerantTransport(async () => true);
  const received = [];
  t.onMessage((peerId, data) => received.push({ peerId, data }));
  t._deliverInbound('peerA', { real: true });
  assert.deepEqual(received, [{ peerId: 'peerA', data: { real: true } }]);
});

test('peer join/leave listeners fire, and only on actual state transitions', () => {
  const t = createDelayTolerantTransport(async () => true);
  const joins = [];
  const leaves = [];
  t.onPeerJoin((id) => joins.push(id));
  t.onPeerLeave((id) => leaves.push(id));

  t._notePeerJoin('peerA');
  t._notePeerJoin('peerA'); // duplicate join — must not fire twice
  t._notePeerLeave('peerA');
  t._notePeerLeave('peerA'); // duplicate leave — must not fire twice

  assert.deepEqual(joins, ['peerA']);
  assert.deepEqual(leaves, ['peerA']);
});

test('a sendFn that throws is treated as a failure, not an unhandled rejection', async () => {
  const throwing = async () => { throw new Error('network exploded'); };
  const t = createDelayTolerantTransport(throwing);
  const delivered = await t.send('peerA', 'msg');
  assert.equal(delivered, false);
  assert.equal(t.queueDepth('peerA'), 1);
});
