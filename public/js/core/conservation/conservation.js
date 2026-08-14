// conservation.js — Conservation, per §6.1 and §7: proof-carrying
// transfer/transmutation of an EXISTING claim, structurally distinct
// from accrual (economics/, which creates new value from nothing
// consumed — see §6.2). Protocol:
//
//   Deactivate → Prove → Verify → Consume → Activate
//
// A transfer moves ownership of a claim without changing its kind
// (x_A → x_B). A transmutation converts it to a different kind via an
// authorized derivation function f (x_A → y_B) — this is the "burn one
// asset to produce another" mechanism. Both go through the exact same
// pipeline; a transfer is simply a transmutation whose derivation
// function is the identity function.
//
// The load-bearing invariant, stated in §7 and reproduced exactly here:
//
//   count(Consume(p)) ≤ 1
//
// enforced by consume() below via a persisted, atomically-checked
// consumed-proof set — the same idempotent-set technique the ledger
// itself uses for event deduplication (§8), applied here to proofs
// instead of events.

/**
 * @typedef {{ id: string, kind: string, amount: number, owner: string, status: 'active'|'deactivated'|'consumed' }} Claim
 * @typedef {{ id: string, claimId: string, from: string, to: string, derivation: string, kindOut: string, amountOut: number }} Proof
 * @typedef {{ claims: Record<string, Claim>, consumed: Record<string, true> }} ConservationState
 * @typedef {(kind: string, amount: number) => { kind: string, amount: number } | null} DerivationFn
 */

export function initialConservationState() {
  return { claims: {}, consumed: {} };
}

/**
 * Not part of the Deactivate→Prove→Verify→Consume→Activate pipeline
 * itself — this is how a claim comes to exist in the first place (e.g.
 * from an accrual event's issued amount, once economics/ and
 * conservation/ are wired together; not done in this module). Rejects a
 * duplicate id rather than silently overwriting an existing claim.
 */
export function issueClaim(state, { id, kind, amount, owner }) {
  if (state.claims[id]) {
    throw new Error(`Claim id already exists: ${id}`);
  }
  return { ...state, claims: { ...state.claims, [id]: { id, kind, amount, owner, status: 'active' } } };
}

/**
 * Step 1: Deactivate. Precondition: the claim is 'active'. This is what
 * makes the claim unavailable for a second, concurrent transfer attempt
 * while this one is in flight — the source of the "single-use" property,
 * upstream of consume()'s replay guard rather than a substitute for it.
 */
export function deactivate(state, claimId) {
  const claim = state.claims[claimId];
  if (!claim) throw new Error(`Unknown claim: ${claimId}`);
  if (claim.status !== 'active') {
    throw new Error(`Cannot deactivate claim ${claimId}: status is '${claim.status}', not 'active'`);
  }
  return { ...state, claims: { ...state.claims, [claimId]: { ...claim, status: 'deactivated' } } };
}

/**
 * A deterministic, unique-by-construction proof id. Unlike the ledger's
 * event ids (§8.1), this does not need to be a cryptographic hash of
 * content to prevent forgery — Proof(x, A, B, n, θ, f)'s own n is
 * already specified as a unique identifier by the protocol; the id here
 * is literally that tuple, not an independently-derived commitment.
 */
function computeProofId({ claimId, from, to, n, derivation }) {
  return `${claimId}:${from}:${to}:${n}:${derivation}`;
}

/**
 * Step 2: Prove. Pure computation, no state mutation — proving does not
 * by itself change anything; it produces evidence to be checked and
 * later consumed. Precondition (checked, not silently assumed): the
 * claim must already be deactivated, matching the protocol's stated
 * order.
 *
 * @param {ConservationState} state
 * @param {{ claimId: string, from: string, to: string, n: string, derivation: string }} params
 * @param {Record<string, DerivationFn>} derivations authorized derivation functions, keyed by name
 * @returns {Proof}
 */
export function proveTransfer(state, { claimId, from, to, n, derivation }, derivations) {
  const claim = state.claims[claimId];
  if (!claim) throw new Error(`Unknown claim: ${claimId}`);
  if (claim.status !== 'deactivated') {
    throw new Error(`Cannot prove a transfer for claim ${claimId}: status is '${claim.status}', not 'deactivated'`);
  }
  if (claim.owner !== from) {
    throw new Error(`Claim ${claimId} is not owned by ${from}`);
  }
  const f = derivations[derivation];
  if (!f) {
    throw new Error(`Unauthorized derivation function: '${derivation}'`);
  }
  const output = f(claim.kind, claim.amount);
  if (!output) {
    throw new Error(`Derivation '${derivation}' rejected input (kind=${claim.kind}, amount=${claim.amount})`);
  }
  return {
    id: computeProofId({ claimId, from, to, n, derivation }),
    claimId,
    from,
    to,
    derivation,
    kindOut: output.kind,
    amountOut: output.amount,
  };
}

/**
 * Step 3: Verify. Pure, side-effect-free, and safe to call more than
 * once — §7 explicitly distinguishes "verified twice" (fine) from
 * "consumed twice" (a double-spend). Re-derives the expected output
 * from the claim and the same authorized derivation function, so a
 * proof claiming an output the function would not actually produce is
 * rejected rather than trusted at face value.
 *
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verify(state, proof, derivations) {
  const claim = state.claims[proof.claimId];
  if (!claim) return { valid: false, reason: `Unknown claim: ${proof.claimId}` };
  if (claim.status !== 'deactivated') {
    return { valid: false, reason: `Claim ${proof.claimId} is not deactivated (status: '${claim.status}')` };
  }
  if (claim.owner !== proof.from) {
    return { valid: false, reason: `Claim ${proof.claimId} is not owned by ${proof.from}` };
  }
  if (state.consumed[proof.id]) {
    return { valid: false, reason: `Proof ${proof.id} already consumed` };
  }
  const f = derivations[proof.derivation];
  if (!f) return { valid: false, reason: `Unauthorized derivation function: '${proof.derivation}'` };
  const expected = f(claim.kind, claim.amount);
  if (!expected || expected.kind !== proof.kindOut || expected.amount !== proof.amountOut) {
    return { valid: false, reason: 'Proof output does not match what the derivation function produces' };
  }
  return { valid: true };
}

/**
 * Step 4: Consume. THE load-bearing invariant of §7:
 * count(Consume(p)) ≤ 1. Direct port of the whitepaper's reference
 * pseudocode (the "Wallet consumption guard (§7)" block in Appendix B —
 * note: §7's body text cites this as "Appendix B.7", but the formally
 * numbered B.7 is actually "Merge identifier (replay guard)", a related
 * but distinct mechanism for H_E ∪ H_M merge replay protection, not
 * this one; the wallet consumption guard pseudocode has no numbered
 * sub-letter of its own in the source document — see README.md's
 * Conservation section for this citation note).
 *
 * Check-then-insert as a single synchronous operation on an in-memory
 * object is atomic *within this process* by construction (JS has no
 * pre-emption between these two lines); crash-safety across process
 * restarts requires this to be backed by a durable, atomically-written
 * store in a real deployment, which this reference implementation does
 * not provide — see the crash-safety counterexample (Phase 4) for what
 * happens when that atomicity is violated.
 */
export function consume(state, proof) {
  if (state.consumed[proof.id]) {
    throw new Error(`Replay rejected: proof ${proof.id} already consumed`);
  }
  return { ...state, consumed: { ...state.consumed, [proof.id]: true } };
}

/**
 * Step 5: Activate. Precondition: the proof must already be consumed —
 * enforces the protocol's stated order (activation is not a substitute
 * for the consume-guard, it comes strictly after it). Finalizes the
 * source claim's status to 'consumed' (from 'deactivated') and creates
 * the destination claim, of kind/amount exactly as the proof states
 * (already checked against the derivation function during verify()).
 *
 * The destination claim's id is derived from the proof's id, not
 * independently chosen — this ties an activation deterministically to
 * the specific proof that authorized it, and means calling activate()
 * twice for the same proof (which should be impossible if consume()'s
 * guard was respected) would collide on claim id rather than silently
 * mint a second claim.
 */
export function activate(state, proof) {
  if (!state.consumed[proof.id]) {
    throw new Error(`Cannot activate: proof ${proof.id} has not been consumed yet`);
  }
  const sourceClaim = state.claims[proof.claimId];
  if (!sourceClaim) throw new Error(`Unknown claim: ${proof.claimId}`);

  const destClaimId = `activated:${proof.id}`;
  if (state.claims[destClaimId]) {
    throw new Error(`Activation already applied for proof ${proof.id}`);
  }

  return {
    ...state,
    claims: {
      ...state.claims,
      [proof.claimId]: { ...sourceClaim, status: 'consumed' },
      [destClaimId]: { id: destClaimId, kind: proof.kindOut, amount: proof.amountOut, owner: proof.to, status: 'active' },
    },
  };
}

/**
 * Convenience orchestrator running all five steps in order — the "happy
 * path". Each step remains individually exported and callable on its
 * own, since the crash-safety and replay counterexamples (Phase 4) need
 * to interleave and repeat individual steps, not just call this.
 *
 * @returns {{ state: ConservationState, proof: Proof }}
 */
export function transfer(state, { claimId, from, to, n, derivation }, derivations) {
  let s = deactivate(state, claimId);
  const proof = proveTransfer(s, { claimId, from, to, n, derivation }, derivations);
  const check = verify(s, proof, derivations);
  if (!check.valid) throw new Error(`Verification failed: ${check.reason}`);
  s = consume(s, proof);
  s = activate(s, proof);
  return { state: s, proof };
}

/** The identity derivation: a plain transfer, kind and amount unchanged. */
export const identityDerivation = (kind, amount) => ({ kind, amount });
