// cadence.js — economic cadence epoch transitions, per §10, Definition
// 10.1 of the whitepaper.
//
// A domain's economic epoch q_d only advances through a valid cadence
// transition: monotonic (+1 exactly), causally chained to the domain's
// previous accepted cadence event (replay- and fork-protection), and
// processed in the DAG's deterministic topological order (id-sorted),
// so every replica that has the same event set reaches the same q_d —
// this is what §9 requires of G: deterministic over the converged event
// set alone, not over receipt order.
//
// This module only implements the cadence-epoch state machine. It does
// not compute reward (§10's r(b,q), see reward.js once it exists) and
// does not enforce scarcity (§13). Those are separate reducers composed
// together in the full G (Phase 4).
//
// Closes R11 (§17's matrix — "cadence integrity remains an unverified
// dependency"), found by one direct question and one direct pushback:
// asked whether the mandatory heartbeat already bounded the RATE of
// cadence advancement, and it did not — §16.1's own text already
// separates observability (heartbeat, detecting silence) from economic
// time (the epoch counter), and nothing before this enforced anything
// about how FAST an active, apparently-honest domain could advance
// through valid, correctly-chained epochs. A domain could construct a
// thousand structurally-valid transitions in milliseconds. Every
// cadence transition now MUST carry a real sequential-hash-chain proof
// (cadence-vdf.js) — real, physically-irreducible sequential compute
// time, non-parallelizable regardless of available hardware, verified
// by recomputation rather than trusted. See cadence-vdf.js's own header
// for the honest scope of what this does and does not solve.

import { vdfSeed, verifyVdfChain } from './cadence-vdf.js';

/**
 * @typedef {{ epoch: number, lastId: string | null, vdfOutput: string | null }} DomainCadenceState
 * @typedef {{
 *   domains: Record<string, DomainCadenceState>,
 *   rejections: Array<{ eventId: string, domain: string, reason: string }>
 * }} CadenceState
 */

/** @returns {CadenceState} */
export function initialCadenceState() {
  return { domains: {}, rejections: [] };
}

/**
 * Applies one event to the cadence state. Non-cadence events pass
 * through unchanged. Invalid cadence transitions are rejected (recorded,
 * not applied) rather than throwing — an adversarial or malformed event
 * already present in the DAG must not stop materialization for
 * everyone else; it just never becomes economically effective.
 *
 * @param {CadenceState} state
 * @param {{ id: string, parents: string[], payload: any }} event
 * @returns {CadenceState}
 */
export function applyCadenceEvent(state, event) {
  const payload = event.payload;
  if (!payload || payload.type !== 'cadence') {
    return state;
  }

  const { domain, epoch, vdfIterations, vdfOutput } = payload;
  const reject = (reason) => ({
    ...state,
    rejections: [...state.rejections, { eventId: event.id, domain, reason }],
  });

  if (typeof domain !== 'string' || domain.length === 0) {
    return reject('missing or invalid domain');
  }
  if (!Number.isInteger(epoch) || epoch < 1) {
    return reject('epoch must be a positive integer');
  }

  const current = state.domains[domain] ?? { epoch: 0, lastId: null, vdfOutput: null };

  // Monotonic, single-step, bounded advancement: no skipping epochs.
  if (epoch !== current.epoch + 1) {
    return reject(`expected epoch ${current.epoch + 1}, got ${epoch}`);
  }

  // Causal chaining: this transition must build on the domain's last
  // accepted cadence event. This is what stops a second, competing
  // event from also claiming the same next epoch (fork protection) and
  // what stops re-deriving an already-consumed transition (replay
  // protection) — the DAG itself already prevents literal duplicate
  // ids, this additionally prevents a *different* event id from
  // claiming the same epoch number twice.
  if (current.lastId !== null && !event.parents.includes(current.lastId)) {
    return reject(`does not chain from domain's last accepted cadence event ${current.lastId}`);
  }

  // R11: bounds the RATE of advancement, not just its shape. The seed
  // depends on the PREVIOUS epoch's own real vdfOutput (or 'genesis'
  // for epoch 1), so epoch N's chain cannot even begin — let alone be
  // precomputed — until epoch N-1's chain has genuinely finished.
  if (!Number.isInteger(vdfIterations) || vdfIterations < 1) {
    return reject('vdfIterations must be a positive integer');
  }
  const seed = vdfSeed(domain, current.vdfOutput ?? 'genesis');
  if (!verifyVdfChain(seed, vdfIterations, vdfOutput)) {
    return reject('cadence VDF proof does not verify against the real, recomputed sequential hash chain for this domain and epoch position');
  }

  return {
    ...state,
    domains: {
      ...state.domains,
      [domain]: { epoch, lastId: event.id, vdfOutput },
    },
  };
}

/**
 * Folds cadence transitions over a topologically-ordered event list
 * (e.g. from EventDag#topoOrder()).
 *
 * @param {Array<{ id: string, parents: string[], payload: any }>} orderedEvents
 * @returns {CadenceState}
 */
export function materializeCadence(orderedEvents) {
  return orderedEvents.reduce(applyCadenceEvent, initialCadenceState());
}
