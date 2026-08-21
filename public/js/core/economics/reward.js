// reward.js — the accrual reward function, adopting the real Proof-of-
// Will formula the user's own prior work uses (YourMine's mine.js,
// calcClaimable()), not this project's earlier, simpler power-law
// r = K·b^α·q^β. Standard form:
//
//   r(b, q, qTotal, T) = (b · q^α) / [ln(qTotal^(β(1−T)) + C)]^γ
//
// Two adaptations from the original are deliberate, not incidental,
// both because AIWA domains never share a global clock while the
// original — a single Solana program every participant reads slots
// from — assumes one:
//
//   - qTotal ("protocol age" in the original: slots since a single
//     fixed global reference block, identical for every participant)
//     is this DOMAIN'S OWN total cadence epoch count here, not a
//     quantity shared across domains. Requiring every AIWA domain to
//     agree on one global reference epoch would reintroduce the exact
//     cross-domain synchronization dependency this architecture rules
//     out. Using each domain's own age preserves the formula's intent
//     — reward per action shrinks as a domain matures — without any
//     domain needing to know anything about any other domain's clock.
//   - The original enforces a minimum wait of 30 Solana slots
//     (~12 seconds) before any reward is claimable. AIWA's epoch is a
//     coarser, deployment-defined unit, not a fixed ~400ms slot, so the
//     literal number 30 would carry no equivalent meaning here.
//     Replaced with `minQ`, a deployment-chosen minimum epoch count,
//     defaulting to 1 (some non-zero cadence time must actually pass).
//
// b, q, and qTotal must be finite and >= 0 by construction; q = 0 still
// yields 0 whenever alpha > 0 for b > 0, the same "no instant reward"
// property the original power-law form had — cadence-derived economic
// time still governs, only the shape of the curve changed.

export class RewardError extends Error {}

/**
 * @typedef {{ alpha: number, beta: number, gamma: number, C: number, minQ: number }} RewardParams
 */

/**
 * Pure reward function, standard form above.
 *
 * @param {number} b - committed capital backing this claim (the original's S)
 * @param {number} q - epochs elapsed since this claim's q0 (Definition 10.1; the original's t)
 * @param {number} qTotal - this domain's own total cadence epoch count (the original's A, made domain-local — see file header)
 * @param {number} patienceRate - T, caller-chosen, clamped to [0, 0.4] exactly as the original does (Math.min(taxRate,40)/100)
 * @param {RewardParams} params
 * @returns {number}
 */
export function reward(b, q, qTotal, patienceRate, { alpha, beta, gamma, C, minQ }) {
  if (!Number.isFinite(b) || b < 0) throw new RewardError(`b must be a finite number >= 0, got ${b}`);
  if (!Number.isFinite(q) || q < 0) throw new RewardError(`q must be a finite number >= 0, got ${q}`);
  if (!Number.isFinite(qTotal) || qTotal < 0) throw new RewardError(`qTotal must be a finite number >= 0, got ${qTotal}`);
  if (![alpha, beta, gamma, C, minQ].every(Number.isFinite)) {
    throw new RewardError('alpha, beta, gamma, C, and minQ must all be finite numbers');
  }

  if (q < minQ) return 0;

  const T = Math.min(Math.max(patienceRate, 0), 0.4);
  const effQ = Math.max(1, q);
  const effQTotal = Math.max(1, qTotal);

  const numerator = effQ ** alpha * b;
  const inner = effQTotal ** (beta * (1 - T)) + C;
  if (inner <= 1) return 0;

  const denominator = Math.log(inner) ** gamma;
  if (!(denominator > 0) || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return 0;

  const r = numerator / denominator;
  if (r < 0 || !Number.isFinite(r) || r > 1e12) return 0;
  return r;
}

/**
 * Derives q (elapsed economic epochs, Definition 10.1) for an accrual
 * event from the domain's current cadence state and the event's
 * acceptance epoch q_0. Unchanged from the prior revision.
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

/**
 * qTotal — this domain's own total cadence epoch count right now, as
 * folded so far. See file header: this stands in for the original's
 * global "protocol age," deliberately made domain-local.
 *
 * @param {import('./cadence.js').CadenceState} cadenceState
 * @param {string} domain
 * @returns {number}
 */
export function domainAge(cadenceState, domain) {
  return cadenceState.domains[domain]?.epoch ?? 0;
}
