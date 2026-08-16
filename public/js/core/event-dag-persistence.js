// event-dag-persistence.js — closes a real gap found by one direct
// question: "le DAG et les données elles vivent que si les
// utilisateurs ont au moins un ordinateur allumé sinon tout disparait?"
// The answer was yes, and it was worse than "data disappears" —
// unlockWalletAndDomain() created a brand-new EMPTY DAG on every
// unlock, same domain id, zero history, as if nothing had ever
// happened. Only the wallet key itself (localStorage) survived; the
// entire ledger — cadence, accrual, every burn's resulting identity-
// register event, every minted formula, every registered module,
// every AIWA sent or received — lived only in a JS variable, gone the
// instant the tab closed.
//
// Closed with IndexedDB, the only browser storage with the capacity
// and structure for a growing event set (localStorage is a poor fit —
// synchronous, ~5-10MB typical quota, string-only). Two genuinely
// different pieces, kept separate on purpose, matching this project's
// established discipline of isolating the untestable network/storage
// primitive from the real logic built on top of it (solana-rpc.js,
// module-loader.js, delay-tolerant-transport.js all follow the same
// shape):
//
//   - topologicalSortForReplay(): pure, no IndexedDB, fully testable —
//     puts a flat list of stored {id, parents, payload} events into an
//     order addEvent() can safely replay (parents before children).
//   - everything else here touches indexedDB directly and is
//     untestable in this Node-based sandbox (IndexedDB is a browser
//     API with no equivalent in this test environment) — real code,
//     unverified here, the same category of limitation as solana-
//     rpc.js's network calls, not a stub standing in for real logic.
//
// Recomputes ids on replay rather than trusting what was stored
// (addEvent() re-derives id from parents+payload via SHA-256, the same
// "recompute, don't trust" discipline this project applies to hashes,
// signatures, and everything else it could instead choose to trust on
// faith) — a side benefit: silent corruption of the stored data is
// caught as a mismatch, not silently propagated.

const DB_VERSION = 1;
const STORE_NAME = 'events';

/**
 * Pure — orders a flat list of stored events so that every event's
 * parents appear before it, which is what addEvent() requires (it
 * throws on an unknown parent, by design — see event-dag.js). An event
 * whose parent isn't in the loaded set at all (should not happen for a
 * consistently-saved DAG, but tolerated rather than crashing) is simply
 * skipped at that point in the walk, not silently included out of order.
 *
 * @param {Array<{id: string, parents: string[], payload: any}>} events
 * @returns {Array<{id: string, parents: string[], payload: any}>}
 */
export function topologicalSortForReplay(events) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const visited = new Set();
  const order = [];

  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const ev = byId.get(id);
    if (!ev) return; // referenced but not present in this loaded set — tolerated, not crashed on
    for (const p of ev.parents) visit(p);
    order.push(ev);
  }

  for (const ev of events) visit(ev.id);
  return order;
}

function openDb(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Durably persists one event. Called automatically by createPersistedLedger()'s subscription — not meant to be called directly by app code. */
export async function persistEvent(dbName, event) {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Reads every stored event back, in no particular order — callers replay via topologicalSortForReplay(). */
export async function loadAllEvents(dbName) {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Permanently deletes a domain's persisted ledger — an explicit, deliberate action (e.g. "forget this domain"), never called implicitly by loading/creating a ledger. */
export async function deleteDomainDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Creates a ledger (via the caller-supplied createLedgerFn, matching
 * ledger-bridge.js's real signature so this composes with the WASM
 * backend transparently — see that file), restores every previously-
 * persisted event for `dbName` into it, then subscribes so every
 * future genuinely-new event (from addEvent() or merge()) is
 * automatically persisted going forward. Callers do not need to
 * remember to call persistEvent() themselves anywhere in the app —
 * that was the earlier gap this closes, not merely "no function
 * existed to persist an event."
 *
 * @param {string} dbName — one database per domain, typically the domain id itself
 * @param {() => Promise<import('./ledger-bridge.js').Ledger>} createLedgerFn
 */
export async function createPersistedLedger(dbName, createLedgerFn) {
  const dag = await createLedgerFn();
  const stored = await loadAllEvents(dbName);
  const ordered = topologicalSortForReplay(stored);
  for (const ev of ordered) {
    await dag.addEvent(ev.parents, ev.payload); // recomputes id — "recompute, don't trust" applied to storage too
  }
  dag.subscribe((event) => {
    persistEvent(dbName, event).catch((err) => {
      console.error(`Failed to persist event ${event.id} for domain '${dbName}':`, err);
    });
  });
  return dag;
}
