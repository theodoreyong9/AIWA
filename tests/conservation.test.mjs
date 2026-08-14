// conservation.test.mjs — tests for §6.1/§7's proof-carrying
// Deactivate→Prove→Verify→Consume→Activate pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialConservationState,
  issueClaim,
  deactivate,
  proveTransfer,
  verify,
  consume,
  activate,
  transfer,
  identityDerivation,
} from '../public/js/core/conservation/conservation.js';

const derivations = { identity: identityDerivation };

test('a plain transfer (identity derivation) moves ownership without changing kind or amount', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });

  const { state: after, proof } = transfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);

  assert.equal(after.claims.c1.status, 'consumed');
  const destClaim = after.claims[`activated:${proof.id}`];
  assert.equal(destClaim.kind, 'X');
  assert.equal(destClaim.amount, 10);
  assert.equal(destClaim.owner, 'bob');
  assert.equal(destClaim.status, 'active');
});

test('a transmutation (burn X, mint Y) converts kind via an authorized derivation function', () => {
  // This is the exact "burn one crypto to produce another" case: an
  // authorized f converts kind X into kind Y at some exchange rate.
  const burnXMintY = (kind, amount) => (kind === 'X' ? { kind: 'Y', amount: amount * 2 } : null);
  const derivs = { identity: identityDerivation, burnXMintY };

  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });

  const { state: after, proof } = transfer(state, { claimId: 'c1', from: 'alice', to: 'alice', n: 'n1', derivation: 'burnXMintY' }, derivs);

  assert.equal(after.claims.c1.kind, 'X'); // the original claim's record is preserved, just marked consumed
  assert.equal(after.claims.c1.status, 'consumed');
  const minted = after.claims[`activated:${proof.id}`];
  assert.equal(minted.kind, 'Y');
  assert.equal(minted.amount, 20); // 10 X burned -> 20 Y minted, per the authorized rate
  assert.equal(minted.owner, 'alice');
});

test('an unauthorized derivation function is rejected at the Prove step', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');

  assert.throws(
    () => proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'no-such-function' }, derivations),
    /Unauthorized derivation function/
  );
});

test('a derivation function that rejects its input (wrong kind) is rejected at the Prove step', () => {
  const burnXMintY = (kind, amount) => (kind === 'X' ? { kind: 'Y', amount: amount * 2 } : null);
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'Z', amount: 10, owner: 'alice' }); // wrong kind for this derivation
  state = deactivate(state, 'c1');

  assert.throws(
    () => proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'alice', n: 'n1', derivation: 'burnXMintY' }, { burnXMintY }),
    /rejected input/
  );
});

test('the protocol order is enforced: cannot Prove before Deactivate', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  // Still 'active', not 'deactivated' — proveTransfer must reject this.
  assert.throws(
    () => proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations),
    /not 'deactivated'/
  );
});

test('the protocol order is enforced: cannot Activate before Consume', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);
  // Skipping consume() entirely.
  assert.throws(() => activate(state, proof), /has not been consumed yet/);
});

test('count(Consume(p)) <= 1: consuming the same proof twice is rejected', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);

  const afterFirstConsume = consume(state, proof);
  assert.throws(() => consume(afterFirstConsume, proof), /already consumed/);
});

test('verify can be called more than once safely (verification is not consumption)', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);

  assert.equal(verify(state, proof, derivations).valid, true);
  assert.equal(verify(state, proof, derivations).valid, true); // still fine, no state changed
});

test('verify rejects a proof whose claimed output does not match what the derivation function actually produces', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);

  const forgedProof = { ...proof, amountOut: 999 }; // tampered
  const result = verify(state, forgedProof, derivations);
  assert.equal(result.valid, false);
  assert.match(result.reason, /does not match/);
});

test('a claim already deactivated cannot be deactivated again (single-use, before consume is even reached)', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  assert.throws(() => deactivate(state, 'c1'), /not 'active'/);
});
