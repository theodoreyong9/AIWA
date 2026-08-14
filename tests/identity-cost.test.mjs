// identity-cost.test.mjs — tests the pure verification/registration
// logic against synthetic NormalizedBurnTx fixtures. Never touches the
// network — see solana-rpc.js's header for why that part can't be
// tested here.

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

test('a valid, finalized burn of at least minLamports is accepted', () => {
  const check = verifyBurnProof(validTx(), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, true);
});

test('a failed on-chain transaction (err non-null) is rejected', () => {
  const check = verifyBurnProof(validTx({ err: { InstructionError: [0, 'Custom'] } }), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, false);
  assert.match(check.reason, /failed on-chain/);
});

test('a non-finalized commitment is rejected, even if otherwise valid', () => {
  const check = verifyBurnProof(validTx({ commitment: 'confirmed' }), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, false);
  assert.match(check.reason, /not 'finalized'/);
});

test('a burn below the required minimum is rejected', () => {
  const check = verifyBurnProof(validTx({ incineratorBalanceDeltaLamports: ONE_SOL_LAMPORTS / 2 }), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, false);
  assert.match(check.reason, /need >=/);
});

test('a transaction that never touches the incinerator address (delta 0) is rejected', () => {
  const check = verifyBurnProof(validTx({ incineratorBalanceDeltaLamports: 0 }), { minLamports: ONE_SOL_LAMPORTS });
  assert.equal(check.valid, false);
});

test('registerIdentityCost accepts a valid burn and records it', () => {
  let state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx(), minLamports: ONE_SOL_LAMPORTS, now: 1000 });

  assert.equal(result.accepted, true);
  assert.equal(hasIdentityCost(result.state, 'earth'), true);
  assert.equal(result.state.registered.earth.burnedLamports, ONE_SOL_LAMPORTS);
  assert.equal(result.state.registered.earth.registeredAt, 1000);
});

test('the same burn signature cannot back two different domains (replay guard)', () => {
  let state = initialIdentityCostState();
  ({ state } = registerIdentityCost(state, { domain: 'earth', tx: validTx(), minLamports: ONE_SOL_LAMPORTS }));

  const second = registerIdentityCost(state, { domain: 'mars', tx: validTx(), minLamports: ONE_SOL_LAMPORTS });
  assert.equal(second.accepted, false);
  assert.match(second.reason, /already used/);
  assert.equal(hasIdentityCost(second.state, 'mars'), false);
});

test('a domain cannot register a second identity cost once it already has one', () => {
  let state = initialIdentityCostState();
  ({ state } = registerIdentityCost(state, { domain: 'earth', tx: validTx({ signature: 'sig-1' }), minLamports: ONE_SOL_LAMPORTS }));

  const second = registerIdentityCost(state, { domain: 'earth', tx: validTx({ signature: 'sig-2' }), minLamports: ONE_SOL_LAMPORTS });
  assert.equal(second.accepted, false);
  assert.match(second.reason, /already has a registered/);
});

test('an invalid burn is rejected at registration time too, not just at verifyBurnProof', () => {
  let state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx({ incineratorBalanceDeltaLamports: 1 }), minLamports: ONE_SOL_LAMPORTS });
  assert.equal(result.accepted, false);
  assert.equal(hasIdentityCost(result.state, 'earth'), false);
});

test('hasIdentityCost is false for an unregistered domain', () => {
  assert.equal(hasIdentityCost(initialIdentityCostState(), 'mars'), false);
});
