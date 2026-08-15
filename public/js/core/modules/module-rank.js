// module-rank.js — the two calculations the user pointed out were
// missing, kept deliberately separate because they answer different
// questions:
//
//   1. RANK — where a module sorts in the list. Computed from its
//      author's identity-cost burn (§24) and how many cadence epochs
//      have elapsed since that burn — reusing reward.js's real,
//      already-tested r(b,q) = K·b^α·q^β directly, not a new formula.
//      A larger burn, aged longer, ranks higher — the same "will over
//      time" logic §10 already establishes for accrual, applied here to
//      sorting instead of issuance.
//   2. ELIGIBILITY — whether an author may register a genuinely NEW
//      module id at all. Modeled directly on a real prior
//      implementation's checkScoreEligibility: your ratio must not get
//      worse than your last submission's, and a first-ever submission
//      is always allowed. Unlike identity-cost.js's burn (no minimum,
//      per the user's explicit instruction), this ratio check exists
//      specifically to prevent spamming many low-effort new modules —
//      a distinct concern from "can you afford to enter the system at
//      all," which registerIdentityCost() already settled with zero
//      minimum.
//
// Neither of these gates code UPDATES to an already-registered module
// (module-registry.js's updateModuleCode already has its own guard: it
// only requires the id to exist) — eligibility applies to new
// registrations only, matching the reference implementation's real
// behavior for the same reason: an author improving their own existing
// module should never be throttled by a rank-based gate.

import { reward } from '../economics/reward.js';

/**
 * The module list's sort key. Reuses the real reward function directly
 * — this is not a second formula to keep in sync with §10's, it IS
 * §10's formula, applied to (the author's burned lamports, epochs
 * elapsed since that burn).
 *
 * @param {number} burnedLamports
 * @param {number} epochsElapsed
 * @param {{ K: number, alpha: number, beta: number }} rewardParams
 * @returns {number}
 */
export function computeModuleRank(burnedLamports, epochsElapsed, rewardParams) {
  return reward(burnedLamports, epochsElapsed, rewardParams);
}

/**
 * @typedef {{ rank: number, epochsElapsed: number }} LastSubmission
 */

/**
 * Whether a NEW module registration (not an update) may proceed, given
 * the author's rank/elapsed-epochs at this attempt versus their last
 * submission. Mirrors the real reference implementation's ratio test
 * exactly: (score+1)/(laps+1) must not decrease. Using epochsElapsed as
 * both this project's q (§10) and the reference's "laps" is a
 * deliberate simplification, not an approximation of two different
 * things — both concepts exist to measure elapsed protocol time since
 * the last relevant action, and this project already has exactly one
 * such measure (cadence epochs).
 *
 * @param {number} newRank
 * @param {number} newEpochsElapsed
 * @param {LastSubmission | null} lastSubmission — null if this author
 *   has never registered a module before; a first submission is always
 *   eligible.
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function checkSubmissionEligibility(newRank, newEpochsElapsed, lastSubmission) {
  if (!lastSubmission) {
    return { eligible: true };
  }
  const lastRatio = (lastSubmission.rank + 1) / (lastSubmission.epochsElapsed + 1);
  const newRatio = (newRank + 1) / (newEpochsElapsed + 1);
  if (newRatio < lastRatio) {
    return {
      eligible: false,
      reason: `ratio ${newRatio.toFixed(6)} is lower than your last submission's ${lastRatio.toFixed(6)} — score must not decline to register a new module id`,
    };
  }
  return { eligible: true };
}

/**
 * Convenience wrapper tying computeModuleRank() to the two pieces of
 * state a domain already has: its identity-cost burn (identity-cost.js)
 * and its current cadence epoch (cadence.js). Returns 0 for a domain
 * with no registered identity cost — it cannot rank at all until it
 * has paid c_id, matching §24.6(v)'s "identity admitted only after a
 * verified burn" requirement.
 *
 * Documented simplification, not a silent approximation: this uses the
 * domain's CURRENT cadence epoch as the elapsed-time input, treating the
 * burn as having occurred at epoch 0. Tracking the domain's actual
 * cadence epoch at the moment of the burn (a more precise q) would
 * require extending IdentityCostState's data model — out of scope for
 * this pass, recorded rather than silently assumed equivalent.
 *
 * @param {import('../identity/identity-cost.js').IdentityCostState} identityCostState
 * @param {import('./cadence-shape').CadenceState} cadenceState — the `cadence` sub-state of a materializeG() result
 * @param {string} domain
 * @param {{ K: number, alpha: number, beta: number }} rewardParams
 * @returns {number}
 */
export function rankFromIdentityAndCadence(identityCostState, cadenceState, domain, rewardParams) {
  const identity = identityCostState.registered[domain];
  if (!identity) return 0;
  const currentEpoch = cadenceState.domains[domain]?.epoch ?? 0;
  return computeModuleRank(identity.burnedLamports, currentEpoch, rewardParams);
}
