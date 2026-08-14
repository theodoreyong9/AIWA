// main.js — AIWA app entry point. Pure JavaScript, no framework,
// no build step. Loaded directly by index.html via
// <script type="module">.

import { createLedger } from '../core/ledger-bridge.js';

const statusEl = document.getElementById('status');

async function main() {
  const ledger = await createLedger();

  // Minimal demo: a single root event, to verify the DAG works
  // end to end once deployed.
  const rootId = await ledger.addEvent([], { type: 'genesis' });

  const state = ledger.materialize(
    (acc, ev) => ({ count: acc.count + 1, lastId: ev.id }),
    { count: 0, lastId: null }
  );

  statusEl.textContent = `Ledger ready — ${state.count} event(s), root ${rootId.slice(0, 8)}…`;
}

main().catch((err) => {
  statusEl.textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
