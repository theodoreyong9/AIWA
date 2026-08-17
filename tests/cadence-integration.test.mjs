// cadence-integration.test.mjs — runs the cadence reducer through the
// real EventDag (not hand-built event objects), end to end: addEvent →
// topoOrder → materializeCadence. cadence.test.mjs checks the reducer's
// rules in isolation; this checks that it actually behaves correctly
// wired to the real DAG it will run against in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeCadence } from '../public/js/core/economics/cadence.js';
import { cadencePayload } from './helpers/cadence-vdf-helper.mjs';

test('cadence reducer over a real EventDag: valid chain advances, a skipped epoch is rejected', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const p1 = cadencePayload('mars-colony-1', 1);
  const c1 = await dag.addEvent([genesis], p1);
  const p2 = cadencePayload('mars-colony-1', 2, p1.vdfOutput);
  const c2 = await dag.addEvent([c1], p2);
  const p4 = cadencePayload('mars-colony-1', 4, p2.vdfOutput);
  await dag.addEvent([c2], p4); // invalid: skips 3

  const state = materializeCadence(dag.topoOrder());

  assert.equal(state.domains['mars-colony-1'].epoch, 2);
  assert.equal(state.domains['mars-colony-1'].lastId, c2);
  assert.equal(state.rejections.length, 1);
});

test('cadence reducer is stable across two DAGs merged in either order', async () => {
  // Simulates two partitioned domains reconciling: build the same two
  // independent cadence chains via two different EventDag instances,
  // merge them in both orders, and confirm materialization agrees —
  // this is the DAG-level analogue of §9's determinism requirement.
  const dagA = new EventDag();
  const genesis = await dagA.addEvent([], { type: 'genesis' });
  const aP1 = cadencePayload('domain-a', 1);
  const a1 = await dagA.addEvent([genesis], aP1);
  await dagA.addEvent([a1], cadencePayload('domain-a', 2, aP1.vdfOutput));

  const dagB = new EventDag();
  await dagB.addEvent([], { type: 'genesis' }); // same payload -> same id as dagA's genesis
  const bP1 = cadencePayload('domain-b', 1);
  const b1 = await dagB.addEvent([genesis], bP1);
  await dagB.addEvent([b1], cadencePayload('domain-b', 2, bP1.vdfOutput));

  const mergedForward = new EventDag();
  mergedForward.merge(dagA);
  mergedForward.merge(dagB);

  const mergedBackward = new EventDag();
  mergedBackward.merge(dagB);
  mergedBackward.merge(dagA);

  const stateForward = materializeCadence(mergedForward.topoOrder());
  const stateBackward = materializeCadence(mergedBackward.topoOrder());

  assert.deepEqual(stateForward.domains, stateBackward.domains);
  assert.equal(stateForward.domains['domain-a'].epoch, 2);
  assert.equal(stateForward.domains['domain-b'].epoch, 2);
  assert.equal(stateForward.rejections.length, 0);
});
