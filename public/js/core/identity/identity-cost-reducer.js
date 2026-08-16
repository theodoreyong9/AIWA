// identity-cost-reducer.js — closes the gap the user flagged directly:
// "où ils vivent a l'air critique pour les déploiements interplanétaires."
// identityState used to be a standalone JS variable in main.js, never
// folded from H_d — meaning two domains that reconciled after a long
// partition would never actually learn about each other's registered
// identities. This makes identity-cost registration a DAG event type,
// folded the same way cadence/accrual/module-registry/conservation
// events already are: propagated for free by merge(), not by any
// special-cased mechanism.
//
// Honest limit, stated rather than glossed over: this fold is pure —
// no network call, matching every other reducer's discipline — so it
// verifies what CAN be verified without one (the replay guard: the
// same burn signature can never register two different domains; a
// domain can't register twice), reusing identity-cost.js's own
// already-tested registerIdentityCost() for that. It does NOT
// independently re-query Solana during the fold to confirm the claimed
// burn amount actually happened on-chain — that would make every
// domain's identity view network-dependent, which no other materialized
// view in this project is. The domain that BROADCASTS a burn has strong
// assurance (identity-flow.js's registerDomainViaBurn() calls the real
// Solana RPC before ever creating this event). A domain that later
// learns of someone else's registration via merge() is trusting the
// claim as folded unless it separately re-verifies the embedded
// signature against Solana's RPC itself (solana-rpc.js's
// fetchNormalizedBurnTx already provides that building block — it is
// just not invoked automatically here).

import { registerIdentityCost, initialIdentityCostState } from './identity-cost.js';

export function applyIdentityEvent(state, event) {
  const payload = event.payload;
  if (!payload || payload.type !== 'identity-register') return state;

  const { domain, signature, burnedLamports, at } = payload;
  if (typeof domain !== 'string' || !domain || typeof signature !== 'string' || !signature || !Number.isFinite(burnedLamports)) {
    return state; // malformed — tolerant fold, same discipline as every other reducer
  }

  const tx = { signature, err: null, incineratorBalanceDeltaLamports: burnedLamports, commitment: 'finalized' };
  const result = registerIdentityCost(state, { domain, tx, minLamports: 0, now: at ?? 0 });
  return result.state; // rejections (replay, already-registered, non-positive burn) leave state unchanged
}

/**
 * registry(H_d) for identity cost — mirror of materializeModuleRegistry()
 * / materializeConservation().
 */
export function materializeIdentity(orderedEvents) {
  return orderedEvents.reduce(applyIdentityEvent, initialIdentityCostState());
}
