// identity-cost.js — a concrete c_id mechanism (a sunk, unrecoverable
// cost, paid once before partition): one identity is admitted only
// once it presents proof of an irrecoverable SOL burn on Solana
// mainnet, sent to the network's well-known incinerator address.
//
// Why burn, not bond/stake: a bonded deposit's protection depends on
// slashing being *enforced* after misbehavior is detected — under an
// arbitrarily long partition, that enforcement may never propagate in
// time, and the usable floor during a partition of length T shrinks as
// T grows, the opposite of what a designer would want. A burn has no
// such dependency: the cost is sunk the moment it's paid, with nothing
// left to enforce later — a better fit for a protocol whose entire
// premise is that "later" may never come during the period that
// matters.
//
// This file contains ONLY the pure, testable verification and
// registration logic — it operates on an already-fetched, normalized
// transaction record, not on a live RPC call. The actual network call
// to Solana (untestable in this environment — see solana-rpc.js) is a
// separate, thin adapter that produces this normalized shape.
//
// Churn resistance: re-deriving the Sybil analysis with the real
// Proof-of-Will formula (not the earlier power-law) found a genuinely
// new attack the old formula never had — periodically abandoning an
// aged domain for a freshly registered one, since reward.js's own
// domain-local age term (a necessary adaptation avoiding a cross-
// domain synchronized clock) resets to near-zero at zero cost beyond
// the ordinary identity burn. Closed here, not in the reward formula:
// the required burn for a NEW registration is now a function of real,
// deployment-wide elapsed time — the real Solana slot the burn landed
// at (already present in every burn-verification RPC response,
// previously read and discarded — see solana-rpc.js), compared
// against a single fixed deployment constant (genesisSlot, agreed once,
// exactly like alpha/beta/gamma/C/minQ already are). This needs no
// live "current time" oracle, ever: the delta is computable purely
// locally once both numbers are known, inheriting the same trust model
// already used for burn verification generally — the domain
// broadcasting a burn has strong assurance (it queried Solana's RPC
// directly); a domain later learning of it via merge() trusts the
// folded claim unless it separately re-verifies the embedded signature
// itself. Optional and deployment-configured, never mandatory-by-
// default: the late-joiner tradeoff (a legitimate newcomer years into
// a mature deployment pays the same escalated cost as a churn attempt
// would) is a real, unresolved policy question a deployment must
// decide, not something this file should prescribe an answer to by
// making the curve unconditional.

export const SOLANA_INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

/**
 * @typedef {{
 *   signature: string,
 *   err: object | null,
 *   incineratorBalanceDeltaLamports: number,
 *   commitment: 'processed' | 'confirmed' | 'finalized',
 *   slot: number | null,
 * }} NormalizedBurnTx
 *
 * @typedef {{
 *   registered: Record<string, { domain: string, signature: string, burnedLamports: number, registeredAt: number, slot: number | null }>,
 *   usedSignatures: Record<string, true>,
 * }} IdentityCostState
 */

export function initialIdentityCostState() {
  return { registered: {}, usedSignatures: {} };
}

/**
 * A deployment-chosen cost curve: real burn lamports required as a
 * function of real slots elapsed since this deployment's own genesis
 * slot. Linear is the simplest honest choice — a deployment may supply
 * any monotonically non-decreasing function of its own instead; this
 * file does not require this specific shape, only exports it as a
 * ready-to-use default.
 *
 * @param {{ baseLamports: number, lamportsPerSlot: number }} params
 * @returns {(slotsSinceGenesis: number) => number}
 */
export function linearCostCurve({ baseLamports, lamportsPerSlot }) {
  return (slotsSinceGenesis) => baseLamports + Math.max(0, slotsSinceGenesis) * lamportsPerSlot;
}

/**
 * The minimum burn required for a registration landing at
 * `registrationSlot`, given this deployment's own fixed `genesisSlot`
 * and chosen `costCurve`. Pure, purely local — no network access, no
 * "current time" needed, only the two already-known numbers. Returns 0
 * (no floor beyond whatever verifyBurnProof's own minLamports already
 * requires) if `registrationSlot` is null/unknown — an unknown slot
 * cannot be penalized for being "recent," since that would make an
 * absent field advantageous, the wrong direction for a security floor.
 *
 * @param {number | null} registrationSlot
 * @param {number} genesisSlot
 * @param {(slotsSinceGenesis: number) => number} costCurve
 * @returns {number}
 */
export function requiredBurnLamports(registrationSlot, genesisSlot, costCurve) {
  if (registrationSlot === null || registrationSlot === undefined || !Number.isFinite(registrationSlot)) return 0;
  const slotsSinceGenesis = Math.max(0, registrationSlot - genesisSlot);
  return costCurve(slotsSinceGenesis);
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
 * @param {{ minLamports?: number }} [params]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyBurnProof(tx, { minLamports = 0 } = {}) {
  if (tx.err !== null) {
    return { valid: false, reason: 'transaction failed on-chain (err is non-null)' };
  }
  if (tx.commitment !== 'finalized') {
    return { valid: false, reason: `commitment is '${tx.commitment}', not 'finalized' — not yet irreversible` };
  }
  // No fixed minimum by design — a burn of any positive size is a real,
  // irrecoverable cost and counts as c_id. The only hard requirement is
  // that something was actually burned (delta > 0), not a specific
  // amount. minLamports is a per-deployment POLICY KNOB a caller may set
  // above zero if they want one — it defaults to 0 (no floor) precisely
  // because this project's stated position is that publishing/registration
  // should stay maximally open, not gated by an arbitrary threshold.
  if (!Number.isFinite(tx.incineratorBalanceDeltaLamports) || tx.incineratorBalanceDeltaLamports <= 0) {
    return { valid: false, reason: 'no positive burn detected (incinerator balance did not increase)' };
  }
  if (tx.incineratorBalanceDeltaLamports < minLamports) {
    return {
      valid: false,
      reason: `incinerator balance increased by ${tx.incineratorBalanceDeltaLamports} lamports, need >= ${minLamports} (deployment-configured floor)`,
    };
  }
  return { valid: true };
}

/**
 * Registers a domain's identity cost from a verified burn. Enforces
 * that the same transaction signature can never back two different
 * identities — the same idempotent-set replay guard used everywhere
 * else in this project (Conservation's own consume(), the cadence
 * chain): a proof of payment is consumed exactly once, by
 * construction, not by convention.
 *
 * @param {IdentityCostState} state
 * @param {{ domain: string, tx: NormalizedBurnTx, minLamports?: number, now?: number, churnConfig?: { genesisSlot: number, costCurve: (slotsSinceGenesis: number) => number } }} params
 * @returns {{ state: IdentityCostState, accepted: boolean, reason?: string }}
 */
export function registerIdentityCost(state, { domain, tx, minLamports = 0, now = Date.now(), churnConfig } = {}) {
  if (state.usedSignatures[tx.signature]) {
    return { state, accepted: false, reason: `signature ${tx.signature} already used to back an identity` };
  }
  if (state.registered[domain]) {
    return { state, accepted: false, reason: `domain '${domain}' already has a registered identity cost` };
  }

  // Churn resistance: the real floor for THIS registration's real slot
  // may exceed the caller-supplied minLamports — take whichever is
  // higher, so a deployment's own policy floor and the churn-resistance
  // curve compose rather than one silently overriding the other.
  let effectiveMinLamports = minLamports;
  if (churnConfig) {
    const required = requiredBurnLamports(tx.slot ?? null, churnConfig.genesisSlot, churnConfig.costCurve);
    effectiveMinLamports = Math.max(minLamports, required);
  }

  const check = verifyBurnProof(tx, { minLamports: effectiveMinLamports });
  if (!check.valid) {
    return { state, accepted: false, reason: check.reason };
  }

  const newState = {
    registered: {
      ...state.registered,
      [domain]: { domain, signature: tx.signature, burnedLamports: tx.incineratorBalanceDeltaLamports, registeredAt: now, slot: tx.slot ?? null },
    },
    usedSignatures: { ...state.usedSignatures, [tx.signature]: true },
  };
  return { state: newState, accepted: true };
}

/** @returns {boolean} whether `domain` has a registered, verified identity cost. */
export function hasIdentityCost(state, domain) {
  return Boolean(state.registered[domain]);
}
