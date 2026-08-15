// main.js — AIWA app entry point. Pure JavaScript, no framework, no
// build step.
//
// Real app structure, per the user's spec: an empty Desktop is the
// default/home screen (icons of PINNED plugins only); five bottom-nav
// buttons open overlay screens on top of it — Domain (plugin/theme
// catalog for the active domain, add/register), Profile (identity +
// activated-plugin settings), Commit (burn identity cost + submit
// plugin code), Contacts (known domains, searchable), Parameters
// (wallets, claim, network, θ, link). Tapping the domain switcher or an
// already-active nav button returns to the Desktop.
//
// Every screen is a thin rendering pass over already-tested logic —
// DomainReplica, the wallet/identity flow, materializeG,
// materializeModuleRegistry, module-rank, module-submission. Desktop
// "pinning" (which registered plugins actually show as icons) is the
// one genuinely new, local-only concept here: a personal display
// preference, not replicated ledger state, stored in localStorage per
// domain.

import { createLedger } from '../core/ledger-bridge.js';
import { materializeG } from '../core/economics/g.js';
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { registerDomainViaBurn } from '../core/identity/identity-flow.js';
import { initialIdentityCostState, hasIdentityCost } from '../core/identity/identity-cost.js';
import { SOLANA_NETWORKS, DEFAULT_NETWORK } from '../core/identity/solana-networks.js';
import { materializeModuleRegistry } from '../core/modules/module-registry-reducer.js';
import { rankFromIdentityAndCadence } from '../core/modules/module-rank.js';
import { computeModuleHash } from '../core/modules/module-hash.js';
import { buildSubmissionEvent, validateSubmission, initialSubmissionState, recordNonce } from '../core/modules/module-submission.js';

const WALLET_STORAGE_PREFIX = 'aiwa-wallet-';
const DESKTOP_PIN_PREFIX = 'aiwa-desktop-pins-';

// ── Domain replica ──────────────────────────────────────────────────

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

  async foldSubmission(event, isUpdate) {
    const payload = isUpdate
      ? { type: 'module-update', id: event.moduleId, codeHash: event.codeHash, codeUrl: event.codeUrl }
      : {
          type: 'module-register', id: event.moduleId, name: event.name, icon: event.icon, category: event.category,
          description: event.description, codeHash: event.codeHash, codeUrl: event.codeUrl, author: event.signerPubkey,
          isIssuing: event.isIssuing, timeSensitive: event.timeSensitive, economicConfig: event.economicConfig, at: this.epoch,
        };
    const eventId = await this.dag.addEvent([this.lastEventId], payload);
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
let submissionState = initialSubmissionState();
let solanaWeb3 = null;

function activeReplica() { return activeDomainName === 'earth' ? earth : mars; }
function currentNetwork() { return document.getElementById('network-select').value || DEFAULT_NETWORK; }
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

// ── Desktop pin state (local-only, not replicated — a display
// preference, not ledger state) ─────────────────────────────────────

function pinnedIds(domain) {
  try { return JSON.parse(localStorage.getItem(DESKTOP_PIN_PREFIX + domain) || '[]'); } catch { return []; }
}
function setPinned(domain, ids) {
  localStorage.setItem(DESKTOP_PIN_PREFIX + domain, JSON.stringify(ids));
}
function togglePin(domain, id) {
  const ids = pinnedIds(domain);
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
  setPinned(domain, ids);
}

// ── Wallet / identity (unchanged logic) ──────────────────────────────

function walletStorageKey(domain) { return `${WALLET_STORAGE_PREFIX}${domain}`; }
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
    return setMsg('burn-msg', 'Enter a positive lamport amount — any amount is accepted, there is no minimum.', 'error');
  }
  const solAmount = lamports / 1_000_000_000;
  const confirmed = confirm(
    `Burn ${lamports} lamports (${solAmount} SOL) on ${config.label}?\n\n` +
      `This is sent to the network's incinerator address and is irreversible.\n` +
      (config.isRealCost ? 'This is REAL money on mainnet.' : 'This is free devnet SOL — no real cost, testing only.')
  );
  if (!confirmed) return;

  const web3 = await ensureSolanaWeb3();
  setMsg('burn-msg', 'Broadcasting burn transaction…');
  try {
    const result = await registerDomainViaBurn(web3, replica.keypair, identityState, { domain: replica.name, lamports, network });
    identityState = result.state;
    setMsg('burn-msg', `✅ Registered — tx ${result.signature.slice(0, 12)}…`, 'success');
    log(`[${replica.name}] identity registered via burn — tx ${result.signature}`);
  } catch (err) {
    setMsg('burn-msg', `❌ ${err.message}`, 'error');
  }
  renderAll();
}

// ── Screen navigation ────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-screen="${name}"]`);
  if (btn) btn.classList.add('active');
}
function showDesktop() {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('screen-desktop').classList.add('active');
}

// ── Renderers ─────────────────────────────────────────────────────

function renderDomainSwitcher() {
  document.querySelectorAll('.domain-switch-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.domain === activeDomainName));
}

function renderDesktop() {
  const replica = activeReplica();
  const gState = replica.materialize();
  const domain = replica.name;
  document.getElementById('desktop-title').textContent = `Desktop — ${domain === 'earth' ? 'Earth' : 'Mars'}`;
  document.getElementById('d-epoch').textContent = gState.cadence.domains[domain]?.epoch ?? 0;
  document.getElementById('d-balance').textContent = gState.balances[domain] ?? 0;

  const registry = replica.materializeModules();
  const pinned = new Set(pinnedIds(domain));
  const pinnedModules = Object.values(registry.modules)
    .filter((m) => pinned.has(m.id))
    .map((m) => ({ ...m, rank: rankFromIdentityAndCadence(identityState, gState.cadence, m.author, theta.reward) }))
    .sort((a, b) => b.rank - a.rank);

  const iconsEl = document.getElementById('desktop-icons');
  const emptyEl = document.getElementById('desktop-empty');
  if (pinnedModules.length === 0) {
    emptyEl.style.display = 'block';
    iconsEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  iconsEl.innerHTML = pinnedModules
    .map((m) => `<div class="icon-tile" title="rank ${m.rank.toFixed(2)}"><div class="icon-glyph">${m.icon || '⬡'}</div><div>${m.name}</div></div>`)
    .join('');
}

function renderDomainScreen() {
  const replica = activeReplica();
  const gState = replica.materialize();
  const registry = replica.materializeModules();
  const pinned = new Set(pinnedIds(replica.name));
  const modules = Object.values(registry.modules).map((m) => ({
    ...m,
    rank: rankFromIdentityAndCadence(identityState, gState.cadence, m.author, theta.reward),
  })).sort((a, b) => b.rank - a.rank);

  const listEl = document.getElementById('catalog-list');
  const emptyEl = document.getElementById('catalog-empty');
  if (modules.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';
  for (const m of modules) {
    const row = document.createElement('div');
    row.className = 'catalog-row';
    const isPinned = pinned.has(m.id);
    row.innerHTML = `<div class="catalog-icon">${m.icon || '⬡'}</div><div class="catalog-info"><div class="catalog-name">${m.name}</div><div class="catalog-meta">rank ${m.rank.toFixed(2)} · ${m.auditStatus}</div></div><button data-id="${m.id}">${isPinned ? '− Remove' : '+ Add'}</button>`;
    row.querySelector('button').addEventListener('click', () => {
      togglePin(replica.name, m.id);
      renderAll();
    });
    listEl.appendChild(row);
  }
}

function renderProfileScreen() {
  const replica = activeReplica();
  const registered = hasIdentityCost(identityState, replica.name);
  document.getElementById('profile-title').textContent = `Profile — ${replica.name === 'earth' ? 'Earth' : 'Mars'}`;
  document.getElementById('profile-identity-status').textContent = registered
    ? `✅ burned ${identityState.registered[replica.name].burnedLamports} lamports`
    : replica.keypair ? '🔓 wallet ready, not registered' : '🔒 no identity';
  document.getElementById('profile-network').textContent = currentNetwork();

  const registry = replica.materializeModules();
  const pinned = new Set(pinnedIds(replica.name));
  const active = Object.values(registry.modules).filter((m) => pinned.has(m.id));
  const listEl = document.getElementById('profile-active-list');
  const emptyEl = document.getElementById('profile-active-empty');
  if (active.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = active
    .map((m) => `<div class="stat-row"><span>${m.icon || '⬡'} ${m.name} (${currentNetwork()})</span><span>${m.auditStatus}</span></div>`)
    .join('');
}

function renderCommitScreen() {
  const replica = activeReplica();
  document.getElementById('commit-burn-title').textContent = `🔥 Burn — ${replica.name === 'earth' ? 'Earth' : 'Mars'}`;
  document.getElementById('burn-btn').disabled = !replica.keypair || hasIdentityCost(identityState, replica.name);
}

function renderContactsScreen() {
  const replica = activeReplica();
  const state = replica.materialize();
  document.getElementById('contacts-domain-name').textContent = replica.name === 'earth' ? 'Earth' : 'Mars';
  const query = (document.getElementById('contacts-search').value || '').toLowerCase();
  const others = Object.keys(state.cadence.domains).filter((d) => d !== replica.name && d.toLowerCase().includes(query));
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

function renderParametersScreen() {
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

  const replica = activeReplica();
  const registered = hasIdentityCost(identityState, replica.name);
  document.getElementById('c-pending').textContent = replica.pending.length;
  document.getElementById('commit-action-btn').disabled = !registered;
  document.getElementById('claim-btn').disabled = !registered;
  document.getElementById('claim-gated-hint').style.display = registered ? 'none' : 'block';
}

function renderAll() {
  renderDomainSwitcher();
  renderDesktop();
  renderDomainScreen();
  renderProfileScreen();
  renderCommitScreen();
  renderContactsScreen();
  renderParametersScreen();
}

// ── Reconcile ───────────────────────────────────────────────────────

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

// ── Submission (real pipeline: sign, hash-check, validate, fold) ────

async function submitPluginCode(replica) {
  if (!replica.keypair) return setMsg('submit-msg', 'Create or unlock a wallet first (Parameters).', 'error');
  const moduleId = document.getElementById('submit-id').value.trim();
  const codeUrl = document.getElementById('submit-url').value.trim();
  const code = document.getElementById('submit-code').value;
  if (!moduleId || !codeUrl || !code.trim()) return setMsg('submit-msg', 'Fill in id, URL, and code.', 'error');

  setMsg('submit-msg', 'Hashing and signing…');
  const codeHash = await computeModuleHash(code);
  const seed = replica.keypair.secretKey.slice(0, 32);
  const pubkeyBytes = replica.keypair.publicKey.toBytes();
  const existing = replica.materializeModules().modules[moduleId];

  const event = buildSubmissionEvent(
    { moduleId, codeHash, codeUrl, name: moduleId, icon: '⬡', category: 'Tools', description: '', isIssuing: false, timeSensitive: null, economicConfig: null },
    seed, pubkeyBytes
  );

  const check = await validateSubmission(submissionState, event, code);
  if (!check.valid) {
    setMsg('submit-msg', `❌ ${check.reason}`, 'error');
    return;
  }
  submissionState = recordNonce(submissionState, event.nonce);
  await replica.foldSubmission(event, Boolean(existing));
  setMsg('submit-msg', `✅ ${existing ? 'Updated' : 'Registered'} '${moduleId}' — hash verified for real, signature verified for real.`, 'success');
  log(`[${replica.name}] plugin '${moduleId}' ${existing ? 'updated' : 'submitted'} via signed pipeline`);
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

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) { showDesktop(); return; }
      showScreen(btn.dataset.screen);
    });
  });

  document.querySelectorAll('.domain-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDomainName = btn.dataset.domain;
      showDesktop();
      renderAll();
    });
  });

  document.getElementById('mod-register-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    if (!hasIdentityCost(identityState, replica.name)) return setMsg('mod-msg', 'Register an identity first (Commit tab).', 'error');
    const id = document.getElementById('mod-id').value.trim();
    const icon = document.getElementById('mod-icon').value.trim() || '⬡';
    const name = document.getElementById('mod-name').value.trim() || id;
    if (!id) return setMsg('mod-msg', 'Enter a module id.', 'error');
    await replica.registerModule({ id, name, icon });
    setMsg('mod-msg', `✅ Registered '${id}'.`, 'success');
    log(`[${replica.name}] module '${id}' registered`);
    renderAll();
  });

  document.getElementById('burn-btn').addEventListener('click', () => registerIdentity(activeReplica()));
  document.getElementById('submit-btn').addEventListener('click', () => submitPluginCode(activeReplica()));

  document.getElementById('commit-action-btn').addEventListener('click', () => {
    const replica = activeReplica();
    replica.commit(10);
    log(`[${replica.name}] committed b=10 at q0=${replica.epoch}`);
    renderAll();
  });
  document.getElementById('claim-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const n = await replica.claim();
    log(n > 0 ? `[${replica.name}] claimed ${n} commitment(s).` : `[${replica.name}] nothing to claim.`);
    renderAll();
  });

  document.getElementById('wallet-create-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const pw = document.getElementById('wallet-pw').value;
    if (!pw) return setMsg('wallet-msg', 'Enter a password first.', 'error');
    await createWallet(replica, pw);
    setMsg('wallet-msg', `Wallet created: ${replica.keypair.publicKey.toBase58()}`, 'success');
    log(`[${replica.name}] wallet created`);
    renderAll();
  });
  document.getElementById('wallet-unlock-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const pw = document.getElementById('wallet-pw').value;
    try {
      await unlockWallet(replica, pw);
      setMsg('wallet-msg', `Wallet unlocked: ${replica.keypair.publicKey.toBase58()}`, 'success');
      log(`[${replica.name}] wallet unlocked`);
    } catch (err) {
      setMsg('wallet-msg', `❌ ${err.message}`, 'error');
    }
    renderAll();
  });

  document.getElementById('network-select').addEventListener('change', renderAll);
  document.getElementById('contacts-search').addEventListener('input', renderContactsScreen);

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
  document.getElementById('reconcile-btn').addEventListener('click', () => { if (linked) reconcile(); });

  renderAll();
  document.getElementById('status').textContent = 'Ready — two independent domains, partitioned by default.';
}

main().catch((err) => {
  document.getElementById('status').textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
