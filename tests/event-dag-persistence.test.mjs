// event-dag-persistence.test.mjs — only topologicalSortForReplay() is
// testable here: it's pure, no IndexedDB involved. Everything else in
// event-dag-persistence.js touches indexedDB directly, a browser API
// with no equivalent in this Node-based test environment — real code,
// unverified here, the same category of limitation as solana-rpc.js's
// network calls (see that file's own tests, or rather, absence of
// them, for the established precedent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topologicalSortForReplay } from '../public/js/core/event-dag-persistence.js';
import { EventDag } from '../public/js/core/event-dag.js';

test('a linear chain is sorted parents-before-children, replayable in order', () => {
  const events = [
    { id: 'c', parents: ['b'], payload: {} },
    { id: 'a', parents: [], payload: {} },
    { id: 'b', parents: ['a'], payload: {} },
  ];
  const sorted = topologicalSortForReplay(events);
  assert.deepEqual(sorted.map((e) => e.id), ['a', 'b', 'c']);
});

test('a DAG with branching and merging parents is sorted correctly, not just a simple chain', () => {
  // genesis -> {c1, c2} -> merge (parents: [c1, c2])
  const events = [
    { id: 'merge', parents: ['c1', 'c2'], payload: {} },
    { id: 'genesis', parents: [], payload: {} },
    { id: 'c2', parents: ['genesis'], payload: {} },
    { id: 'c1', parents: ['genesis'], payload: {} },
  ];
  const sorted = topologicalSortForReplay(events);
  const indexOf = (id) => sorted.findIndex((e) => e.id === id);
  assert.ok(indexOf('genesis') < indexOf('c1'));
  assert.ok(indexOf('genesis') < indexOf('c2'));
  assert.ok(indexOf('c1') < indexOf('merge'));
  assert.ok(indexOf('c2') < indexOf('merge'));
});

test('an event referencing a parent not present in the loaded set is tolerated, not crashed on', () => {
  const events = [{ id: 'orphan', parents: ['missing-parent'], payload: {} }];
  assert.doesNotThrow(() => topologicalSortForReplay(events));
});

test('an empty input produces an empty output', () => {
  assert.deepEqual(topologicalSortForReplay([]), []);
});

test('the sorted output is genuinely replayable through a real EventDag — the actual property that matters', async () => {
  // Build a real DAG, extract its events in a SCRAMBLED order (not the
  // order they were created in), sort via topologicalSortForReplay(),
  // and confirm a fresh DAG can replay them via the real addEvent()
  // without ever hitting "Unknown parent".
  const original = new EventDag();
  const g = await original.addEvent([], { type: 'genesis' });
  const c1 = await original.addEvent([g], { type: 'cadence', epoch: 1 });
  const c2 = await original.addEvent([c1], { type: 'cadence', epoch: 2 });
  await original.addEvent([c2], { type: 'accrual', b: 10, q0: 0 });

  const flatEvents = original.topoOrder();
  const scrambled = [flatEvents[3], flatEvents[0], flatEvents[2], flatEvents[1]]; // deliberately out of order
  const sorted = topologicalSortForReplay(scrambled);

  const replayed = new EventDag();
  for (const ev of sorted) {
    await replayed.addEvent(ev.parents, ev.payload); // must never throw "Unknown parent"
  }
  assert.equal(replayed.size, original.size);
});
