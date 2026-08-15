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
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { registerDomainViaBurn } from '../core/identity/identity-flow.js';
import { initialIdentityCostState, hasIdentityCost } from '../core/identity/identity-cost.js';
import { SOLANA_NETWORKS, DEFAULT_NETWORK } from '../core/identity/solana-networks.js';

const WALLET_STORAGE_PREFIX = 'aiwa-wallet-';

const statusEl = document.getElementById('status');
const linkStatusEl = document.getElementById('link-status');
const toggleLinkBtn = document.getElementById('toggle-link-btn');
const reconcileBtn = document.getElementById('reconcile-btn');
const logListEl = document.getElementById('log-list');
const networkSelectEl = document.getElementById('network-select');
const networkWarningEl = document.getElementById('network-warning');

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
    this.keypair = null; // set once a wallet is created/unlocked
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
let identityState = initialIdentityCostState();
let solanaWeb3 = null; // loaded lazily on first wallet action

function currentNetwork() {
  return networkSelectEl.value || DEFAULT_NETWORK;
}

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

  // Identity/gating (§24/§26): Commit and Claim only make economic
  // sense once a domain has paid a real identity cost — see the
  // "Identity cost" section of README.md for the full rationale.
  const registered = hasIdentityCost(identityState, domain);
  const identityStatusEl = document.getElementById(`${domain}-identity-status`);
  identityStatusEl.textContent = registered
    ? `✅ Registered — burned ${identityState.registered[domain].burnedLamports} lamports`
    : replica.keypair
      ? `🔓 Wallet ready (${replica.keypair.publicKey.toBase58().slice(0, 8)}…) — not registered`
      : '🔒 No wallet';
  identityStatusEl.className = `identity-status ${registered ? 'registered' : 'unregistered'}`;

  const burnBtn = document.querySelector(`.burn-btn[data-domain="${domain}"]`);
  burnBtn.disabled = !replica.keypair || registered;

  document.querySelector(`.commit-btn[data-domain="${domain}"]`).disabled = !registered;
  document.querySelector(`.claim-btn[data-domain="${domain}"]`).disabled = !registered;
  document.getElementById(`${domain}-gated-hint`).style.display = registered ? 'none' : 'block';
}

function renderAll() {
  renderDomain(earth);
  renderDomain(mars);
  linkStatusEl.textContent = linked ? '🟢 Up' : '🔴 Down (partitioned)';
  linkStatusEl.className = linked ? 'up' : 'down';
  toggleLinkBtn.textContent = linked ? 'Cut link' : 'Restore link';
  reconcileBtn.disabled = !linked;

  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  networkWarningEl.className = config.isRealCost ? 'mainnet' : '';
  networkWarningEl.innerHTML = config.isRealCost
    ? '⚠️ Mainnet mode: burns use <strong>real SOL</strong> and are <strong>irreversible</strong>. Real money.'
    : 'Devnet mode: burns use free faucet SOL and provide <strong>no real Sybil resistance</strong> (§24). Use this to test the mechanism only.';
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

function walletStorageKey(domain) {
  return `${WALLET_STORAGE_PREFIX}${domain}`;
}

async function ensureSolanaWeb3() {
  if (!solanaWeb3) {
    solanaWeb3 = await loadSolanaWeb3();
  }
  return solanaWeb3;
}

function setIdentityMsg(domain, text, kind) {
  const el = document.getElementById(`${domain}-identity-msg`);
  el.textContent = text;
  el.className = `identity-msg ${kind ?? ''}`;
}

/**
 * Creates a brand-new wallet for `replica`'s domain, encrypts it with
 * the given password, and persists the encrypted record to
 * localStorage — a real, working key, not a placeholder. The plaintext
 * secret key never touches storage; only encryptSecretKey()'s output
 * does.
 */
async function createWallet(replica, password) {
  const web3 = await ensureSolanaWeb3();
  const keypair = generateKeypair(web3);
  const record = await encryptSecretKey(keypair.secretKey, password);
  localStorage.setItem(walletStorageKey(replica.name), JSON.stringify(record));
  replica.keypair = keypair;
}

/** Unlocks a previously-created wallet from localStorage with the given password. */
async function unlockWallet(replica, password) {
  const raw = localStorage.getItem(walletStorageKey(replica.name));
  if (!raw) throw new Error('No saved wallet for this domain — create one first.');
  const web3 = await ensureSolanaWeb3();
  const record = JSON.parse(raw);
  const secretKey = await decryptSecretKey(record, password);
  replica.keypair = keypairFromSecretKey(web3, secretKey);
}

/**
 * Registers `replica`'s domain by burning a user-chosen amount of
 * lamports on the currently-selected network — no minimum imposed here
 * (see identity-cost.js: any positive burn is a real cost and counts
 * as c_id; a fixed floor was removed on purpose, not an oversight).
 * This sends a real transaction once deployed and run in an actual
 * browser — see identity-flow.js and README.md's "Identity cost"
 * section for exactly what is and isn't verified in this development
 * sandbox.
 */
async function registerIdentity(replica) {
  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  const amountInput = document.getElementById(`${replica.name}-burn-amount`);
  const lamports = parseInt(amountInput.value, 10);
  if (!Number.isInteger(lamports) || lamports <= 0) {
    return setIdentityMsg(replica.name, 'Enter a positive lamport amount — any amount is accepted, there is no minimum.', 'error');
  }
  const solAmount = lamports / 1_000_000_000;

  const confirmed = confirm(
    `Burn ${lamports} lamports (${solAmount} SOL) on ${config.label}?\n\n` +
      `This is sent to the network's incinerator address and is irreversible.\n` +
      (config.isRealCost ? 'This is REAL money on mainnet.' : 'This is free devnet SOL — no real cost, testing only.')
  );
  if (!confirmed) return;

  const web3 = await ensureSolanaWeb3();
  setIdentityMsg(replica.name, 'Broadcasting burn transaction…');
  try {
    const result = await registerDomainViaBurn(web3, replica.keypair, identityState, {
      domain: replica.name,
      lamports,
      network,
    });
    identityState = result.state;
    setIdentityMsg(replica.name, `✅ Registered — tx ${result.signature.slice(0, 12)}…`, 'success');
    log(`[${replica.name}] identity registered via burn — tx ${result.signature}`);
  } catch (err) {
    setIdentityMsg(replica.name, `❌ ${err.message}`, 'error');
    log(`[${replica.name}] identity registration failed: ${err.message}`);
  }
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

  document.querySelectorAll('.wallet-create-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const replica = domain === 'earth' ? earth : mars;
      const pwInput = document.getElementById(`${domain}-wallet-pw`);
      if (!pwInput.value) return setIdentityMsg(domain, 'Enter a password first.', 'error');
      try {
        await createWallet(replica, pwInput.value);
        setIdentityMsg(domain, `Wallet created: ${replica.keypair.publicKey.toBase58()}`, 'success');
        log(`[${domain}] wallet created — ${replica.keypair.publicKey.toBase58()}`);
      } catch (err) {
        setIdentityMsg(domain, `❌ ${err.message}`, 'error');
      }
      renderAll();
    });
  });

  document.querySelectorAll('.wallet-unlock-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const replica = domain === 'earth' ? earth : mars;
      const pwInput = document.getElementById(`${domain}-wallet-pw`);
      try {
        await unlockWallet(replica, pwInput.value);
        setIdentityMsg(domain, `Wallet unlocked: ${replica.keypair.publicKey.toBase58()}`, 'success');
        log(`[${domain}] wallet unlocked — ${replica.keypair.publicKey.toBase58()}`);
      } catch (err) {
        setIdentityMsg(domain, `❌ ${err.message}`, 'error');
      }
      renderAll();
    });
  });

  document.querySelectorAll('.burn-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const domain = btn.dataset.domain;
      const replica = domain === 'earth' ? earth : mars;
      if (!replica.keypair) return setIdentityMsg(domain, 'Create or unlock a wallet first.', 'error');
      registerIdentity(replica);
    });
  });

  networkSelectEl.addEventListener('change', renderAll);

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
