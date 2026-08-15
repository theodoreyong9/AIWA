// identity-cost.test.mjs — tests the pure verification/registration
// logic against synthetic NormalizedBurnTx fixtures. Never touches the
// network — see solana-rpc.js's header for why that part can't be
// tested here.
//
// No fixed minimum burn amount by design (discussed with the user):
// verifyBurnProof()'s minLamports defaults to 0 — any positive burn is
// a real, irrecoverable cost and counts as c_id. minLamports remains an
// optional per-deployment policy knob, tested separately below, not a
// hardcoded floor this project imposes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialIdentityCostState,
  verifyBurnProof,
  registerIdentityCost,
  hasIdentityCost,
} from '../public/js/core/identity/identity-cost.js';

const ONE_SOL_LAMPORTS = 1_000_000_000;

function validTx(overrides = {}) {
  return {
    signature: 'sig-earth-1',
    err: null,
    incineratorBalanceDeltaLamports: ONE_SOL_LAMPORTS,
    commitment: 'finalized',
    ...overrides,
  };
}

test('a valid, finalized burn is accepted with no minLamports specified (default: no floor)', () => {
  const check = verifyBurnProof(validTx());
  assert.equal(check.valid, true);
});

test('a tiny burn (1 lamport) is accepted — there is no minimum by default', () => {
  const check = verifyBurnProof(validTx({ incineratorBalanceDeltaLamports: 1 }));
  assert.equal(check.valid, true);
});

test('a zero-lamport "burn" is rejected — something must actually have been burned', () => {
  const check = verifyBurnProof(validTx({ incineratorBalanceDeltaLamports: 0 }));
  assert.equal(check.valid, false);
  assert.match(check.reason, /no positive burn detected/);
});

test('a failed on-chain transaction (err non-null) is rejected', () => {
  const check = verifyBurnProof(validTx({ err: { InstructionError: [0, 'Custom'] } }));
  assert.equal(check.valid, false);
  assert.match(check.reason, /failed on-chain/);
});

test('a non-finalized commitment is rejected, even if otherwise valid', () => {
  const check = verifyBurnProof(validTx({ commitment: 'confirmed' }));
  assert.equal(check.valid, false);
  assert.match(check.reason, /not 'finalized'/);
});

test('minLamports remains available as an OPTIONAL per-deployment policy floor', () => {
  const check = verifyBurnProof(validTx({ incineratorBalanceDeltaLamports: ONE_SOL_LAMPORTS / 2 }), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, false);
  assert.match(check.reason, /deployment-configured floor/);
});

test('registerIdentityCost accepts a small burn with no minLamports specified', () => {
  let state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx({ incineratorBalanceDeltaLamports: 500 }), now: 1000 });

  assert.equal(result.accepted, true);
  assert.equal(hasIdentityCost(result.state, 'earth'), true);
  assert.equal(result.state.registered.earth.burnedLamports, 500);
  assert.equal(result.state.registered.earth.registeredAt, 1000);
});

test('the same burn signature cannot back two different domains (replay guard)', () => {
  let state = initialIdentityCostState();
  ({ state } = registerIdentityCost(state, { domain: 'earth', tx: validTx() }));

  const second = registerIdentityCost(state, { domain: 'mars', tx: validTx() });
  assert.equal(second.accepted, false);
  assert.match(second.reason, /already used/);
  assert.equal(hasIdentityCost(second.state, 'mars'), false);
});

test('a domain cannot register a second identity cost once it already has one', () => {
  let state = initialIdentityCostState();
  ({ state } = registerIdentityCost(state, { domain: 'earth', tx: validTx({ signature: 'sig-1' }) }));

  const second = registerIdentityCost(state, { domain: 'earth', tx: validTx({ signature: 'sig-2' }) });
  assert.equal(second.accepted, false);
  assert.match(second.reason, /already has a registered/);
});

test('registration still rejects a zero/no burn', () => {
  let state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx({ incineratorBalanceDeltaLamports: 0 }) });
  assert.equal(result.accepted, false);
  assert.equal(hasIdentityCost(result.state, 'earth'), false);
});

test('hasIdentityCost is false for an unregistered domain', () => {
  assert.equal(hasIdentityCost(initialIdentityCostState(), 'mars'), false);
});
