// main.js — AIWA app entry point. Pure JavaScript, no framework,
// no build step.
//
// UI shape: bottom nav with 5 panels (Domain, Commit, Profile,
// Contacts, Parameters) plus a Domain (Earth/Mars) switcher, matching
// the target application structure. Every panel is a thin rendering
// layer over the same tested logic already built: DomainReplica (§9),
// the wallet/identity flow (§24/§26), the module registry/rank
// (§27.4.2), and cadence/reward (§10). Nothing new is invented here —
// this file only wires existing, tested functions into a real
// navigable app instead of a single flat page.

import { createLedger } from '../core/ledger-bridge.js';
import { materializeG } from '../core/economics/g.js';
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { registerDomainViaBurn } from '../core/identity/identity-flow.js';
import { initialIdentityCostState, hasIdentityCost } from '../core/identity/identity-cost.js';
import { SOLANA_NETWORKS, DEFAULT_NETWORK } from '../core/identity/solana-networks.js';
import { materializeModuleRegistry, applyModuleEvent } from '../core/modules/module-registry-reducer.js';
import { rankFromIdentityAndCadence } from '../core/modules/module-rank.js';

const WALLET_STORAGE_PREFIX = 'aiwa-wallet-';

// ── Domain replica (unchanged from the prior single-page version) ──

class DomainReplica {
  constructor(name, dag) {
    this.name = name;
    this.dag = dag;
    this.genesisId = null;
    this.lastEventId = null;
    this.lastCadenceId = null;
    this.epoch = 0;
    this.pending = [];
    this.keypair = null;
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

  commit(amount) {
    this.pending.push({ b: amount, q0: this.epoch });
  }

  async claim() {
    const claimed = this.pending;
    this.pending = [];
    for (const c of claimed) {
      const id = await this.dag.addEvent([this.lastEventId], { type: 'accrual', domain: this.name, b: c.b, q0: c.q0 });
      this.lastEventId = id;
    }
    return claimed.length;
  }

  async registerModule({ id, name, icon }) {
    const eventId = await this.dag.addEvent([this.lastEventId], {
      type: 'module-register', id, name, icon, category: 'Tools', description: '',
      codeHash: 'demo-no-code-yet', codeUrl: '', author: this.name,
      isIssuing: false, timeSensitive: null, economicConfig: null, at: this.epoch,
    });
    this.lastEventId = eventId;
    return eventId;
  }

  materialize() {
    return materializeG(theta, this.dag.topoOrder());
  }

  materializeModules() {
    return materializeModuleRegistry(this.dag.topoOrder());
  }
}

// ── Global state ────────────────────────────────────────────────────

let theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { earth: 1000, mars: 1000 } };
let linked = false;
let earth, mars;
let activeDomainName = 'earth';
let identityState = initialIdentityCostState();
let solanaWeb3 = null;

function activeReplica() {
  return activeDomainName === 'earth' ? earth : mars;
}
function currentNetwork() {
  return document.getElementById('network-select').value || DEFAULT_NETWORK;
}
function log(msg) {
  const line = document.createElement('div');
  line.textContent = `▸ ${msg}`;
  document.getElementById('log-list').prepend(line);
}
function setMsg(elId, text, kind) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `msg ${kind ?? ''}`;
}

// ── Wallet / identity helpers (unchanged logic, reused) ─────────────

function walletStorageKey(domain) {
  return `${WALLET_STORAGE_PREFIX}${domain}`;
}
async function ensureSolanaWeb3() {
  if (!solanaWeb3) solanaWeb3 = await loadSolanaWeb3();
  return solanaWeb3;
}
async function createWallet(replica, password) {
  const web3 = await ensureSolanaWeb3();
  const keypair = generateKeypair(web3);
  const record = await encryptSecretKey(keypair.secretKey, password);
  localStorage.setItem(walletStorageKey(replica.name), JSON.stringify(record));
  replica.keypair = keypair;
}
async function unlockWallet(replica, password) {
  const raw = localStorage.getItem(walletStorageKey(replica.name));
  if (!raw) throw new Error('No saved wallet for this domain — create one first.');
  const web3 = await ensureSolanaWeb3();
  const record = JSON.parse(raw);
  const secretKey = await decryptSecretKey(record, password);
  replica.keypair = keypairFromSecretKey(web3, secretKey);
}
async function registerIdentity(replica) {
  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  const lamports = parseInt(document.getElementById('burn-amount').value, 10);
  if (!Number.isInteger(lamports) || lamports <= 0) {
    return setMsg('profile-msg', 'Enter a positive lamport amount — any amount is accepted, there is no minimum.', 'error');
  }
  const solAmount = lamports / 1_000_000_000;
  const confirmed = confirm(
    `Burn ${lamports} lamports (${solAmount} SOL) on ${config.label}?\n\n` +
      `This is sent to the network's incinerator address and is irreversible.\n` +
      (config.isRealCost ? 'This is REAL money on mainnet.' : 'This is free devnet SOL — no real cost, testing only.')
  );
  if (!confirmed) return;

  const web3 = await ensureSolanaWeb3();
  setMsg('profile-msg', 'Broadcasting burn transaction…');
  try {
    const result = await registerDomainViaBurn(web3, replica.keypair, identityState, { domain: replica.name, lamports, network });
    identityState = result.state;
    setMsg('profile-msg', `✅ Registered — tx ${result.signature.slice(0, 12)}…`, 'success');
    log(`[${replica.name}] identity registered via burn — tx ${result.signature}`);
  } catch (err) {
    setMsg('profile-msg', `❌ ${err.message}`, 'error');
    log(`[${replica.name}] identity registration failed: ${err.message}`);
  }
  renderAll();
}

// ── Panel renderers ───────────────────────────────────────────────

function renderDomainSwitcher() {
  document.querySelectorAll('.domain-switch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.domain === activeDomainName);
  });
}

function renderDomainPanel() {
  const replica = activeReplica();
  const state = replica.materialize();
  const domain = replica.name;
  const epoch = state.cadence.domains[domain]?.epoch ?? 0;
  const balance = state.balances[domain] ?? 0;
  const used = state.scarcity.domains[domain]?.used ?? 0;
  const budget = state.scarcity.domains[domain]?.budget;
  const budgetLabel = budget === null || budget === undefined ? `${used} (unbounded)` : `${used} / ${budget}`;
  const registered = hasIdentityCost(identityState, domain);

  document.getElementById('domain-title').textContent = `Domain — ${domain === 'earth' ? '🌍 Earth' : '🔴 Mars'}`;
  document.getElementById('d-epoch').textContent = epoch;
  document.getElementById('d-balance').textContent = balance;
  document.getElementById('d-budget').textContent = budgetLabel;
  document.getElementById('d-events').textContent = replica.dag.size;
  document.getElementById('d-identity').textContent = registered
    ? `✅ burned ${identityState.registered[domain].burnedLamports} lamports`
    : replica.keypair ? '🔓 wallet ready, not registered' : '🔒 no wallet';

  renderDesktop(replica, state);
}

function renderDesktop(replica, gState) {
  const moduleRegistry = replica.materializeModules();
  const modules = Object.values(moduleRegistry.modules);
  const iconsEl = document.getElementById('desktop-icons');
  const emptyEl = document.getElementById('desktop-empty');

  if (modules.length === 0) {
    emptyEl.style.display = 'block';
    iconsEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';

  const ranked = modules
    .map((m) => ({ ...m, rank: rankFromIdentityAndCadence(identityState, gState.cadence, m.author, theta.reward) }))
    .sort((a, b) => b.rank - a.rank);

  iconsEl.innerHTML = '';
  for (const m of ranked) {
    const tile = document.createElement('div');
    tile.className = `icon-tile ${m.auditStatus === 'red-listed' ? 'red-listed' : m.auditStatus === 'unaudited' ? 'unaudited' : ''}`;
    tile.innerHTML = `<div class="icon-glyph">${m.icon || '⬡'}</div><div>${m.name}</div>`;
    tile.title = `rank: ${m.rank.toFixed(2)} · ${m.auditStatus}`;
    iconsEl.appendChild(tile);
  }
}

function renderCommitPanel() {
  const replica = activeReplica();
  const state = replica.materialize();
  const registered = hasIdentityCost(identityState, replica.name);

  document.getElementById('commit-title').textContent = `Commit — ${replica.name === 'earth' ? 'Earth' : 'Mars'}`;
  document.getElementById('c-pending').textContent = replica.pending.length;
  document.getElementById('commit-btn').disabled = !registered;
  document.getElementById('claim-btn').disabled = !registered;
  document.getElementById('commit-gated-hint').style.display = registered ? 'none' : 'block';
  void state;
}

function renderProfilePanel() {
  const replica = activeReplica();
  const registered = hasIdentityCost(identityState, replica.name);
  document.getElementById('profile-title').textContent = `Profile — ${replica.name === 'earth' ? 'Earth' : 'Mars'}`;
  document.getElementById('profile-identity-status').textContent = registered
    ? `✅ Registered — burned ${identityState.registered[replica.name].burnedLamports} lamports`
    : replica.keypair
      ? `🔓 Wallet ready (${replica.keypair.publicKey.toBase58().slice(0, 8)}…) — not registered`
      : '🔒 No wallet';
  document.getElementById('burn-btn').disabled = !replica.keypair || registered;
}

function renderContactsPanel() {
  const replica = activeReplica();
  const state = replica.materialize();
  document.getElementById('contacts-domain-name').textContent = replica.name === 'earth' ? 'Earth' : 'Mars';
  const others = Object.keys(state.cadence.domains).filter((d) => d !== replica.name);
  const listEl = document.getElementById('contacts-list');
  const emptyEl = document.getElementById('contacts-empty');
  if (others.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = others
    .map((d) => `<div class="contact-row"><span>${d === 'earth' ? '🌍' : '🔴'} ${d}</span><span>epoch ${state.cadence.domains[d].epoch}</span></div>`)
    .join('');
}

function renderParametersPanel() {
  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  const warnEl = document.getElementById('network-warning');
  warnEl.className = config.isRealCost ? 'mainnet' : '';
  warnEl.innerHTML = config.isRealCost
    ? '⚠️ Mainnet mode: burns use <strong>real SOL</strong> and are <strong>irreversible</strong>.'
    : 'Devnet mode: burns use free faucet SOL and provide <strong>no real Sybil resistance</strong> (§24).';

  document.getElementById('param-K').value = theta.reward.K;
  document.getElementById('param-alpha').value = theta.reward.alpha;
  document.getElementById('param-beta').value = theta.reward.beta;

  document.getElementById('link-status').textContent = linked ? '🟢 Up' : '🔴 Down (partitioned)';
  document.getElementById('link-status').className = linked ? 'up' : 'down';
  document.getElementById('toggle-link-btn').textContent = linked ? 'Cut link' : 'Restore link';
  document.getElementById('reconcile-btn').disabled = !linked;
}

function renderAll() {
  renderDomainSwitcher();
  renderDomainPanel();
  renderCommitPanel();
  renderProfilePanel();
  renderContactsPanel();
  renderParametersPanel();
}

// ── Reconcile (unchanged logic) ──────────────────────────────────────

async function reconcile() {
  earth.dag.merge(mars.dag);
  mars.dag.merge(earth.dag);

  const marsBalanceFromEarth = earth.materialize().balances.mars ?? 0;
  const marsBalanceFromMars = mars.materialize().balances.mars ?? 0;
  const earthBalanceFromMars = mars.materialize().balances.earth ?? 0;
  const earthBalanceFromEarth = earth.materialize().balances.earth ?? 0;
  const converged = marsBalanceFromEarth === marsBalanceFromMars && earthBalanceFromMars === earthBalanceFromEarth;

  log(`Reconciled (${earth.dag.size} events on both sides now).`);
  log(converged ? 'Convergence check passed: both replicas agree (§9).' : 'Convergence check FAILED — bug.');
  renderAll();
}

// ── Boot ──────────────────────────────────────────────────────────

async function main() {
  earth = new DomainReplica('earth', await createLedger());
  const genesisId = await earth.dag.addEvent([], { type: 'genesis' });
  earth.genesisId = genesisId;
  earth.lastEventId = genesisId;

  mars = new DomainReplica('mars', await createLedger());
  const marsGenesisId = await mars.dag.addEvent([], { type: 'genesis' });
  mars.genesisId = marsGenesisId;
  mars.lastEventId = marsGenesisId;

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.app-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
    });
  });

  // Domain switcher
  document.querySelectorAll('.domain-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDomainName = btn.dataset.domain;
      renderAll();
    });
  });

  document.getElementById('advance-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    await replica.advanceCadence();
    log(`[${replica.name}] cadence → epoch ${replica.epoch}`);
    renderAll();
  });

  document.getElementById('commit-btn').addEventListener('click', () => {
    const replica = activeReplica();
    replica.commit(10);
    log(`[${replica.name}] committed b=10 at q0=${replica.epoch} (not yet on the ledger)`);
    renderAll();
  });

  document.getElementById('claim-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const n = await replica.claim();
    log(n > 0 ? `[${replica.name}] claimed ${n} commitment(s).` : `[${replica.name}] nothing to claim.`);
    renderAll();
  });

  document.getElementById('mod-register-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    if (!hasIdentityCost(identityState, replica.name)) {
      return setMsg('mod-msg', 'Register an identity first (Profile tab).', 'error');
    }
    const id = document.getElementById('mod-id').value.trim();
    const icon = document.getElementById('mod-icon').value.trim() || '⬡';
    const name = document.getElementById('mod-name').value.trim() || id;
    if (!id) return setMsg('mod-msg', 'Enter a module id.', 'error');
    try {
      await replica.registerModule({ id, name, icon });
      setMsg('mod-msg', `✅ Registered '${id}'.`, 'success');
      log(`[${replica.name}] module '${id}' registered`);
    } catch (err) {
      setMsg('mod-msg', `❌ ${err.message}`, 'error');
    }
    renderAll();
  });

  document.getElementById('wallet-create-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const pw = document.getElementById('wallet-pw').value;
    if (!pw) return setMsg('profile-msg', 'Enter a password first.', 'error');
    try {
      await createWallet(replica, pw);
      setMsg('profile-msg', `Wallet created: ${replica.keypair.publicKey.toBase58()}`, 'success');
      log(`[${replica.name}] wallet created`);
    } catch (err) {
      setMsg('profile-msg', `❌ ${err.message}`, 'error');
    }
    renderAll();
  });

  document.getElementById('wallet-unlock-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const pw = document.getElementById('wallet-pw').value;
    try {
      await unlockWallet(replica, pw);
      setMsg('profile-msg', `Wallet unlocked: ${replica.keypair.publicKey.toBase58()}`, 'success');
      log(`[${replica.name}] wallet unlocked`);
    } catch (err) {
      setMsg('profile-msg', `❌ ${err.message}`, 'error');
    }
    renderAll();
  });

  document.getElementById('burn-btn').addEventListener('click', () => {
    const replica = activeReplica();
    if (!replica.keypair) return setMsg('profile-msg', 'Create or unlock a wallet first.', 'error');
    registerIdentity(replica);
  });

  document.getElementById('network-select').addEventListener('change', renderAll);

  ['param-K', 'param-alpha', 'param-beta'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      theta = {
        ...theta,
        reward: {
          K: parseFloat(document.getElementById('param-K').value) || 0,
          alpha: parseFloat(document.getElementById('param-alpha').value) || 0,
          beta: parseFloat(document.getElementById('param-beta').value) || 0,
        },
      };
      renderAll();
    });
  });

  document.getElementById('toggle-link-btn').addEventListener('click', () => {
    linked = !linked;
    log(linked ? 'Link restored.' : 'Link cut — domains now partitioned.');
    renderAll();
  });

  document.getElementById('reconcile-btn').addEventListener('click', () => {
    if (linked) reconcile();
  });

  renderAll();
  document.getElementById('status').textContent = 'Ready — two independent domains, partitioned by default.';
}

main().catch((err) => {
  document.getElementById('status').textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
