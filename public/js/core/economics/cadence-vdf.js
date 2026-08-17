// cadence-vdf.js — closes the specific gap R11 names (§17's matrix,
// §16.1's own "two distinct roles that must not be conflated"): a
// mandatory heartbeat makes silence observable, but says nothing about
// the RATE at which an active, apparently-honest domain can advance
// its own cadence. Nothing before this stopped a domain from
// constructing a thousand valid, correctly-chained cadence transitions
// in a tight loop within milliseconds of real time — every one of them
// would satisfy cadence.js's existing structural checks (epoch+1,
// causal chaining) perfectly.
//
// The mechanism: a sequential hash chain, h_0 = SHA-256(seed),
// h_i = SHA-256(h_{i-1}), computed for a deployment-configured number
// of iterations. Each step depends on the output of the one before it
// — there is no way to compute step 1000 without having already
// computed steps 1 through 999, in order, regardless of how much
// parallel hardware is thrown at the problem. Producing the chain
// therefore costs real, physically-irreducible sequential time on
// whatever hardware actually computes it; verifying it means
// recomputing the identical chain and comparing the final output.
//
// Honest, stated limitations, not hidden:
//   - This is NOT an asymmetric VDF in the strict cryptographic sense
//     (Wesolowski's or Pietrzak's construction, built on groups of
//     unknown order) — verification here costs exactly what
//     computation costs, not asymptotically less. Building a real
//     asymmetric VDF is a substantial, separate cryptographic
//     undertaking (real academic papers, real implementations with
//     their own audits) this project does not attempt. What this DOES
//     provide — the property actually needed here — is that
//     PRODUCTION cannot be parallelized or shortcut, which is the
//     whole point: an attacker cannot fabricate epochs faster than
//     real sequential hashing allows, even with unlimited hardware.
//   - Difficulty (iterations) is calibrated against whatever hardware
//     computes the chain, not a market-revealed price — the same
//     honest caveat this project already stated for local proof-of-
//     work before that specific mechanism was retracted for an
//     unrelated reason (§24.6(ii)'s retraction note: burns are never
//     truly network-blocked, only slow to confirm). That retraction
//     does not apply here: cadence, unlike identity registration, must
//     keep advancing DURING a partition itself, so "wait for
//     reconnection" is not an available alternative for this
//     mechanism the way it was for identity cost.
//   - Does not, by itself, address many domains (many identities) each
//     independently advancing their own cadence in parallel across
//     separate real hardware — that is a Sybil-shaped concern (§24),
//     orthogonal to the one this file addresses: one domain's own
//     single timeline cannot be fast-forwarded.

import { sha256 } from '@noble/hashes/sha2.js';

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromUtf8(str) {
  return new TextEncoder().encode(str);
}

/**
 * The seed binds the chain to exactly one domain and exactly one
 * position in that domain's own cadence history — the previous epoch's
 * own chain output (or a fixed genesis marker for epoch 1). Chaining
 * across epochs this way, not just within one epoch's own chain, means
 * epoch N's chain cannot even begin until epoch N-1's chain has
 * genuinely finished, closing the gap a per-epoch-only chain would
 * leave (parallelizing DIFFERENT epochs' chains against each other,
 * even if each one individually were non-parallelizable internally).
 *
 * @param {string} domain
 * @param {string} previousOutput — the prior epoch's own vdfOutput, or 'genesis' for epoch 1
 */
export function vdfSeed(domain, previousOutput) {
  return `${domain}:${previousOutput}`;
}

/**
 * Computes the chain. Synchronous and CPU-bound on purpose: this is
 * the actual, real cost — there is nothing to "await" here, the delay
 * IS the computation, not I/O.
 *
 * @param {string} seed
 * @param {number} iterations
 * @returns {string} hex-encoded final hash
 */
export function computeVdfChain(seed, iterations) {
  let h = sha256(fromUtf8(seed));
  for (let i = 1; i < iterations; i++) {
    h = sha256(h);
  }
  return toHex(h);
}

/**
 * Verifies a claimed chain by recomputing it — the same recompute-
 * don't-trust discipline this project applies to event ids, module
 * hashes, and formula parity, applied here to elapsed real time
 * instead. Costs exactly what producing the chain cost; see this
 * file's own header for why that is an honest, stated tradeoff, not
 * an oversight.
 *
 * @param {string} seed
 * @param {number} iterations
 * @param {string} claimedOutput
 * @returns {boolean}
 */
export function verifyVdfChain(seed, iterations, claimedOutput) {
  if (typeof claimedOutput !== 'string' || !/^[0-9a-f]{64}$/.test(claimedOutput)) return false;
  return computeVdfChain(seed, iterations) === claimedOutput;
}
