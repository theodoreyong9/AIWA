// event-dag.js — pure JavaScript, no external dependency.
//
// Reference implementation of H_d: a grow-only set of uniquely
// identified events, linked by their causal parents (DAG, Lamport-style
// happens-before). No global clock, no total order required on insert.
//
// This class is the reference INTERFACE. The Rust/WASM module
// (rust-core/) must expose exactly the same semantics
// (addEvent / materialize) so it can replace this module without
// changing any calling code. See ledger-bridge.js.

/**
 * Recursively sorts object keys so JSON.stringify produces the same byte
 * output regardless of insertion order — matching serde_json's default
 * (BTreeMap-backed) key ordering on the Rust side. Arrays keep their
 * order (order is meaningful there); only plain object keys are sorted.
 * This is what makes computeId() below produce the same id as
 * Event::compute_id() in rust-core/src/event.rs for the same logical
 * value, at every nesting level — not just the top one.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

export class EventDag {
  constructor() {
    /** @type {Map<string, {id: string, parents: string[], payload: object}>} */
    this._events = new Map();
  }

  /**
   * Computes a content-addressed identifier (SHA-256) for an event,
   * derived from its payload and parents — never from a local counter
   * or a wall clock. Payload and parents are canonicalized first so the
   * id does not depend on key insertion order, at any nesting depth.
   */
  async computeId(parents, payload) {
    const encoder = new TextEncoder();
    const canonical = canonicalize({ parents: [...parents].sort(), payload });
    const data = encoder.encode(JSON.stringify(canonical));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Adds an event to the DAG. Idempotent: re-adding an already-known
   * event (same id) is a no-op, which makes merging two domains after
   * a partition trivially deterministic (set union).
   */
  async addEvent(parents, payload) {
    for (const p of parents) {
      if (!this._events.has(p)) {
        throw new Error(`Unknown parent: ${p} — an event can only reference parents already present locally.`);
      }
    }
    const id = await this.computeId(parents, payload);
    if (!this._events.has(id)) {
      this._events.set(id, { id, parents: [...parents], payload });
    }
    return id;
  }

  /** Merges another DAG into this one. Pure, commutative, idempotent union. */
  merge(otherDag) {
    for (const ev of otherDag._events.values()) {
      if (!this._events.has(ev.id)) {
        this._events.set(ev.id, ev);
      }
    }
  }

  /** Deterministic topological order (parents before children, then by id). */
  topoOrder() {
    const visited = new Set();
    const order = [];
    const ids = [...this._events.keys()].sort();

    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const ev = this._events.get(id);
      for (const p of [...ev.parents].sort()) visit(p);
      order.push(ev);
    };
    for (const id of ids) visit(id);
    return order;
  }

  /**
   * Materialized view A = G(H, θ): reduces the event history into an
   * economic state via a pure reducer supplied by the caller. The DAG
   * itself never knows any economic semantics — this is the
   * replicated-state / economic-meaning separation principle from the
   * paper (§3.1).
   */
  materialize(reducer, initialState) {
    return this.topoOrder().reduce((state, ev) => reducer(state, ev), initialState);
  }

  get size() {
    return this._events.size;
  }
}
