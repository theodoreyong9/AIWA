// g.test.mjs — tests for the full composed materialized view
// A = G(H_d, θ), on top of the individually-tested cadence/reward/
// scarcity reducers. Uses the real Proof-of-Will reward structure
// (reward.js), with parameters chosen so the denominator collapses to
// exactly 1 (beta=0 nullifies qTotal's contribution; C = e-1 makes
// ln(1+C) = ln(e) = 1) — this makes r = b * max(1,q) by construction,
// so expected values stay hand-verifiable despite the more complex
// real formula.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGState, applyGEvent, materializeG } from '../public/js/core/economics/g.js';

const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: { d1: null } };

function cadenceEvent(id, parents, domain, epoch) {
  return { id, parents, payload: { type: 'cadence', domain, epoch } };
}
function accrualEvent(id, parents, domain, b, q0, T = 0) {
  return { id, parents, payload: { type: 'accrual', domain, b, q0, T } };
}

test('accrual before any cadence advance yields zero reward (q=0 < minQ=1)', () => {
  const state = applyGEvent(theta, initialGState(theta), accrualEvent('e1', [], 'd1', 10, 0));
  assert.equal(state.balances.d1, 0);
});

test('accrual after cadence has advanced accrues reward proportional to elapsed epochs', () => {
  let state = initialGState(theta);
  state = applyGEvent(theta, state, cadenceEvent('c1', [], 'd1', 1));
  state = applyGEvent(theta, state, cadenceEvent('c2', ['c1'], 'd1', 2));
  // b=10 committed at q0=0, current epoch=2 -> q=2 -> r = 10 * max(1,2) = 20
  state = applyGEvent(theta, state, accrualEvent('a1', ['c2'], 'd1', 10, 0));
  assert.equal(state.balances.d1, 20);
});

test('scarcity clamp applies to the composed reward, not just raw amount requested', () => {
  const tightTheta = { reward: theta.reward, budgets: { d1: 15 } };
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

test('a missing T in the accrual payload defaults to patience rate 0, not a rejection', () => {
  let state = initialGState(theta);
  state = applyGEvent(theta, state, cadenceEvent('c1', [], 'd1', 1));
  state = applyGEvent(theta, state, cadenceEvent('c2', ['c1'], 'd1', 2));
  state = applyGEvent(theta, state, { id: 'a1', parents: ['c2'], payload: { type: 'accrual', domain: 'd1', b: 10, q0: 0 } }); // no T field
  assert.equal(state.balances.d1, 20); // identical to T=0 explicitly
});

test('processing order (cadence before accrual) matters causally, matching real topo order', () => {
  const events = [
    accrualEvent('a1', ['c2'], 'd1', 10, 0), // fed first, out of order
    cadenceEvent('c1', [], 'd1', 1),
    cadenceEvent('c2', ['c1'], 'd1', 2),
  ];
  const state = materializeG(theta, events);
  assert.equal(state.balances.d1, 0); // saw q=0 < minQ because cadence hadn't folded yet
});
