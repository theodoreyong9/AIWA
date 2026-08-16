// event-dag.test.mjs — no dedicated test file existed for this core
// class before; EventDag was only exercised indirectly through the
// modules that use it. Added alongside subscribe() so the new
// mechanism has real, direct coverage, not just an absence of failures
// elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';

test('subscribe fires for a genuinely new event added via addEvent', async () => {
  const dag = new EventDag();
  const received = [];
  dag.subscribe((ev) => received.push(ev));

  const id = await dag.addEvent([], { type: 'genesis' });
  assert.equal(received.length, 1);
  assert.equal(received[0].id, id);
});

test('subscribe does NOT fire for a re-added, already-known event — addEvent is idempotent', async () => {
  const dag = new EventDag();
  const id1 = await dag.addEvent([], { type: 'genesis' });
  const received = [];
  dag.subscribe((ev) => received.push(ev));

  const id2 = await dag.addEvent([], { type: 'genesis' }); // identical payload -> identical id, already known
  assert.equal(id1, id2);
  assert.equal(received.length, 0, 're-adding an already-known event must not notify subscribers again');
});

test('subscribe fires for each genuinely new event pulled in by merge(), and only those', async () => {
  const a = new EventDag();
  const b = new EventDag();
  const sharedGenesis = await a.addEvent([], { type: 'genesis' });
  await b.addEvent([], { type: 'genesis' }); // same payload -> same id as a's genesis, already known to b too
  const bOnly = await b.addEvent([sharedGenesis], { type: 'cadence', domain: 'x', epoch: 1 });

  const received = [];
  a.subscribe((ev) => received.push(ev.id));
  a.merge(b);

  assert.deepEqual(received, [bOnly], 'only the genuinely new event should notify — the shared genesis was already known to a');
});

test('unsubscribe stops further notifications without affecting the DAG itself', async () => {
  const dag = new EventDag();
  const received = [];
  const unsubscribe = dag.subscribe((ev) => received.push(ev));

  await dag.addEvent([], { type: 'genesis' });
  unsubscribe();
  await dag.addEvent([], { type: 'other-event' });

  assert.equal(received.length, 1, 'only the event before unsubscribe should have been received');
  assert.equal(dag.size, 2, 'unsubscribing must not affect the DAG itself');
});

test('multiple independent subscribers all receive the same new event', async () => {
  const dag = new EventDag();
  const receivedA = [];
  const receivedB = [];
  dag.subscribe((ev) => receivedA.push(ev.id));
  dag.subscribe((ev) => receivedB.push(ev.id));

  const id = await dag.addEvent([], { type: 'genesis' });
  assert.deepEqual(receivedA, [id]);
  assert.deepEqual(receivedB, [id]);
});

test('a DAG with no subscribers behaves exactly as before — subscribe is fully opt-in', async () => {
  const dag = new EventDag();
  const id = await dag.addEvent([], { type: 'genesis' });
  assert.equal(dag.size, 1);
  assert.equal(dag.topoOrder()[0].id, id);
});
