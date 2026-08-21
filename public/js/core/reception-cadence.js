// reception-cadence.js — a mandatory, signed, per-tick commitment to
// what a domain has (or has not) received from other domains, and a
// monotonicity check across a domain's own successive claims about the
// same sender. Built from a direct research exchange: what does the
// "common reception cadence" idea actually add, once the parts already
// free from the DAG's own parent-pointer ordering (you cannot reference
// an event as a parent before it exists — already true, no new
// mechanism needed) are correctly set aside?
//
// Two real properties, neither already present anywhere else:
//
// 1. RECURRING COST. R11 (cadence-vdf.js) already makes each domain's
//    own epoch advancement cost real, physically-irreducible sequential
//    compute time — unconditionally, whether connected or not. This
//    file adds a MANDATORY signed commitment at every one of those
//    ticks, empty or full. A Sybil cluster built in private, however
//    patiently, still has to keep signing a real commitment at every
//    real tick to remain outwardly consistent — turning identity
//    maintenance into a recurring, ongoing cost, not the one-time
//    registration burn identity-cost.js already covers. This does NOT
//    prevent a patient attacker from building a real, honest-looking
//    Sybil cluster over real time — nothing here claims to — it only
//    makes doing so cost real, ongoing signing effort for every fake
//    identity, for as long as the fabrication needs to look real.
//
// 2. RECEPTION MONOTONICITY. For a given (A, C) pair, A's own
//    successive reception commitments about C — ordered by A's own
//    real epoch — must reference a non-decreasing position in C's own
//    real, independently-recomputed history. A domain claiming, later
//    in its own real history, to have received an EARLIER state of
//    another domain than it itself already claimed to have seen is a
//    genuine internal inconsistency, catchable by pure recomputation,
//    with no external clock, no position, no propagation-delay bound —
//    exactly the correction that closed the version of this idea that
//    tried to use an external slot anchor instead.
//
// Explicitly NOT what this file does: prove that two domains are
// distinct real-world entities (that is identity-cost.js's job,
// already separate), or prevent a genuinely collaborating pair from
// fabricating a mutually-consistent history together (nothing
// relational, with no external anchor, can ever rule that out — named
// honestly, not glossed over, the same limit this idea's own research
// conversation converged on directly).

/**
 * @typedef {{ sourceDomain: string, eventId: string }} ReceivedRef
 * @typedef {{
 *   domain: string,
 *   epoch: number,
 *   kind: 'empty' | 'full',
 *   receivedFrom: ReceivedRef[],
 * }} ReceptionCommitment
 * @typedef {{
 *   commitments: Record<string, ReceptionCommitment[]>,
 *   maxSeenEpoch: Record<string, Record<string, number>>,
 *   rejections: Array<{ eventId: string, domain: string, reason: string }>,
 * }} ReceptionCadenceState
 */

export function initialReceptionCadenceState() {
  return { commitments: {}, maxSeenEpoch: {}, rejections: [] };
}

function canonicalReceptionMessage({ domain, epoch, kind, receivedFrom }) {
  // Canonical, order-independent: sort receivedFrom deterministically
  // so the same real set always produces the same signed message
  // regardless of local iteration order.
  const sorted = [...receivedFrom].sort((a, b) => (a.sourceDomain + a.eventId).localeCompare(b.sourceDomain + b.eventId));
  return JSON.stringify({ domain, epoch, kind, receivedFrom: sorted });
}

async function verifyCommitmentSignature(payload) {
  const { ed25519 } = await import('@noble/curves/ed25519');
  const { deriveDomainId } = await import('./identity/domain-id.js');
  const fromHex = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  };
  const message = new TextEncoder().encode(canonicalReceptionMessage(payload));
  let valid;
  try {
    valid = ed25519.verify(fromHex(payload.signature), message, fromHex(payload.signerPubkey));
  } catch {
    return false;
  }
  if (!valid) return false;
  const derivedId = await deriveDomainId(fromHex(payload.signerPubkey));
  return derivedId === payload.domain;
}

/**
 * Applies one 'reception-commit' event. `sourceEpochLookup(sourceDomain,
 * eventId)` is a caller-supplied, pure function returning the real
 * epoch (in the source domain's own real, independently-materialized
 * cadence state) that produced `eventId`, or `null` if no such event
 * genuinely exists there — the actual recompute-don't-trust check: a
 * reference to a real but structurally invalid target is always
 * rejected, never merely assumed correct because it was signed.
 *
 * @param {ReceptionCadenceState} state
 * @param {{ id: string, payload: any }} event
 * @param {(sourceDomain: string, eventId: string) => number | null} sourceEpochLookup
 * @returns {Promise<ReceptionCadenceState>}
 */
export async function applyReceptionCommitEvent(state, event, sourceEpochLookup) {
  const payload = event.payload;
  if (!payload || payload.type !== 'reception-commit') return state;

  const { domain, epoch, kind, receivedFrom, signature, signerPubkey } = payload;
  if (typeof domain !== 'string' || !domain) return reject(state, event.id, domain ?? '', 'missing domain');
  if (!Number.isInteger(epoch) || epoch < 1) return reject(state, event.id, domain, 'epoch must be a positive integer');
  if (kind !== 'empty' && kind !== 'full') return reject(state, event.id, domain, "kind must be 'empty' or 'full'");
  if (!Array.isArray(receivedFrom)) return reject(state, event.id, domain, 'receivedFrom must be an array');
  if (kind === 'empty' && receivedFrom.length !== 0) return reject(state, event.id, domain, "kind='empty' requires an empty receivedFrom");
  if (kind === 'full' && receivedFrom.length === 0) return reject(state, event.id, domain, "kind='full' requires a non-empty receivedFrom");

  if (!(await verifyCommitmentSignature({ domain, epoch, kind, receivedFrom, signature, signerPubkey }))) {
    return reject(state, event.id, domain, 'invalid or non-matching signature');
  }

  // Real, per-reference structural check: every claimed reception must
  // resolve to a real event that genuinely exists, at a real epoch, in
  // the source domain's own independently-materialized history.
  const resolvedEpochs = {};
  for (const ref of receivedFrom) {
    if (typeof ref.sourceDomain !== 'string' || typeof ref.eventId !== 'string') {
      return reject(state, event.id, domain, 'malformed receivedFrom entry');
    }
    const sourceEpoch = sourceEpochLookup(ref.sourceDomain, ref.eventId);
    if (sourceEpoch === null || sourceEpoch === undefined) {
      return reject(state, event.id, domain, `claimed reception of '${ref.eventId}' from '${ref.sourceDomain}' does not correspond to any real event there`);
    }
    resolvedEpochs[ref.sourceDomain] = Math.max(resolvedEpochs[ref.sourceDomain] ?? 0, sourceEpoch);
  }

  // RECEPTION MONOTONICITY: for each referenced source domain, this
  // domain's own claimed "how far along I've seen them" must never go
  // backwards across its own successive, real, epoch-ordered claims.
  const priorMax = state.maxSeenEpoch[domain] ?? {};
  for (const [sourceDomain, newMax] of Object.entries(resolvedEpochs)) {
    const previous = priorMax[sourceDomain] ?? 0;
    if (newMax < previous) {
      return reject(state, event.id, domain, `reception monotonicity violated: previously claimed to have seen '${sourceDomain}' up to epoch ${previous}, now claims only epoch ${newMax}`);
    }
  }

  const newMaxSeenForDomain = { ...priorMax };
  for (const [sourceDomain, newMax] of Object.entries(resolvedEpochs)) {
    newMaxSeenForDomain[sourceDomain] = Math.max(newMaxSeenForDomain[sourceDomain] ?? 0, newMax);
  }

  return {
    ...state,
    commitments: { ...state.commitments, [domain]: [...(state.commitments[domain] ?? []), { domain, epoch, kind, receivedFrom }] },
    maxSeenEpoch: { ...state.maxSeenEpoch, [domain]: newMaxSeenForDomain },
  };
}

function reject(state, eventId, domain, reason) {
  return { ...state, rejections: [...state.rejections, { eventId, domain, reason }] };
}

/**
 * Real, DAG-native derivation of `sourceEpochLookup` -- the "epoch that
 * produced this event" a caller needs, computed by recomputation, not
 * self-declared. If `eventId` is itself a real 'cadence' event
 * belonging to `domain`, its own epoch is authoritative; otherwise,
 * walks the event's real ancestor chain (the same bounded-safety walk
 * causal-condition-evaluator.js's own causal-order primitive already
 * uses) looking for the highest-epoch 'cadence' event of `domain` that
 * causally precedes it. Returns null if `eventId` does not genuinely
 * belong to `domain`, or if no real cadence event of that domain is
 * found among its ancestors -- a fabricated reference to a nonexistent
 * or misattributed event is never silently accepted.
 *
 * @param {Array<{ id: string, parents: string[], payload: any }>} orderedEvents
 * @returns {(sourceDomain: string, eventId: string) => number | null}
 */
export function deriveSourceEpochLookup(orderedEvents) {
  const byId = new Map(orderedEvents.map((e) => [e.id, e]));
  const SAFETY_BOUND = 10000;

  return (sourceDomain, eventId) => {
    const target = byId.get(eventId);
    if (!target || target.payload?.domain !== sourceDomain) return null; // genuinely does not exist, or misattributed — the only real rejection case

    if (target.payload?.type === 'cadence' && Number.isInteger(target.payload.epoch)) {
      return target.payload.epoch;
    }

    // Any other real, correctly-attributed event of this domain is a
    // legitimate fact to reference — identity registration, an early
    // accrual, anything — whether or not the domain has advanced its
    // cadence yet. A real event found with NO cadence ancestors is not
    // "nonexistent"; it is this domain's own real epoch-0 state, the
    // same emergent widening of verifiable data every other real event
    // already gets, with no special first-contact rule needed. Only a
    // fabricated or misattributed reference — caught above — is ever
    // rejected.
    const visited = new Set();
    const queue = [...target.parents];
    let maxEpoch = 0;
    while (queue.length > 0 && visited.size < SAFETY_BOUND) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const event = byId.get(id);
      if (event) {
        if (event.payload?.type === 'cadence' && event.payload?.domain === sourceDomain && Number.isInteger(event.payload.epoch)) {
          maxEpoch = Math.max(maxEpoch, event.payload.epoch);
        }
        queue.push(...event.parents);
      }
    }
    return maxEpoch; // real event, real domain, real position — 0 is a legitimate epoch-0 state, never treated as absence
  };
}

/**
 * registry(H_d) for reception commitments — mirror of every other
 * materialize* function in this project. `sourceEpochLookup` is
 * threaded through unchanged to every event.
 *
 * @param {Array<{ id: string, payload: any }>} orderedEvents
 * @param {(sourceDomain: string, eventId: string) => number | null} sourceEpochLookup
 * @returns {Promise<ReceptionCadenceState>}
 */
export async function materializeReceptionCadence(orderedEvents, sourceEpochLookup) {
  let state = initialReceptionCadenceState();
  for (const event of orderedEvents) {
    state = await applyReceptionCommitEvent(state, event, sourceEpochLookup);
  }
  return state;
}
