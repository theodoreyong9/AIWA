// ledger-bridge.test.mjs — tests createLedger()'s backend-selection
// wiring itself, using an injected fake WASM loader shaped exactly like
// the real one (see rust-core/src/dag.rs and
// tests/wasm-ledger-adapter.test.mjs). This is the test that actually
// closes the loop this session's work opened: it proves that IF a real
// compiled aiwa_core.js module loads successfully (produced by CI's
// wasm-build job — this sandbox cannot compile wasm32 locally, see
// README.md's "Build Rust → WASM" section), the app would run correctly
// through it, without needing the real .wasm binary here to prove it.
//
// What this does NOT prove: that the real Rust code, once actually
// compiled to wasm32 and loaded in a real browser, behaves identically
// to this fake. That is a separate, still-open verification step — see
// README.md's status list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../public/js/core/ledger-bridge.js';
import { EventDag } from '../public/js/core/event-dag.js';
import { WasmLedgerAdapter } from '../public/js/core/wasm-ledger-adapter.js';
import { materializeG } from '../public/js/core/economics/g.js';

/** Same fake used in wasm-ledger-adapter.test.mjs, shaped like the real Rust wasm-bindgen surface. */
class FakeRawWasmEventDag {
  constructor() {
    this._events = new Map();
  }
  addEvent(parents, payload) {
    for (const p of parents) {
      if (!this._events.has(p)) throw new Error(`Unknown parent: ${p}`);
    }
    // Content-addressed, like the real Rust backend — see the matching
    // comment in tests/wasm-ledger-adapter.test.mjs for why this matters.
    const id = `fake:${JSON.stringify({ parents: [...parents].sort(), payload })}`;
    this._events.set(id, { id, parents, payload });
    return id;
  }
  merge(other) {
    for (const ev of other._events.values()) {
      if (!this._events.has(ev.id)) this._events.set(ev.id, ev);
    }
  }
  size() {
    return this._events.size;
  }
  topoOrderJson() {
    return JSON.stringify([...this._events.values()]);
  }
}

async function fakeWasmLoaderThatSucceeds() {
  return { EventDag: FakeRawWasmEventDag, default: async () => {} };
}
async function fakeWasmLoaderThatFails() {
  return null;
}

test('createLedger falls back to the pure JS EventDag when no WASM loader is given/succeeds', async () => {
  const ledger = await createLedger(fakeWasmLoaderThatFails);
  assert.ok(ledger instanceof EventDag);
});

test('createLedger returns a WasmLedgerAdapter when the injected WASM loader succeeds', async () => {
  const ledger = await createLedger(fakeWasmLoaderThatSucceeds);
  assert.ok(ledger instanceof WasmLedgerAdapter);
});

test('a WASM-backed ledger is usable by the economics reducers exactly like the JS one — same call surface, same result shape', async () => {
  const ledger = await createLedger(fakeWasmLoaderThatSucceeds);
  const theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { d1: null } };

  const genesis = await ledger.addEvent([], { type: 'genesis' });
  const c1 = await ledger.addEvent([genesis], { type: 'cadence', domain: 'd1', epoch: 1 });
  const c2 = await ledger.addEvent([c1], { type: 'cadence', domain: 'd1', epoch: 2 });
  await ledger.addEvent([c2], { type: 'accrual', domain: 'd1', b: 10, q0: 0 });

  // materializeG() calls ledger.topoOrder() — this is the exact call
  // that would have thrown or silently misbehaved against the raw,
  // unadapted wasm-bindgen EventDag (no topoOrder() method, only
  // topoOrderJson()) before this session's fix.
  const state = materializeG(theta, ledger.topoOrder());

  assert.equal(state.cadence.domains.d1.epoch, 2);
  assert.equal(state.balances.d1, 20); // K=1, b=10, q=2
  assert.equal(ledger.size, 4);
});
