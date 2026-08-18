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
  linearCostCurve,
  requiredBurnLamports,
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

// ── Churn resistance: deployment-wide, real-slot-indexed identity cost ──

test('linearCostCurve is a pure, deterministic function of slots-since-genesis', () => {
  const curve = linearCostCurve({ baseLamports: 1000, lamportsPerSlot: 10 });
  assert.equal(curve(0), 1000);
  assert.equal(curve(50), 1500);
  assert.equal(curve(100), 2000);
});

test('requiredBurnLamports computes purely locally from two already-known numbers, no live clock needed', () => {
  const curve = linearCostCurve({ baseLamports: 1000, lamportsPerSlot: 10 });
  assert.equal(requiredBurnLamports(1050, 1000, curve), 1500); // 50 slots since genesis
  assert.equal(requiredBurnLamports(1000, 1000, curve), 1000); // at genesis itself
});

test('requiredBurnLamports never goes negative for a registration slot before genesis (clamped, not penalized)', () => {
  const curve = linearCostCurve({ baseLamports: 1000, lamportsPerSlot: 10 });
  assert.equal(requiredBurnLamports(900, 1000, curve), 1000); // pre-genesis slot -> treated as 0 elapsed, not negative
});

test('requiredBurnLamports returns 0 for a null/unknown slot — an absent field is never advantageous, but also never penalized beyond the caller\'s own explicit floor', () => {
  const curve = linearCostCurve({ baseLamports: 1000, lamportsPerSlot: 10 });
  assert.equal(requiredBurnLamports(null, 1000, curve), 0);
  assert.equal(requiredBurnLamports(undefined, 1000, curve), 0);
});

test('registerIdentityCost enforces the cost curve when churnConfig is supplied', () => {
  const curve = linearCostCurve({ baseLamports: ONE_SOL_LAMPORTS, lamportsPerSlot: 1_000_000 });
  const state = initialIdentityCostState();
  // Registering 500 slots after genesis needs 1 SOL + 500_000_000 lamports; this burn is only 1 SOL.
  const result = registerIdentityCost(state, {
    domain: 'earth',
    tx: validTx({ slot: 1500 }),
    churnConfig: { genesisSlot: 1000, costCurve: curve },
  });
  assert.equal(result.accepted, false, 'a burn below the real slot-indexed requirement must be rejected');
});

test('registerIdentityCost accepts a burn that meets the real cost-curve requirement', () => {
  const curve = linearCostCurve({ baseLamports: ONE_SOL_LAMPORTS, lamportsPerSlot: 1_000_000 });
  const state = initialIdentityCostState();
  const result = registerIdentityCost(state, {
    domain: 'earth',
    tx: validTx({ slot: 1000, incineratorBalanceDeltaLamports: ONE_SOL_LAMPORTS }), // at genesis, base cost only
    churnConfig: { genesisSlot: 1000, costCurve: curve },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.registered.earth.slot, 1000);
});

test('a churn attempt — a second, later registration under a fresh domain id — costs objectively more in real terms than the first', () => {
  const curve = linearCostCurve({ baseLamports: ONE_SOL_LAMPORTS, lamportsPerSlot: 1_000_000 });
  const genesisSlot = 1000;
  const firstRequired = requiredBurnLamports(1100, genesisSlot, curve); // early registration
  const secondRequired = requiredBurnLamports(50100, genesisSlot, curve); // a churn attempt, much later in real time
  assert.ok(secondRequired > firstRequired, 'real elapsed deployment-wide time must make a later registration cost more, regardless of which domain id is used');
});

test('without churnConfig supplied at all, behavior is completely unchanged from before this mechanism existed — fully backward compatible', () => {
  const state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx({ slot: 999999999 }) }); // no churnConfig at all
  assert.equal(result.accepted, true, 'omitting churnConfig must reproduce the exact prior behavior — no curve enforced');
});

test('registered state now carries the real slot the burn landed at', () => {
  const state = initialIdentityCostState();
  const result = registerIdentityCost(state, { domain: 'earth', tx: validTx({ slot: 12345 }) });
  assert.equal(result.state.registered.earth.slot, 12345);
});

test('a tx with no slot field at all (slot omitted) registers with slot: null, not a crash', () => {
  const state = initialIdentityCostState();
  const tx = validTx();
  delete tx.slot;
  const result = registerIdentityCost(state, { domain: 'earth', tx });
  assert.equal(result.accepted, true);
  assert.equal(result.state.registered.earth.slot, null);
});

test('an explicit minLamports floor and a churnConfig curve compose — the higher of the two applies', () => {
  const curve = linearCostCurve({ baseLamports: 100, lamportsPerSlot: 1 }); // curve requires very little here
  const state = initialIdentityCostState();
  const result = registerIdentityCost(state, {
    domain: 'earth',
    tx: validTx({ slot: 1000, incineratorBalanceDeltaLamports: 500 }),
    minLamports: 10_000, // an explicit, higher deployment policy floor
    churnConfig: { genesisSlot: 1000, costCurve: curve },
  });
  assert.equal(result.accepted, false, 'the explicit minLamports floor (10,000) must still apply even though the curve alone would have accepted 500');
});
