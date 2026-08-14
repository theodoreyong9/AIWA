// ledger-bridge.js — single entry point to the ledger.
//
// For now, this file re-exports the pure JS implementation
// (event-dag.js), directly deployable with no build step.
//
// Once rust-core/ is compiled to WASM (wasm-pack build --target web),
// this is the ONLY file that needs to change: it will load the WASM
// binary and fall back to the pure JS EventDag if loading fails
// (browser without WASM, constrained environment, etc.).
//
// No other file in app/ should import event-dag.js directly — always
// go through this bridge.

import { EventDag } from './event-dag.js';

let wasmModule = null;

async function tryLoadWasm() {
  try {
    // Expected path once rust-core is compiled and copied here by the
    // build script (see README.md, "Build Rust → WASM" section).
    const mod = await import('../wasm/aiwa_core.js');
    await mod.default();
    return mod;
  } catch (_err) {
    return null;
  }
}

export async function createLedger() {
  if (wasmModule === null) {
    wasmModule = await tryLoadWasm();
  }
  if (wasmModule) {
    // Expected contract on the Rust side: wasmModule.EventDag with the
    // same API (addEvent, merge, materialize) — see rust-core/src/dag.rs.
    return new wasmModule.EventDag();
  }
  return new EventDag();
}
