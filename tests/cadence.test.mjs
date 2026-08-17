// cadence.test.mjs — mirrors rust-core/src/economics/cadence.rs's test
// suite exactly, case for case, so both implementations are checked
// against the same behavioral contract.
//
// Run: node --test tests/cadence.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialCadenceState, applyCadenceEvent, materializeCadence } from '../public/js/core/economics/cadence.js';
import { cadencePayload, TEST_VDF_ITERATIONS } from './helpers/cadence-vdf-helper.mjs';

function cadenceEvent(id, parents, domain, epoch, previousVdfOutput) {
  return { id, parents, payload: cadencePayload(domain, epoch, previousVdfOutput) };
}

test('first cadence transition is accepted', () => {
  const event = cadenceEvent('c1', [], 'd1', 1);
  const state = applyCadenceEvent(initialCadenceState(), event);
  assert.equal(state.domains.d1.epoch, 1);
  assert.equal(state.domains.d1.lastId, 'c1');
  assert.equal(state.domains.d1.vdfOutput, event.payload.vdfOutput);
  assert.equal(state.rejections.length, 0);
});

test('skipping an epoch is rejected', () => {
  let state = initialCadenceState();
  const e1 = cadenceEvent('c1', [], 'd1', 1);
  state = applyCadenceEvent(state, e1);
  const e2 = cadenceEvent('c2', ['c1'], 'd1', 3, e1.payload.vdfOutput); // skip 2
  state = applyCadenceEvent(state, e2);
  assert.equal(state.domains.d1.epoch, 1);
  assert.equal(state.rejections.length, 1);
});

test('transition not chained to last accepted is rejected', () => {
  let state = initialCadenceState();
  const e1 = cadenceEvent('c1', [], 'd1', 1);
  state = applyCadenceEvent(state, e1);
  // c2 claims epoch 2 but doesn't reference c1 as a parent.
  const e2 = cadenceEvent('c2', [], 'd1', 2, e1.payload.vdfOutput);
  state = applyCadenceEvent(state, e2);
  assert.equal(state.domains.d1.epoch, 1);
  assert.equal(state.rejections.length, 1);
});

test('forked competing transition at the same epoch is rejected', () => {
  let state = initialCadenceState();
  const e1 = cadenceEvent('c1', [], 'd1', 1);
  state = applyCadenceEvent(state, e1);
  const e2 = cadenceEvent('c2', ['c1'], 'd1', 2, e1.payload.vdfOutput);
  state = applyCadenceEvent(state, e2);
  // c2b also claims epoch 2, chained from c1 — a fork attempt.
  const e2b = cadenceEvent('c2b', ['c1'], 'd1', 2, e1.payload.vdfOutput);
  state = applyCadenceEvent(state, e2b);
  assert.equal(state.domains.d1.lastId, 'c2');
  assert.equal(state.rejections.length, 1);
});

test('independent domains advance independently', () => {
  let state = initialCadenceState();
  const a1 = cadenceEvent('a1', [], 'domain-a', 1);
  state = applyCadenceEvent(state, a1);
  state = applyCadenceEvent(state, cadenceEvent('b1', [], 'domain-b', 1));
  state = applyCadenceEvent(state, cadenceEvent('a2', ['a1'], 'domain-a', 2, a1.payload.vdfOutput));
  assert.equal(state.domains['domain-a'].epoch, 2);
  assert.equal(state.domains['domain-b'].epoch, 1);
  assert.equal(state.rejections.length, 0);
});

test('interleaving of independent domains does not affect the final state', () => {
  // §9: G must be deterministic over the converged event set alone, not
  // over receipt/processing order.
  const a1 = cadenceEvent('a1', [], 'domain-a', 1);
  const a2 = cadenceEvent('a2', ['a1'], 'domain-a', 2, a1.payload.vdfOutput);
  const b1 = cadenceEvent('b1', [], 'domain-b', 1);
  const b2 = cadenceEvent('b2', ['b1'], 'domain-b', 2, b1.payload.vdfOutput);

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

// ── R11: cadence VDF (§16.1's "two distinct roles"; closes the rate-
// of-advancement gap a mandatory heartbeat alone never addressed) ────

test('SECURITY R11: a cadence transition with no VDF proof at all is rejected', () => {
  const state = applyCadenceEvent(initialCadenceState(), { id: 'c1', parents: [], payload: { type: 'cadence', domain: 'd1', epoch: 1 } });
  assert.equal(state.domains.d1, undefined);
  assert.equal(state.rejections.length, 1);
});

test('SECURITY R11: a fabricated VDF output with no real computation behind it is rejected', () => {
  const state = applyCadenceEvent(initialCadenceState(), {
    id: 'c1', parents: [], payload: { type: 'cadence', domain: 'd1', epoch: 1, vdfIterations: TEST_VDF_ITERATIONS, vdfOutput: '0'.repeat(64) },
  });
  assert.equal(state.domains.d1, undefined);
  assert.equal(state.rejections.length, 1);
});

test('SECURITY R11: a real chain computed for FEWER iterations than claimed is rejected — cannot shortcut the count', () => {
  const short = cadencePayload('d1', 1); // real TEST_VDF_ITERATIONS work
  const state = applyCadenceEvent(initialCadenceState(), {
    id: 'c1', parents: [], payload: { ...short, vdfIterations: TEST_VDF_ITERATIONS * 100 }, // claims far more than was actually done
  });
  assert.equal(state.domains.d1, undefined);
  assert.equal(state.rejections.length, 1);
});

test('SECURITY R11: epoch 2\u2019s VDF proof genuinely depends on epoch 1\u2019s real output — cannot be precomputed without it', () => {
  let state = initialCadenceState();
  const e1 = cadenceEvent('c1', [], 'd1', 1);
  state = applyCadenceEvent(state, e1);

  // A "epoch 2" proof computed against the WRONG previous output (as if epoch 1 never happened, or guessed) — must be rejected.
  const wrongPrevious = cadencePayload('d1', 2, 'a-guessed-or-wrong-previous-output');
  const forged = applyCadenceEvent(state, { id: 'c2-forged', parents: ['c1'], payload: wrongPrevious });
  assert.equal(forged.domains.d1.epoch, 1, 'the forged epoch-2 attempt must not be accepted');
  assert.equal(forged.rejections.length, 1);

  // The REAL epoch 2, chained to the actual epoch 1 output, is accepted.
  const real = cadenceEvent('c2-real', ['c1'], 'd1', 2, e1.payload.vdfOutput);
  const ok = applyCadenceEvent(state, real);
  assert.equal(ok.domains.d1.epoch, 2);
  assert.equal(ok.rejections.length, 0);
});

test('SECURITY R11: a VDF proof computed for a DIFFERENT domain cannot be reused', () => {
  const aliceProof = cadencePayload('alice', 1);
  const state = applyCadenceEvent(initialCadenceState(), {
    id: 'c1', parents: [], payload: { ...aliceProof, domain: 'bob' }, // bob claims alice's real proof as his own
  });
  assert.equal(state.domains.bob, undefined);
  assert.equal(state.rejections.length, 1);
});

test('a real, honestly-computed sequence of several epochs is accepted end to end', () => {
  let state = initialCadenceState();
  let previousOutput;
  for (let epoch = 1; epoch <= 5; epoch++) {
    const payload = cadencePayload('d1', epoch, previousOutput);
    const parentId = epoch === 1 ? [] : [`c${epoch - 1}`];
    state = applyCadenceEvent(state, { id: `c${epoch}`, parents: parentId, payload });
    previousOutput = payload.vdfOutput;
  }
  assert.equal(state.domains.d1.epoch, 5);
  assert.equal(state.rejections.length, 0);
});
