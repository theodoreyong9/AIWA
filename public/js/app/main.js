// main.js — AIWA app entry point. Pure JavaScript, no framework,
// no build step. Loaded directly by index.html via
// <script type="module">.
//
// This demo builds a small event history by hand (genesis, cadence
// advances, accrual claims for one domain) and materializes the full
// composed economic view G(H_d, θ) from Phases 1–4 of the economics
// plan (see README.md). It is a demonstration of the pipeline end to
// end, not a real application — there is no wallet, no persistence, no
// multi-domain reconciliation UI yet (see README.md's roadmap).
//
// Note: this always runs against the pure JS ledger. The economics
// reducers (cadence.js/reward.js/scarcity.js/g.js) are plain functions
// over {id, parents, payload} event objects and a topologically-ordered
// array; they do not yet have a WASM-side equivalent wired through
// ledger-bridge.js (the WASM EventDag exposes topoOrderJson(), a JSON
// string, not the array shape these reducers expect) — that gap is
// tracked in README.md's status list, not silently worked around here.

import { createLedger } from '../core/ledger-bridge.js';
import { materializeG } from '../core/economics/g.js';

const statusEl = document.getElementById('status');
const domainsBody = document.getElementById('domains-body');
const rejectionsEl = document.getElementById('rejections');

const DOMAIN = 'demo-colony';
const theta = {
  reward: { K: 1, alpha: 1, beta: 1 },
  budgets: { [DOMAIN]: 1000 },
};

async function buildDemoHistory(ledger) {
  const genesis = await ledger.addEvent([], { type: 'genesis' });
  const c1 = await ledger.addEvent([genesis], { type: 'cadence', domain: DOMAIN, epoch: 1 });
  const c2 = await ledger.addEvent([c1], { type: 'cadence', domain: DOMAIN, epoch: 2 });
  // Committed b=10 at q0=0; by epoch 2, this has aged 2 cadence epochs.
  await ledger.addEvent([c2], { type: 'accrual', domain: DOMAIN, b: 10, q0: 0 });
  const c3 = await ledger.addEvent([c2], { type: 'cadence', domain: DOMAIN, epoch: 3 });
  // A second, later commitment: b=4 at q0=2.
  await ledger.addEvent([c3], { type: 'accrual', domain: DOMAIN, b: 4, q0: 2 });
}

function renderState(state) {
  domainsBody.innerHTML = '';
  const domains = new Set([...Object.keys(state.cadence.domains), ...Object.keys(state.balances)]);

  for (const domain of domains) {
    const epoch = state.cadence.domains[domain]?.epoch ?? 0;
    const balance = state.balances[domain] ?? 0;
    const used = state.scarcity.domains[domain]?.used ?? 0;
    const budget = state.scarcity.domains[domain]?.budget;
    const budgetLabel = budget === null || budget === undefined ? `${used} (unbounded)` : `${used} / ${budget}`;

    const row = document.createElement('tr');
    row.innerHTML = `<td>${domain}</td><td>${epoch}</td><td>${balance}</td><td>${budgetLabel}</td>`;
    domainsBody.appendChild(row);
  }

  const totalRejections = state.cadence.rejections.length + state.accrualRejections.length;
  rejectionsEl.textContent = totalRejections === 0
    ? 'No rejected transitions.'
    : `${totalRejections} rejected transition(s) — see console for details.`;
  if (totalRejections > 0) {
    console.log('Cadence rejections:', state.cadence.rejections);
    console.log('Accrual rejections:', state.accrualRejections);
  }
}

async function main() {
  const ledger = await createLedger();
  await buildDemoHistory(ledger);

  const state = materializeG(theta, ledger.topoOrder());
  renderState(state);

  statusEl.textContent = `Ledger ready — ${ledger.size} event(s) materialized.`;
}

main().catch((err) => {
  statusEl.textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
