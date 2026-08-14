// ledger-bridge.js — single entry point to the ledger.
//
// Loads the WASM ledger (rust-core/, compiled via wasm-pack) if it's
// present, wrapping it in WasmLedgerAdapter so it presents the exact
// same interface as the pure JS EventDag; falls back to the pure JS
// EventDag directly if WASM isn't available (browser without WASM
// support, the build step hasn't run yet, constrained environment,
// etc.). This is the only file that needs to know which backend is
// active — main.js and the economics reducers never do.
//
// No other file in app/ should import event-dag.js directly — always
// go through this bridge.

import { EventDag } from './event-dag.js';
import { WasmLedgerAdapter } from './wasm-ledger-adapter.js';

async function tryLoadWasm() {
  try {
    // Expected path once rust-core is compiled and copied here by the
    // build script (see README.md, "Build Rust → WASM" section, and
    // .github/workflows/ci.yml's wasm-build job, which produces this
    // artifact in CI even where local compilation isn't possible).
    const mod = await import('../wasm/aiwa_core.js');
    await mod.default();
    return mod;
  } catch (_err) {
    return null;
  }
}

// Caches the *outcome* of trying to load WASM via the default loader
// (attempted: true/false, module: the loaded module or null on
// failure) — distinct from `module === null`, so a genuine load failure
// is remembered instead of retrying the dynamic import on every call.
// Only applies to the default loader: an explicitly-injected loader
// (e.g. a fake module in tests) always runs fresh and is never cached,
// so different tests injecting different fakes behave predictably.
let defaultLoaderCache = { attempted: false, module: null };

/**
 * @param {() => Promise<{ EventDag: new () => import('./wasm-ledger-adapter.js').RawWasmEventDag } | null>} [loadWasm]
 *   Injectable WASM loader, so the backend-selection logic itself can be
 *   tested with a fake module shaped like the real wasm-bindgen output,
 *   without needing an actual compiled .wasm binary in this environment
 *   — see tests/ledger-bridge.test.mjs.
 */
export async function createLedger(loadWasm = tryLoadWasm) {
  const usingDefaultLoader = loadWasm === tryLoadWasm;
  let mod;

  if (usingDefaultLoader) {
    if (!defaultLoaderCache.attempted) {
      defaultLoaderCache = { attempted: true, module: await tryLoadWasm() };
    }
    mod = defaultLoaderCache.module;
  } else {
    mod = await loadWasm();
  }

  if (mod) {
    return new WasmLedgerAdapter(new mod.EventDag());
  }
  return new EventDag();
}
