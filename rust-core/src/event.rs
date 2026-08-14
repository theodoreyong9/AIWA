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

/**
 * @typedef {{ epoch: number, lastId: string | null }} DomainCadenceState
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

  const { domain, epoch } = payload;
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

  const current = state.domains[domain] ?? { epoch: 0, lastId: null };

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

  return {
    ...state,
    domains: {
      ...state.domains,
      [domain]: { epoch, lastId: event.id },
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
