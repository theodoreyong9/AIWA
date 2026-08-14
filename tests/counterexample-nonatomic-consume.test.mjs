// counterexample-nonatomic-consume.test.mjs — a deliberately broken
// variant of consume(), in the spirit of §20–22's methodology (and
// mirroring tests/counterexample-wallclock.test.mjs's approach for
// economics): break the atomicity §7 requires, and show the harness
// actually catches the resulting double-spend, rather than only
// trusting the paper's own warning in prose.
//
// §7, verbatim: "a proof that can be verified twice but consumed twice
// is not a conservation mechanism, it is a double-spend waiting for the
// right crash window." This file constructs that exact crash window.
//
// This broken variant is NOT exported from
// public/js/core/conservation/ and must never be. It exists only here,
// to be run against and shown to fail.

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
  identityDerivation,
} from '../public/js/core/conservation/conservation.js';

const derivations = { identity: identityDerivation };

/**
 * Deliberately broken: splits the real consume()'s single atomic
 * check-then-insert into two separate steps, `brokenCheck` and
 * `brokenCommit`, exactly as a real implementation would if it read a
 * persisted consumption record, then — separately, not atomically —
 * wrote to it. This is what "verified twice but consumed twice" looks
 * like mechanically: two concurrent callers (or one caller retried
 * after a crash between check and commit) can both pass the check
 * before either has committed.
 */
function brokenCheck(state, proof) {
  return Boolean(state.consumed[proof.id]); // true = already consumed
}
function brokenCommit(state, proof) {
  return { ...state, consumed: { ...state.consumed, [proof.id]: true } };
}

test('control: the real atomic consume() rejects a second attempt, so only one activation ever happens', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);
  assert.equal(verify(state, proof, derivations).valid, true);

  // "Caller 1" consumes and activates successfully.
  state = consume(state, proof);
  state = activate(state, proof);
  const destClaimId = `activated:${proof.id}`;
  assert.equal(state.claims[destClaimId].amount, 10);

  // "Caller 2" retries the same proof (e.g. after a crash it believes
  // didn't complete). The real consume() rejects it outright.
  assert.throws(() => consume(state, proof), /already consumed/);

  // Only one destination claim exists — no double-mint.
  const activatedClaims = Object.keys(state.claims).filter((id) => id.startsWith('activated:'));
  assert.equal(activatedClaims.length, 1);
});

test('counterexample: a non-atomic check-then-commit lets the same proof be consumed and activated twice — the double-spend §7 warns about', () => {
  let state = initialConservationState();
  state = issueClaim(state, { id: 'c1', kind: 'X', amount: 10, owner: 'alice' });
  state = deactivate(state, 'c1');
  const proof = proveTransfer(state, { claimId: 'c1', from: 'alice', to: 'bob', n: 'n1', derivation: 'identity' }, derivations);
  assert.equal(verify(state, proof, derivations).valid, true);

  // Simulates two concurrent callers (or a crash-and-retry) racing on
  // the SAME state snapshot: both check before either commits.
  const caller1SeesConsumed = brokenCheck(state, proof); // false
  const caller2SeesConsumed = brokenCheck(state, proof); // also false — the race window

  assert.equal(caller1SeesConsumed, false);
  assert.equal(caller2SeesConsumed, false, 'both callers pass the check — this is the crash window §7 describes');

  // Both proceed to commit and activate, each minting its own
  // destination claim from the SAME proof — the double-spend.
  let stateAfterCaller1 = brokenCommit(state, proof);
  stateAfterCaller1 = activate(stateAfterCaller1, proof);

  // Caller 2 activates against ITS OWN branch of state (e.g. a separate
  // process/replica that hasn't seen caller 1's write yet — exactly what
  // "not crash-safe" means for a non-durably-atomic guard).
  let stateAfterCaller2 = brokenCommit(state, proof);
  stateAfterCaller2 = activate(stateAfterCaller2, proof);

  // Both branches independently believe they legitimately activated the
  // proof — each holds a valid-looking destination claim for the full
  // amount. In a real system where these two branches reconcile (e.g.
  // both write to the same eventually-merged store), this is two claims
  // minted from one proof: a real double-spend, not a hypothetical one.
  const destClaimId = `activated:${proof.id}`;
  assert.ok(stateAfterCaller1.claims[destClaimId], 'expected the counterexample to actually reproduce a double-activation — if this fails, the counterexample itself is broken');
  assert.ok(stateAfterCaller2.claims[destClaimId]);
  assert.equal(stateAfterCaller1.claims[destClaimId].amount, 10);
  assert.equal(stateAfterCaller2.claims[destClaimId].amount, 10);
  // Total value now claimed across both branches: 20, from a single
  // proof authorizing 10 — this is exactly what count(Consume(p)) <= 1
  // exists to prevent.
});
