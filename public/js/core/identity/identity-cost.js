// identity-cost.js — a concrete c_id mechanism (§24.6.ii-adjacent: a
// sunk, unrecoverable cost, paid once before partition), backing the
// "committed resource" question directly: one identity is admitted
// only once it presents proof of an irrecoverable SOL burn on Solana
// mainnet, sent to the network's well-known incinerator address.
//
// Why burn, not bond/stake (§24.6.i vs §24.6.ii, discussed at length
// with the user before writing this file): a bonded deposit's
// protection depends on slashing being *enforced* after misbehavior is
// detected — under an arbitrarily long partition, that enforcement may
// never propagate in time, and the paper says so explicitly: "the
// usable floor during a partition of length T shrinks as T grows,
// exactly the opposite of what a designer might hope." A burn has no
// such dependency: the cost is sunk the moment it's paid, with nothing
// left to enforce later. That is a better fit for a protocol whose
// entire premise is that "later" may never come during the period that
// matters.
//
// This file contains ONLY the pure, testable verification and
// registration logic — it operates on an already-fetched, normalized
// transaction record, not on a live RPC call. The actual network call
// to Solana (untestable in this environment — see solana-rpc.js) is a
// separate, thin adapter that produces this normalized shape.

export const SOLANA_INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

/**
 * @typedef {{
 *   signature: string,
 *   err: object | null,
 *   incineratorBalanceDeltaLamports: number,
 *   commitment: 'processed' | 'confirmed' | 'finalized',
 * }} NormalizedBurnTx
 *
 * @typedef {{
 *   registered: Record<string, { domain: string, signature: string, burnedLamports: number, registeredAt: number }>,
 *   usedSignatures: Record<string, true>,
 * }} IdentityCostState
 */

export function initialIdentityCostState() {
  return { registered: {}, usedSignatures: {} };
}

/**
 * Pure check against a normalized transaction record. Does not touch
 * the network. Requires `commitment === 'finalized'` explicitly, rather
 * than inferring finality from other fields — finality is a property of
 * *which RPC call was made* (what commitment level was requested), not
 * something derivable after the fact from the response shape, so the
 * caller (solana-rpc.js) must set it, and this function trusts that
 * boundary rather than re-deriving it.
 *
 * @param {NormalizedBurnTx} tx
 * @param {{ minLamports: number }} params
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyBurnProof(tx, { minLamports }) {
  if (tx.err !== null) {
    return { valid: false, reason: 'transaction failed on-chain (err is non-null)' };
  }
  if (tx.commitment !== 'finalized') {
    return { valid: false, reason: `commitment is '${tx.commitment}', not 'finalized' — not yet irreversible` };
  }
  if (!Number.isFinite(tx.incineratorBalanceDeltaLamports) || tx.incineratorBalanceDeltaLamports < minLamports) {
    return {
      valid: false,
      reason: `incinerator balance increased by ${tx.incineratorBalanceDeltaLamports} lamports, need >= ${minLamports}`,
    };
  }
  return { valid: true };
}

/**
 * Registers a domain's identity cost from a verified burn. Enforces
 * that the same transaction signature can never back two different
 * identities — the same idempotent-set replay guard used everywhere
 * else in this project (§7's consume(), §10's cadence chain): a proof
 * of payment is consumed exactly once, by construction, not by
 * convention.
 *
 * @param {IdentityCostState} state
 * @param {{ domain: string, tx: NormalizedBurnTx, minLamports: number, now?: number }} params
 * @returns {{ state: IdentityCostState, accepted: boolean, reason?: string }}
 */
export function registerIdentityCost(state, { domain, tx, minLamports, now = Date.now() }) {
  if (state.usedSignatures[tx.signature]) {
    return { state, accepted: false, reason: `signature ${tx.signature} already used to back an identity` };
  }
  if (state.registered[domain]) {
    return { state, accepted: false, reason: `domain '${domain}' already has a registered identity cost` };
  }

  const check = verifyBurnProof(tx, { minLamports });
  if (!check.valid) {
    return { state, accepted: false, reason: check.reason };
  }

  const newState = {
    registered: {
      ...state.registered,
      [domain]: { domain, signature: tx.signature, burnedLamports: tx.incineratorBalanceDeltaLamports, registeredAt: now },
    },
    usedSignatures: { ...state.usedSignatures, [tx.signature]: true },
  };
  return { state: newState, accepted: true };
}

/** @returns {boolean} whether `domain` has a registered, verified identity cost. */
export function hasIdentityCost(state, domain) {
  return Boolean(state.registered[domain]);
}
