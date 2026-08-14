// reward.js — the accrual reward function, per §10:
//
//   r(b, q) = K · b^α · q^β
//
// where b is committed resource for the event, K/α/β are
// deployment-chosen constants, and q is elapsed economic age in cadence
// epochs (Definition 10.1), NOT wall-clock time — q comes from the
// cadence reducer (cadence.js), never from Date.now() or any local
// clock. This file only computes the reward number itself; it has no
// opinion about scarcity (§13, not enforced here) or about whether an
// event is even valid (that's the DAG's and the cadence reducer's job).

/**
 * @typedef {{ K: number, alpha: number, beta: number }} RewardParams
 */

/**
 * Pure reward function r(b, q) = K · b^α · q^β.
 *
 * b and q must be finite and >= 0 — b is a committed resource amount, q
 * is an elapsed epoch count (Definition 10.1); neither can be negative
 * by construction. q = 0 (reward claimed at the same epoch it was
 * accepted) yields 0 whenever β > 0, which is intentional: the whole
 * point of cadence-derived economic time is that reward accrues *with*
 * elapsed protocol time, not instantaneously.
 *
 * @param {number} b
 * @param {number} q
 * @param {RewardParams} params
 * @returns {number}
 */
export function reward(b, q, { K, alpha, beta }) {
  if (!Number.isFinite(b) || b < 0) {
    throw new RangeError(`b must be a finite number >= 0, got ${b}`);
  }
  if (!Number.isFinite(q) || q < 0) {
    throw new RangeError(`q must be a finite number >= 0, got ${q}`);
  }
  if (!Number.isFinite(K) || !Number.isFinite(alpha) || !Number.isFinite(beta)) {
    throw new RangeError('K, alpha, and beta must all be finite numbers');
  }

  // 0^0 = 1 by convention here (no committed resource / no elapsed time
  // still yields the base multiplier K rather than an undefined result),
  // matching Math.pow / f64::powf's own 0^0 = 1 convention in both
  // languages, so JS and Rust agree without a special case.
  return K * b ** alpha * q ** beta;
}

/**
 * Derives q (elapsed economic epochs, Definition 10.1) for an accrual
 * event from the domain's current cadence state and the event's
 * acceptance epoch q_0. Returns 0 (never negative) if q_0 is in the
 * future relative to the domain's current epoch or the domain has no
 * recorded cadence yet — an event cannot have negative economic age.
 *
 * @param {import('./cadence.js').CadenceState} cadenceState
 * @param {string} domain
 * @param {number} q0
 * @returns {number}
 */
export function elapsedEpochs(cadenceState, domain, q0) {
  const currentEpoch = cadenceState.domains[domain]?.epoch ?? 0;
  return Math.max(0, currentEpoch - q0);
}
