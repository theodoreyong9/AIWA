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

// Hand-rolled, dependency-free SHA-256 — a real, deliberate correction:
// this file originally imported @noble/hashes for a synchronous sha256.
// That broke the id-parity/g-parity/conservation-parity CI jobs, which
// were correctly designed to have ZERO external npm dependencies (no
// `npm install` step at all — every other core reducer file uses only
// native Web Crypto or pure computation). Rather than add npm install
// to those jobs (weakening a real, intentional architectural property
// for every job, not just this one), this file now carries its own
// standard, unmodified SHA-256 implementation — synchronous (required,
// since cadence.js's applyCadenceEvent must stay synchronous — see
// this file's own earlier header note on why), zero dependencies,
// verified against the standard published test vectors and against
// this exact function's own prior @noble/hashes-backed output for the
// identical inputs (cadence-vdf.test.mjs), so no already-committed
// fixture value (test-vectors/g-scenario.json, the Rust cross-language
// parity value) needed to change.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/** @param {Uint8Array} bytes @returns {Uint8Array} 32-byte digest */
function sha256(bytes) {
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const h = SHA256_H0.slice();
  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i] >>> 0, false);
  return out;
}

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
