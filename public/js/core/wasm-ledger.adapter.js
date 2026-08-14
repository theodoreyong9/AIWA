// wasm-ledger-adapter.js — adapts the raw wasm-bindgen surface exposed
// by rust-core/src/dag.rs's `EventDag` (see rust-core/src/dag.rs) to
// the exact same call contract public/js/core/event-dag.js's `EventDag`
// already provides. This is what lets main.js and the economics
// reducers (cadence.js/reward.js/scarcity.js/g.js) call
// `ledger.topoOrder()` and read `ledger.size` without caring, or even
// being able to tell, whether the pure JS or the WASM backend is active.
//
// The two backends are NOT naturally identical, and pretending otherwise
// without this adapter previously would have been a real bug, caught
// here rather than in a browser once a compiled .wasm finally loaded:
//
//   - JS EventDag has topoOrder() returning an array of
//     {id, parents, payload} objects.
//     Rust's wasm EventDag only has topoOrderJson(), returning a JSON
//     *string* of the same shape (see dag.rs's topo_order_json()) —
//     wasm-bindgen does not auto-convert a Vec<Event> return value to a
//     JS array of plain objects, only to a string here.
//   - JS EventDag exposes `size` as a getter.
//     Rust's wasm EventDag exposes `size()` as a method call (there is
//     no #[wasm_bindgen(getter)] annotation on it in dag.rs).
//
// This adapter exists specifically to absorb both differences in one
// place, so nothing downstream needs a WASM-specific code path.

/**
 * @typedef {{
 *   addEvent(parents: string[], payload: unknown): string,
 *   merge(other: unknown): void,
 *   size(): number,
 *   topoOrderJson(): string,
 * }} RawWasmEventDag
 */

export class WasmLedgerAdapter {
  /** @param {RawWasmEventDag} rawWasmEventDag */
  constructor(rawWasmEventDag) {
    this._raw = rawWasmEventDag;
  }

  /**
   * Matches EventDag#addEvent's signature and semantics exactly (async,
   * same parameter order, same return type), even though the underlying
   * Rust call is synchronous — `await`ing a non-promise value resolves
   * immediately, so callers do not need to know which is which.
   *
   * @param {string[]} parents
   * @param {object} payload
   * @returns {Promise<string>}
   */
  async addEvent(parents, payload) {
    // wasm-bindgen converts a plain JS object argument to serde_json::Value
    // on the Rust side automatically (via serde-wasm-bindgen in
    // dag.rs's add_event) — payload is passed through as-is, not
    // JSON.stringify'd here.
    return this._raw.addEvent(parents, payload);
  }

  /**
   * @param {WasmLedgerAdapter} other another WasmLedgerAdapter — merging
   *   a pure-JS EventDag into a WASM-backed one (or vice versa) is not
   *   supported, matching the Rust side's `fn merge(&mut self, other:
   *   &EventDag)`, which requires the same concrete type.
   */
  merge(other) {
    if (!(other instanceof WasmLedgerAdapter)) {
      throw new TypeError('WasmLedgerAdapter#merge only accepts another WasmLedgerAdapter (backend mismatch).');
    }
    this._raw.merge(other._raw);
  }

  get size() {
    return this._raw.size();
  }

  /**
   * Bridges topoOrderJson()'s JSON string to the array shape
   * EventDag#topoOrder() returns directly, so callers never need an
   * `if backend === 'wasm'` branch.
   *
   * @returns {Array<{ id: string, parents: string[], payload: any }>}
   */
  topoOrder() {
    return JSON.parse(this._raw.topoOrderJson());
  }
}
