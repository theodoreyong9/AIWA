// g.js — the full materialized economic view, A = G(H_d, θ), per §9–13.
// Composes the three reducers built in Phases 1–3 (cadence.js,
// reward.js, scarcity.js) into one fold over a topologically-ordered
// event list. This module adds no new economic rule of its own — it is
// purely the composition.
//
// θ here is { reward: { K, alpha, beta }, budgets: { [domain]: number|null } }.
//
// Event types recognized:
//   - 'cadence': delegated entirely to cadence.js's reducer.
//   - 'accrual': { domain, b, q0 } — a claim of committed resource b at
//     acceptance epoch q0. q is derived from the domain's current
//     cadence epoch *as folded so far* (i.e. by every cadence event that
//     topologically precedes this accrual event), not from any external
//     clock — this is the whole point of §10's cadence-derived economic
//     time. The requested reward is computed and then handed to the
//     scarcity reducer, which may clamp it; only the clamped, *issued*
//     amount is added to the domain's balance.
//   - anything else (e.g. 'genesis'): passed through unchanged.
//
// Lemma 1 (§11) note: this module does not need its own identity
// safety check. Because the underlying DAG's event id is a hash of the
// full canonicalized payload (§8, §8.1), and an accrual event's payload
// here always carries q0 as part of that payload, two accrual events
// that are economically distinct (different q0, hence generally
// different reward) cannot share an id — the strong-identity condition
// Lemma 1 requires falls out of §8's existing id scheme for free, as
// long as callers always include q0 in the payload. Omitting q0 from
// the payload while relying on it implicitly would reintroduce exactly
// the §11/§22 weak-identity failure — see tests/lemma1.test.mjs.

import { initialCadenceState, applyCadenceEvent } from './cadence.js';
import { reward, elapsedEpochs } from './reward.js';
import { initialScarcityState, applyIssuanceAttempt } from './scarcity.js';

/**
 * @typedef {{ K: number, alpha: number, beta: number }} RewardParams
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

  if (payload.type !== 'accrual') {
    return state; // e.g. 'genesis' — not this reducer's concern
  }

  const { domain, b, q0 } = payload;
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

  let requested;
  try {
    requested = reward(b, q, theta.reward);
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
