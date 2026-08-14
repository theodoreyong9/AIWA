// main.js — AIWA app entry point. Pure JavaScript, no framework,
// no build step.
//
// This demo is deliberately built around the property the whitepaper
// centers on (§9), not just a balance display: two domains, Earth and
// Mars, each run their OWN independent ledger (their own EventDag
// instance) and accrue value locally with zero coordination — "Link:
// Down" is the default state, not an error state, because arbitrarily
// long partition is AIWA's baseline assumption, not an edge case.
// Reconciling merges both histories (set union, §8) and re-materializes
// G on each side; the demo explicitly compares both sides' resulting
// view of the SAME domain after merge and logs whether they match,
// rather than just asserting convergence in prose.
//
// Note: this always runs the pure JS ledger for both domains — see
// README.md's status list for the still-open WASM-in-browser step.

import { createLedger } from '../core/ledger-bridge.js';
import { materializeG } from '../core/economics/g.js';

const statusEl = document.getElementById('status');
const linkStatusEl = document.getElementById('link-status');
const toggleLinkBtn = document.getElementById('toggle-link-btn');
const reconcileBtn = document.getElementById('reconcile-btn');
const logListEl = document.getElementById('log-list');

const theta = {
  reward: { K: 1, alpha: 1, beta: 1 },
  budgets: { earth: 1000, mars: 1000 },
};

class DomainReplica {
  constructor(name, dag) {
    this.name = name;
    this.dag = dag;
    this.genesisId = null;
    this.lastEventId = null;
    this.lastCadenceId = null;
    this.epoch = 0;
    this.pending = []; // [{ b, q0 }] — committed but not yet claimed
  }

  async advanceCadence() {
    const nextEpoch = this.epoch + 1;
    const parents = [...new Set([this.lastCadenceId ?? this.genesisId, this.lastEventId])];
    const id = await this.dag.addEvent(parents, { type: 'cadence', domain: this.name, epoch: nextEpoch });
    this.lastCadenceId = id;
    this.lastEventId = id;
    this.epoch = nextEpoch;
    return id;
  }

  /**
   * Records a resource commitment at the CURRENT epoch — client-side
   * only, no ledger event yet. q0 is fixed now; it does not matter how
   * many cadence epochs pass before this is claimed — that's exactly
   * the point of q0 being a fixed acceptance epoch (Definition 10.1).
   */
  commit(amount) {
    this.pending.push({ b: amount, q0: this.epoch });
  }

  /**
   * Posts all pending commitments to the ledger NOW. Each accrual
   * event's position in the DAG (parent = whatever was last known) is
   * what lets it see however many cadence epochs have elapsed since its
   * fixed q0 — reward requires this later posting, it is never
   * instantaneous with commit().
   */
  async claim() {
    const claimed = this.pending;
    this.pending = [];
    for (const c of claimed) {
      const id = await this.dag.addEvent([this.lastEventId], { type: 'accrual', domain: this.name, b: c.b, q0: c.q0 });
      this.lastEventId = id;
    }
    return claimed.length;
  }

  materialize() {
    return materializeG(theta, this.dag.topoOrder());
  }
}

let linked = false;
let earth, mars;

function log(msg) {
  const line = document.createElement('div');
  line.textContent = `▸ ${msg}`;
  logListEl.prepend(line);
}

function renderDomain(replica) {
  const state = replica.materialize();
  const domain = replica.name;
  const epoch = state.cadence.domains[domain]?.epoch ?? 0;
  const balance = state.balances[domain] ?? 0;
  const used = state.scarcity.domains[domain]?.used ?? 0;
  const budget = state.scarcity.domains[domain]?.budget;
  const budgetLabel = budget === null || budget === undefined ? `${used} (unbounded)` : `${used} / ${budget}`;
  const totalRejections = state.cadence.rejections.length + state.accrualRejections.length;

  document.getElementById(`${domain}-epoch`).textContent = epoch;
  document.getElementById(`${domain}-balance`).textContent = balance;
  document.getElementById(`${domain}-budget`).textContent = budgetLabel;
  document.getElementById(`${domain}-events`).textContent = replica.dag.size;
  document.getElementById(`${domain}-pending`).textContent = replica.pending.length;
  document.getElementById(`${domain}-rejections`).textContent =
    totalRejections === 0 ? '' : `${totalRejections} rejected transition(s) — see console.`;
  if (totalRejections > 0) {
    console.log(`[${domain}] cadence rejections:`, state.cadence.rejections);
    console.log(`[${domain}] accrual rejections:`, state.accrualRejections);
  }
}

function renderAll() {
  renderDomain(earth);
  renderDomain(mars);
  linkStatusEl.textContent = linked ? '🟢 Up' : '🔴 Down (partitioned)';
  linkStatusEl.className = linked ? 'up' : 'down';
  toggleLinkBtn.textContent = linked ? 'Cut link' : 'Restore link';
  reconcileBtn.disabled = !linked;
}

async function reconcile() {
  // Set union, both directions — commutative, idempotent, associative
  // (§8). After this, both replicas' local DAGs are identical.
  earth.dag.merge(mars.dag);
  mars.dag.merge(earth.dag);

  // §9's determinism claim, checked rather than asserted: both replicas
  // now materialize the SAME domain from their own (now-identical)
  // local event set. If G is truly a deterministic function of the
  // converged set alone, these two independently-computed numbers must
  // match exactly.
  const marsBalanceFromEarth = earth.materialize().balances.mars ?? 0;
  const marsBalanceFromMars = mars.materialize().balances.mars ?? 0;
  const earthBalanceFromMars = mars.materialize().balances.earth ?? 0;
  const earthBalanceFromEarth = earth.materialize().balances.earth ?? 0;

  const converged = marsBalanceFromEarth === marsBalanceFromMars && earthBalanceFromMars === earthBalanceFromEarth;

  log(`Reconciled (${earth.dag.size} events on both sides now).`);
  log(
    converged
      ? `Convergence check passed: both replicas agree on both domains' balances (§9).`
      : `Convergence check FAILED — Earth sees Mars=${marsBalanceFromEarth}, Mars sees itself=${marsBalanceFromMars}. This would be a real bug.`
  );

  renderAll();
}

async function main() {
  earth = new DomainReplica('earth', await createLedger());
  const genesisId = await earth.dag.addEvent([], { type: 'genesis' });
  earth.genesisId = genesisId;
  earth.lastEventId = genesisId;

  // Mars gets its own independent ledger instance, seeded with the SAME
  // genesis payload — content-addressed (§8.1), so it produces the
  // identical id without any coordination. This is what lets the two
  // replicas share a common ancestor to merge against later.
  mars = new DomainReplica('mars', await createLedger());
  const marsGenesisId = await mars.dag.addEvent([], { type: 'genesis' });
  mars.genesisId = marsGenesisId;
  mars.lastEventId = marsGenesisId;

  document.querySelectorAll('.advance-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const replica = btn.dataset.domain === 'earth' ? earth : mars;
      await replica.advanceCadence();
      log(`[${replica.name}] cadence → epoch ${replica.epoch}`);
      renderAll();
    });
  });

  document.querySelectorAll('.commit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const replica = btn.dataset.domain === 'earth' ? earth : mars;
      replica.commit(10);
      log(`[${replica.name}] committed b=10 at q0=${replica.epoch} (not yet on the ledger)`);
      renderAll();
    });
  });

  document.querySelectorAll('.claim-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const replica = btn.dataset.domain === 'earth' ? earth : mars;
      const n = await replica.claim();
      log(n > 0 ? `[${replica.name}] claimed ${n} commitment(s) — posted to ledger.` : `[${replica.name}] nothing to claim.`);
      renderAll();
    });
  });

  toggleLinkBtn.addEventListener('click', () => {
    linked = !linked;
    log(linked ? 'Link restored.' : 'Link cut — domains now partitioned.');
    renderAll();
  });

  reconcileBtn.addEventListener('click', () => {
    if (!linked) return;
    reconcile();
  });

  renderAll();
  statusEl.textContent = 'Ready — two independent domains, partitioned by default.';
}

main().catch((err) => {
  statusEl.textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
