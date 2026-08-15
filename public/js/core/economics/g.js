// g.js — the full materialized economic view, A = G(H_d, θ), per §9–13.
// Composes the three reducers built in Phases 1–3 (cadence.js,
// reward.js, scarcity.js) into one fold over a topologically-ordered
// event list. This module adds no new economic rule of its own — it is
// purely the composition.
//
// θ here is { reward: { alpha, beta, gamma, C, minQ }, budgets: { [domain]: number|null } }
// — the real Proof-of-Will reward structure (reward.js), not the
// earlier simpler power-law form.
//
// Event types recognized:
//   - 'cadence': delegated entirely to cadence.js's reducer.
//   - 'accrual': { domain, b, q0, T } — a claim of committed resource b
//     at acceptance epoch q0, with caller-chosen patience rate T (§10's
//     reward.js; clamped to [0, 0.4] inside reward() itself, so an
//     out-of-range or missing T here is not rejected — it is folded
//     through unchanged and clamped at the point of use, matching the
//     original formula's own Math.min(tr,40)/100 behavior). q is
//     derived from the domain's current cadence epoch *as folded so
//     far*, never from any external clock (§10). qTotal (this domain's
//     own total epoch count — reward.js's domain-local stand-in for the
//     original's global "protocol age," see reward.js's header) is read
//     from the same folded cadence state. The requested reward is
//     computed and then handed to the scarcity reducer, which may clamp
//     it; only the clamped, *issued* amount is added to the domain's
//     balance.
//   - anything else (e.g. 'genesis'): passed through unchanged.
//
// Lemma 1 (§11) note: unchanged from the prior revision — an accrual
// event's payload still always carries q0, which is still what the
// strong-identity guarantee rests on. T's addition to the payload only
// strengthens this: two claims differing only in patience rate are now
// also distinguishable by id, not merely by q0.

import { initialCadenceState, applyCadenceEvent } from './cadence.js';
import { reward, elapsedEpochs, domainAge } from './reward.js';
import { initialScarcityState, applyIssuanceAttempt } from './scarcity.js';

/**
 * @typedef {{ alpha: number, beta: number, gamma: number, C: number, minQ: number }} RewardParams
 * @typedef {{ reward: RewardParams, budgets: Record<string, number | null> }} Theta
 * @typedef {{
 *   cadence: import('./cadence.js').CadenceState,
 *   scarcity: import('./scarcity.js').ScarcityState,
 *   balances: Record<string, number>,
 *   accrualRejections: Array<{ eventId: string, domain: string | null, reason: string }>
 * }} GState
 */

/**
 * @param {Theta} theta
 * @returns {GState}
 */
export function initialGState(theta) {
  return {
    cadence: initialCadenceState(),
    scarcity: initialScarcityState(theta.budgets),
    balances: {},
    accrualRejections: [],
  };
}

/**
 * @param {Theta} theta
 * @param {GState} state
 * @param {{ id: string, parents: string[], payload: any }} event
 * @returns {GState}
 */
export function applyGEvent(theta, state, event) {
  const payload = event.payload;
  if (!payload || typeof payload.type !== 'string') {
    return state;
  }

  if (payload.type === 'cadence') {
    return { ...state, cadence: applyCadenceEvent(state.cadence, event) };
  }

  if (payload.type === 'claim-issue') {
    // Bridges G's fungible balance to Conservation's claims (§6.1/§7):
    // converts part of a domain's accrued balance into a spendable,
    // uniquely-identified claim. This reducer only debits the balance —
    // creating the actual Claim record is conservation.js's
    // issueClaim(), applied separately by whoever folds both views over
    // the same event (see conservation-bridge.js). Insufficient balance
    // is rejected exactly like a malformed accrual, not silently
    // clamped — spending more than you have is a real error, not a
    // scarcity policy to apply.
    const { domain, amount } = payload;
    if (typeof domain !== 'string' || domain.length === 0 || !Number.isFinite(amount) || amount <= 0) {
      return { ...state, accrualRejections: [...state.accrualRejections, { eventId: event.id, domain: domain ?? null, reason: 'invalid claim-issue payload' }] };
    }
    const currentBalance = state.balances[domain] ?? 0;
    if (amount > currentBalance) {
      return {
        ...state,
        accrualRejections: [...state.accrualRejections, { eventId: event.id, domain, reason: `insufficient balance: has ${currentBalance}, tried to issue claim of ${amount}` }],
      };
    }
    return { ...state, balances: { ...state.balances, [domain]: currentBalance - amount } };
  }

  if (payload.type !== 'accrual') {
    return state; // e.g. 'genesis', 'transfer' — not this reducer's concern
  }

  const { domain, b, q0, T } = payload;
  const reject = (reason) => ({
    ...state,
    accrualRejections: [...state.accrualRejections, { eventId: event.id, domain: domain ?? null, reason }],
  });

  if (typeof domain !== 'string' || domain.length === 0) {
    return reject('missing or invalid domain');
  }
  if (!Number.isInteger(q0) || q0 < 0) {
    return reject('q0 must be a non-negative integer');
  }

  const q = elapsedEpochs(state.cadence, domain, q0);
  const qTotal = domainAge(state.cadence, domain);
  const patienceRate = Number.isFinite(T) ? T : 0;

  let requested;
  try {
    requested = reward(b, q, qTotal, patienceRate, theta.reward);
  } catch (err) {
    return reject(`invalid reward inputs: ${err.message}`);
  }

  const { state: newScarcity, issued } = applyIssuanceAttempt(state.scarcity, domain, requested);
  const currentBalance = state.balances[domain] ?? 0;

  return {
    ...state,
    scarcity: newScarcity,
    balances: { ...state.balances, [domain]: currentBalance + issued },
  };
}

/**
 * A = G(H_d, θ): folds a topologically-ordered event list (e.g. from
 * EventDag#topoOrder()) through cadence + reward + scarcity.
 *
 * @param {Theta} theta
 * @param {Array<{ id: string, parents: string[], payload: any }>} orderedEvents
 * @returns {GState}
 */
export function materializeG(theta, orderedEvents) {
  return orderedEvents.reduce((state, event) => applyGEvent(theta, state, event), initialGState(theta));
}
