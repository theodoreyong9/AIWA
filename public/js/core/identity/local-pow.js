// local-pow.js — §24.6(ii): local proof-of-work as an identity-cost
// mechanism that requires NO network access at all, unlike the SOL
// burn (§24.6(v), identity-cost.js). This closes a real gap the user
// pointed out directly: a domain that has never had connectivity to
// Solana's network (a native off-Earth domain, never once connected)
// has no path at all to registerIdentityCost() — burning requires
// reaching a live RPC endpoint, which is exactly what "arbitrarily
// long partition" (§1) means may never happen. Local PoW has no such
// dependency: the cost is CPU time spent alone, on hardware the domain
// already has, provably real without any external verifier.
//
// The tradeoff this doesn't hide (§24.6.ii's own caveat, echoed here
// rather than glossed over): PoW difficulty is calibrated against LOCAL
// hardware, not a market-revealed price the way a real burn is — two
// domains with very different available compute get very different
// real costs for "the same" difficulty setting. This is a genuine,
// named limitation, not a flaw unique to this implementation.

/**
 * @typedef {{ domain: string, nonce: number, hash: string, difficultyBits: number, minedAt: number }} PowProof
 * @typedef {{ registered: Record<string, PowProof> }} LocalPowState
 */

export function initialLocalPowState() {
  return { registered: {} };
}

function countLeadingZeroBits(hexHash) {
  let bits = 0;
  for (const ch of hexHash) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) { bits += 4; continue; }
    // Count leading zero bits within this non-zero nibble.
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mines a nonce such that SHA-256(domain || nonce) has at least
 * `difficultyBits` leading zero bits. Pure CPU work, zero network
 * calls — this function's cost IS the identity cost, not a proxy for
 * one. Runs on the calling thread; a real deployment should run this
 * in a Worker so it doesn't block the UI, noted rather than done here
 * (out of scope for this pass — see README).
 *
 * @param {string} domain
 * @param {number} difficultyBits
 * @param {{ maxAttempts?: number }} [opts]
 * @returns {Promise<PowProof>}
 */
export async function minePowProof(domain, difficultyBits, { maxAttempts = 50_000_000 } = {}) {
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const hash = await sha256Hex(`${domain}:${nonce}`);
    if (countLeadingZeroBits(hash) >= difficultyBits) {
      return { domain, nonce, hash, difficultyBits, minedAt: Date.now() };
    }
  }
  throw new Error(`No valid nonce found within ${maxAttempts} attempts at difficulty ${difficultyBits}`);
}

/**
 * Re-derives the hash from (domain, nonce) and confirms it both
 * matches the claimed hash AND clears the claimed difficulty — the
 * same "recompute, don't trust" discipline as verifyModuleIntegrity()
 * (module-hash.js) and verifyBurnProof() (identity-cost.js).
 *
 * @param {PowProof} proof
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function verifyPowProof(proof) {
  const recomputed = await sha256Hex(`${proof.domain}:${proof.nonce}`);
  if (recomputed !== proof.hash) {
    return { valid: false, reason: 'claimed hash does not match SHA-256(domain:nonce) — not a real proof' };
  }
  if (countLeadingZeroBits(recomputed) < proof.difficultyBits) {
    return { valid: false, reason: `hash has fewer than ${proof.difficultyBits} leading zero bits — insufficient work` };
  }
  return { valid: true };
}

/**
 * Registers a domain's identity cost from a verified local proof — the
 * same one-registration-per-domain guard as registerIdentityCost()
 * (identity-cost.js), so a domain can pick whichever mechanism it has
 * access to (network-connected: burn SOL; isolated: mine locally) and
 * both land in an equivalent "this domain has paid c_id" state from the
 * rest of the system's point of view.
 *
 * @param {LocalPowState} state
 * @param {PowProof} proof
 * @returns {Promise<{ state: LocalPowState, accepted: boolean, reason?: string }>}
 */
export async function registerLocalPow(state, proof) {
  if (state.registered[proof.domain]) {
    return { state, accepted: false, reason: `domain '${proof.domain}' already has a registered identity cost` };
  }
  const check = await verifyPowProof(proof);
  if (!check.valid) {
    return { state, accepted: false, reason: check.reason };
  }
  return { state: { registered: { ...state.registered, [proof.domain]: proof } }, accepted: true };
}

export function hasLocalPow(state, domain) {
  return Boolean(state.registered[domain]);
}
