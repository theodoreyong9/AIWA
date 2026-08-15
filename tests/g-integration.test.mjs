// g-integration.test.mjs — runs the full composed G through the real
// EventDag end to end: addEvent → topoOrder → materializeG. Unlike
// g.test.mjs's hand-ordered event arrays, topoOrder() guarantees
// parents-before-children, so this is the actual contract the app runs
// under, not an idealized one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';

test('full G over a real EventDag: cadence advances, then accrual reflects elapsed epochs, scarcity-clamped', async () => {
  const dag = new EventDag();
  const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: { 'mars-colony-1': 100 } };

  const genesis = await dag.addEvent([], { type: 'genesis' });
  const c1 = await dag.addEvent([genesis], { type: 'cadence', domain: 'mars-colony-1', epoch: 1 });
  const c2 = await dag.addEvent([c1], { type: 'cadence', domain: 'mars-colony-1', epoch: 2 });
  const c3 = await dag.addEvent([c2], { type: 'cadence', domain: 'mars-colony-1', epoch: 3 });
  // Committed b=10 at q0=0; by epoch 3, q=3 -> requested reward = 10 * max(1,3) = 30.
  await dag.addEvent([c3], { type: 'accrual', domain: 'mars-colony-1', b: 10, q0: 0 });
  // A second, later commitment: b=5 at q0=3 (i.e. right when this event
  // is added) -> q=0 at this point, below minQ=1 -> reward 0, since it
  // hasn't aged yet.
  await dag.addEvent([c3], { type: 'accrual', domain: 'mars-colony-1', b: 5, q0: 3 });

  const state = materializeG(theta, dag.topoOrder());

  assert.equal(state.cadence.domains['mars-colony-1'].epoch, 3);
  assert.equal(state.balances['mars-colony-1'], 30);
  assert.equal(state.scarcity.domains['mars-colony-1'].used, 30);
});

test('two events that would collide under a weak identifier do not collide under the real DAG (Lemma 1 holds structurally)', async () => {
  // Direct integration check of the g.js file header's Lemma 1 claim:
  // because accrual payloads carry q0, and the DAG's id hashes the full
  // canonicalized payload (§8.1), two accrual events with the same
  // (domain, b) but different q0 get different ids and are NOT
  // deduplicated by the DAG — both are folded, matching §11's
  // requirement that a safe identity scheme must not merge economically
  // distinct events.
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const idAtQ0 = await dag.addEvent([genesis], { type: 'accrual', domain: 'd1', b: 10, q0: 0 });
  const idAtQ5 = await dag.addEvent([genesis], { type: 'accrual', domain: 'd1', b: 10, q0: 5 });

  assert.notEqual(idAtQ0, idAtQ5);
  assert.equal(dag.size, 3); // genesis + both distinct accrual events, not deduplicated
});
