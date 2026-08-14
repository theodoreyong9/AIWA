// g.test.mjs — tests for the full composed materialized view
// A = G(H_d, θ), on top of the individually-tested cadence/reward/
// scarcity reducers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGState, applyGEvent, materializeG } from '../public/js/core/economics/g.js';

const theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { d1: null } };

function cadenceEvent(id, parents, domain, epoch) {
  return { id, parents, payload: { type: 'cadence', domain, epoch } };
}
function accrualEvent(id, parents, domain, b, q0) {
  return { id, parents, payload: { type: 'accrual', domain, b, q0 } };
}

test('accrual before any cadence advance yields zero reward (q=0, beta>0)', () => {
  const state = applyGEvent(theta, initialGState(theta), accrualEvent('e1', [], 'd1', 10, 0));
  assert.equal(state.balances.d1, 0);
});

test('accrual after cadence has advanced accrues reward proportional to elapsed epochs', () => {
  let state = initialGState(theta);
  state = applyGEvent(theta, state, cadenceEvent('c1', [], 'd1', 1));
  state = applyGEvent(theta, state, cadenceEvent('c2', ['c1'], 'd1', 2));
  // b=10 committed at q0=0, current epoch=2 -> q=2 -> r = 1*10^1*2^1 = 20
  state = applyGEvent(theta, state, accrualEvent('a1', ['c2'], 'd1', 10, 0));
  assert.equal(state.balances.d1, 20);
});

test('scarcity clamp applies to the composed reward, not just raw amount requested', () => {
  const tightTheta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { d1: 15 } };
  let state = initialGState(tightTheta);
  state = applyGEvent(tightTheta, state, cadenceEvent('c1', [], 'd1', 1));
  state = applyGEvent(tightTheta, state, cadenceEvent('c2', ['c1'], 'd1', 2));
  // requested reward = 20 (as above), but budget is only 15.
  state = applyGEvent(tightTheta, state, accrualEvent('a1', ['c2'], 'd1', 10, 0));
  assert.equal(state.balances.d1, 15);
  assert.equal(state.scarcity.domains.d1.used, 15);
});

test('malformed accrual events are rejected without throwing and without affecting balance', () => {
  let state = initialGState(theta);
  state = applyGEvent(theta, state, { id: 'x1', parents: [], payload: { type: 'accrual', domain: '', b: 10, q0: 0 } });
  state = applyGEvent(theta, state, { id: 'x2', parents: [], payload: { type: 'accrual', domain: 'd1', b: -5, q0: 0 } });
  assert.deepEqual(state.balances, {});
  assert.equal(state.accrualRejections.length, 2);
});

test('genesis and other non-economic event types pass through unchanged', () => {
  const state = applyGEvent(theta, initialGState(theta), { id: 'g1', parents: [], payload: { type: 'genesis' } });
  assert.deepEqual(state, initialGState(theta));
});

test('processing order (cadence before accrual) matters causally, matching real topo order', () => {
  // Feeding events out of causal order is a misuse (materializeG assumes
  // topo-ordered input, same contract as materializeCadence). This test
  // documents that contract rather than trying to be robust against it:
  // an accrual processed before its cadence advance simply sees q=0.
  const events = [
    accrualEvent('a1', ['c2'], 'd1', 10, 0), // fed first, out of order
    cadenceEvent('c1', [], 'd1', 1),
    cadenceEvent('c2', ['c1'], 'd1', 2),
  ];
  const state = materializeG(theta, events);
  assert.equal(state.balances.d1, 0); // saw q=0 because cadence hadn't folded yet
});
