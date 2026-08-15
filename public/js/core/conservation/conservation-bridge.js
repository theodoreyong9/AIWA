// conservation-bridge.js — closes the "Wire Conservation to economics"
// gap flagged since this project's economics phases were first built:
// the question "how do I send AIWA to someone else?" had no answer
// until now, because conservation.js's real, tested transfer pipeline
// (§6.1/§7) was never folded over H_d the way cadence/accrual/module
// events already are.
//
// Two DAG event types, both folded here, matching the pattern already
// established by cadence.js and module-registry-reducer.js:
//
//   'claim-issue' — {domain, id, kind, amount}. Bridges G's fungible
//   balance to a spendable, uniquely-identified claim: g.js's own
//   'claim-issue' handling debits the balance; this reducer's handling
//   of the SAME event creates the actual Claim record
//   (conservation.js's issueClaim()). Both reducers watch the same
//   event stream independently — this is the same "two materialized
//   views over one H_d" pattern as everywhere else in this project, not
//   a new coordination mechanism.
//
//   'transfer' — {claimId, from, to}. Runs conservation.js's real
//   Deactivate→Prove→Verify→Consume→Activate pipeline via its
//   transfer() convenience function, with the identity derivation (a
//   plain transfer, not a transmutation — see conservation.js's
//   header). A transfer that fails verification (e.g. the claim isn't
//   owned by `from`, or has already been consumed) is rejected during
//   the fold, not thrown — same tolerant-fold discipline as every other
//   reducer in this project.

import { initialConservationState, issueClaim, transfer, identityDerivation } from './conservation.js';

export function applyConservationEvent(state, event) {
  const payload = event.payload;
  if (!payload || typeof payload.type !== 'string') return state;

  if (payload.type === 'claim-issue') {
    const { domain, id, kind, amount } = payload;
    if (typeof domain !== 'string' || !domain || typeof id !== 'string' || !id || !Number.isFinite(amount) || amount <= 0) {
      return state;
    }
    try {
      return issueClaim(state, { id, kind: kind ?? 'AIWA', amount, owner: domain });
    } catch {
      return state; // duplicate claim id — same tolerant-fold discipline as elsewhere
    }
  }

  if (payload.type === 'transfer') {
    const { claimId, from, to } = payload;
    if (typeof claimId !== 'string' || !claimId || typeof from !== 'string' || !from || typeof to !== 'string' || !to) {
      return state;
    }
    try {
      const result = transfer(state, { claimId, from, to, n: 0, derivation: 'identity' }, { identity: identityDerivation });
      return result.state;
    } catch {
      return state; // e.g. claim not owned by `from`, already consumed, or unknown — rejected, not thrown out of the fold
    }
  }

  return state;
}

/**
 * registry(H_d) for Conservation: folds a topologically-ordered event
 * list into ConservationState, the same shape as materializeG() and
 * materializeModuleRegistry().
 */
export function materializeConservation(orderedEvents) {
  return orderedEvents.reduce(applyConservationEvent, initialConservationState());
}
