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

  async addEvent(parents, payload) {
    return this._raw.addEvent(parents, payload);
  }

  merge(other) {
    if (!(other instanceof WasmLedgerAdapter)) {
      throw new TypeError('WasmLedgerAdapter#merge only accepts another WasmLedgerAdapter (backend mismatch).');
    }
    this._raw.merge(other._raw);
  }

  get size() {
    return this._raw.size();
  }

  topoOrder() {
    return JSON.parse(this._raw.topoOrderJson());
  }
}
