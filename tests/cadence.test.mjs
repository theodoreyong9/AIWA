// cadence.test.mjs — mirrors rust-core/src/economics/cadence.rs's test
// suite exactly, case for case, so both implementations are checked
// against the same behavioral contract.
//
// Run: node --test tests/cadence.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialCadenceState, applyCadenceEvent, materializeCadence } from '../public/js/core/economics/cadence.js';

function cadenceEvent(id, parents, domain, epoch) {
  return { id, parents, payload: { type: 'cadence', domain, epoch } };
}

test('first cadence transition is accepted', () => {
  const state = applyCadenceEvent(initialCadenceState(), cadenceEvent('c1', [], 'd1', 1));
  assert.deepEqual(state.domains.d1, { epoch: 1, lastId: 'c1' });
  assert.equal(state.rejections.length, 0);
});

test('skipping an epoch is rejected', () => {
  let state = initialCadenceState();
  state = applyCadenceEvent(state, cadenceEvent('c1', [], 'd1', 1));
  state = applyCadenceEvent(state, cadenceEvent('c2', ['c1'], 'd1', 3)); // skip 2
  assert.equal(state.domains.d1.epoch, 1);
  assert.equal(state.rejections.length, 1);
});

test('transition not chained to last accepted is rejected', () => {
  let state = initialCadenceState();
  state = applyCadenceEvent(state, cadenceEvent('c1', [], 'd1', 1));
  // c2 claims epoch 2 but doesn't reference c1 as a parent.
  state = applyCadenceEvent(state, cadenceEvent('c2', [], 'd1', 2));
  assert.equal(state.domains.d1.epoch, 1);
  assert.equal(state.rejections.length, 1);
});

test('forked competing transition at the same epoch is rejected', () => {
  let state = initialCadenceState();
  state = applyCadenceEvent(state, cadenceEvent('c1', [], 'd1', 1));
  state = applyCadenceEvent(state, cadenceEvent('c2', ['c1'], 'd1', 2));
  // c2b also claims epoch 2, chained from c1 — a fork attempt.
  state = applyCadenceEvent(state, cadenceEvent('c2b', ['c1'], 'd1', 2));
  assert.equal(state.domains.d1.lastId, 'c2');
  assert.equal(state.rejections.length, 1);
});

test('independent domains advance independently', () => {
  let state = initialCadenceState();
  state = applyCadenceEvent(state, cadenceEvent('a1', [], 'domain-a', 1));
  state = applyCadenceEvent(state, cadenceEvent('b1', [], 'domain-b', 1));
  state = applyCadenceEvent(state, cadenceEvent('a2', ['a1'], 'domain-a', 2));
  assert.equal(state.domains['domain-a'].epoch, 2);
  assert.equal(state.domains['domain-b'].epoch, 1);
  assert.equal(state.rejections.length, 0);
});

test('interleaving of independent domains does not affect the final state', () => {
  // §9: G must be deterministic over the converged event set alone, not
  // over receipt/processing order.
  const a1 = cadenceEvent('a1', [], 'domain-a', 1);
  const a2 = cadenceEvent('a2', ['a1'], 'domain-a', 2);
  const b1 = cadenceEvent('b1', [], 'domain-b', 1);
  const b2 = cadenceEvent('b2', ['b1'], 'domain-b', 2);

  const order1 = materializeCadence([a1, b1, a2, b2]);
  const order2 = materializeCadence([b1, a1, b2, a2]);

  assert.deepEqual(order1.domains, order2.domains);
  assert.equal(order1.rejections.length, 0);
  assert.equal(order2.rejections.length, 0);
});

test('invalid domain and epoch shapes are rejected without throwing', () => {
  let state = initialCadenceState();
  state = applyCadenceEvent(state, { id: 'x1', parents: [], payload: { type: 'cadence', domain: '', epoch: 1 } });
  state = applyCadenceEvent(state, { id: 'x2', parents: [], payload: { type: 'cadence', domain: 'd1', epoch: 0 } });
  state = applyCadenceEvent(state, { id: 'x3', parents: [], payload: { type: 'cadence', domain: 'd1', epoch: 1.5 } });
  assert.equal(state.rejections.length, 3);
  assert.deepEqual(state.domains, {});
});

test('non-cadence events pass through unchanged', () => {
  const state = applyCadenceEvent(initialCadenceState(), { id: 'e1', parents: [], payload: { type: 'genesis' } });
  assert.deepEqual(state, initialCadenceState());
});
