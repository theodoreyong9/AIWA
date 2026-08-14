// wasm-ledger-adapter.test.mjs — tests WasmLedgerAdapter's translation
// logic against a fake object that faithfully mimics the real Rust
// wasm-bindgen surface described in rust-core/src/dag.rs — synchronous
// methods, size() as a method call (not a getter), topoOrderJson()
// returning a JSON string — NOT against a re-implementation of DAG
// semantics itself (that's already covered by rust-core's own tests and
// scripts/verify-parity.sh / verify-g-parity.sh). This test exists to
// catch exactly the shape mismatches ledger-bridge.js's docstring
// describes: topoOrderJson (string) vs topoOrder (array), size() vs
// size (getter).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WasmLedgerAdapter } from '../public/js/core/wasm-ledger-adapter.js';

/**
 * A minimal fake matching the real Rust wasm-bindgen surface's *shape*
 * exactly (synchronous, same method names, same return types) — not a
 * full reimplementation of content-addressed ids or topological sort,
 * which would just be re-testing event-dag.js/core.rs, not the adapter.
 */
class FakeRawWasmEventDag {
  constructor() {
    this._events = new Map();
  }

  addEvent(parents, payload) {
    for (const p of parents) {
      if (!this._events.has(p)) {
        throw new Error(`Unknown parent: ${p}`); // mirrors dag.rs throwing a JsValue on Err
      }
    }
    // Content-addressed, like the real Rust backend (see event.rs's
    // compute_id) — a simple deterministic key here, not real SHA-256,
    // since this test is about the adapter's translation logic, not
    // about hashing. Using a counter instead would make two separate
    // fake instances collide on the same id for unrelated payloads
    // (e.g. both instances' first event getting id "fake-0"), which
    // would spuriously break merge() tests in a way the real
    // content-addressed backend never would.
    const id = `fake:${JSON.stringify({ parents: [...parents].sort(), payload })}`;
    this._events.set(id, { id, parents, payload }); // synchronous return, not a Promise — matches the real wasm binding
    return id;
  }

  merge(other) {
    for (const ev of other._events.values()) {
      if (!this._events.has(ev.id)) this._events.set(ev.id, ev);
    }
  }

  size() {
    return this._events.size; // a method, deliberately not a getter
  }

  topoOrderJson() {
    return JSON.stringify([...this._events.values()]); // a JSON string, deliberately not an array
  }
}

test('addEvent returns the id synchronously produced by the raw backend, awaitable regardless', async () => {
  const adapter = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  const id = await adapter.addEvent([], { type: 'genesis' });
  assert.equal(id, 'fake:{"parents":[],"payload":{"type":"genesis"}}');
});

test('size reads through to raw.size() as a getter, not a method call', async () => {
  const adapter = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  assert.equal(adapter.size, 0);
  await adapter.addEvent([], { type: 'genesis' });
  assert.equal(adapter.size, 1);
});

test('topoOrder parses topoOrderJson into the same array-of-objects shape event-dag.js#topoOrder returns', async () => {
  const adapter = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  const id = await adapter.addEvent([], { type: 'genesis' });
  const order = adapter.topoOrder();

  assert.ok(Array.isArray(order));
  assert.deepEqual(order, [{ id, parents: [], payload: { type: 'genesis' } }]);
});

test('addEvent propagates an unknown-parent error from the raw backend', async () => {
  const adapter = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  await assert.rejects(() => adapter.addEvent(['nonexistent'], { type: 'x' }));
});

test('merge unwraps another WasmLedgerAdapter and merges the raw backends', async () => {
  const a = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  const b = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  await a.addEvent([], { type: 'from-a' });
  await b.addEvent([], { type: 'from-b' });

  a.merge(b);

  assert.equal(a.size, 2);
});

test('merge rejects a non-WasmLedgerAdapter (backend mismatch) rather than silently doing nothing', () => {
  const a = new WasmLedgerAdapter(new FakeRawWasmEventDag());
  assert.throws(() => a.merge({ _raw: {} }), TypeError);
});
