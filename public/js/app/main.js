// main.js — AIWA app entry point. Pure JavaScript, no framework, no
// build step.
//
// N domains, not a fixed two. Earlier revisions hardcoded "Earth" and
// "Mars" as the only two domains — the user pointed out directly that
// this doesn't match the real model: there are as many domains as
// there are users/entities, and who can reconcile with whom at any
// moment depends on actual reachability, not a fixed global "link"
// toggle. Fixed here: domains is a Map, created on demand; there is no
// global link state — Reconcile always targets one specific,
// user-chosen other domain, matching "I am currently in contact with
// THIS one," not "the whole system is connected or not."
//
// Also fixed: Solana burn (§24.6(v)) requires reaching Solana's
// network, which a domain that has never had connectivity to Earth's
// networks cannot do, ever — the user caught this directly ("impossible
// qu'on brûle du solana sur Mars"). Local PoW (§24.6(ii), local-pow.js)
// is wired in as the network-independent alternative: same
// "this domain has paid c_id" outcome, zero network dependency.

import { createLedger } from '../core/ledger-bridge.js';
import { materializeG } from '../core/economics/g.js';
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { registerDomainViaBurn } from '../core/identity/identity-flow.js';
import { initialIdentityCostState, hasIdentityCost } from '../core/identity/identity-cost.js';
import { minePowProof, registerLocalPow, initialLocalPowState, hasLocalPow } from '../core/identity/local-pow.js';
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

  async init() {
    this.genesisId = await this.dag.addEvent([], { type: 'genesis', domain: this.name });
    this.lastEventId = this.genesisId;
  }

  materialize() { return materializeG(theta, this.dag.topoOrder()); }
  materializeModules() { return materializeModuleRegistry(this.dag.topoOrder()); }
}

// ── Global state ────────────────────────────────────────────────────

let theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: {} };
const domains = new Map(); // name -> DomainReplica, created on demand — no fixed count
let activeDomainName = null;
let identityState = initialIdentityCostState();
let powState = initialLocalPowState();
let submissionState = initialSubmissionState();
let solanaWeb3 = null;

function activeReplica() { return domains.get(activeDomainName); }
function currentNetwork() { return document.getElementById('network-select').value || DEFAULT_NETWORK; }
function domainHasIdentity(name) { return hasIdentityCost(identityState, name) || hasLocalPow(powState, name); }
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

async function createDomain(name) {
  if (domains.has(name)) throw new Error(`Domain '${name}' already exists.`);
  const replica = new DomainReplica(name, await createLedger());
  await replica.init();
  domains.set(name, replica);
  theta = { ...theta, budgets: { ...theta.budgets, [name]: 1000 } };
  return replica;
}

// ── Desktop pin state (local-only, not replicated) ───────────────────

function pinnedIds(domain) {
  try { return JSON.parse(localStorage.getItem(DESKTOP_PIN_PREFIX + domain) || '[]'); } catch { return []; }
}
function setPinned(domain, ids) { localStorage.setItem(DESKTOP_PIN_PREFIX + domain, JSON.stringify(ids)); }
function togglePin(domain, id) {
  const ids = pinnedIds(domain);
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
  setPinned(domain, ids);
}

// ── Wallet / identity ─────────────────────────────────────────────

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
async function registerIdentityViaBurn(replica) {
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
    log(`[${replica.name}] identity registered via SOL burn — tx ${result.signature}`);
  } catch (err) {
    setMsg('burn-msg', `❌ ${err.message}`, 'error');
  }
  renderAll();
}
async function registerIdentityViaPow(replica) {
  const difficulty = parseInt(document.getElementById('pow-difficulty').value, 10) || 16;
  setMsg('pow-msg', `Mining locally at difficulty ${difficulty}… (no network involved)`);
  try {
    const proof = await minePowProof(replica.name, difficulty);
    const result = await registerLocalPow(powState, proof);
    if (!result.accepted) {
      setMsg('pow-msg', `❌ ${result.reason}`, 'error');
      return;
    }
    powState = result.state;
    setMsg('pow-msg', `✅ Registered — nonce ${proof.nonce}, hash ${proof.hash.slice(0, 12)}…`, 'success');
    log(`[${replica.name}] identity registered via local PoW — nonce ${proof.nonce}, difficulty ${difficulty}`);
  } catch (err) {
    setMsg('pow-msg', `❌ ${err.message}`, 'error');
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
  const pillsEl = document.getElementById('domain-pills');
  pillsEl.innerHTML = '';
  for (const name of domains.keys()) {
    const btn = document.createElement('button');
    btn.className = 'domain-switch-btn' + (name === activeDomainName ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => { activeDomainName = name; showDesktop(); renderAll(); });
    pillsEl.appendChild(btn);
  }
}

function renderDesktop() {
  const replica = activeReplica();
  if (!replica) return;
  const gState = replica.materialize();
  const domain = replica.name;
  document.getElementById('desktop-title').textContent = `Desktop — ${domain}`;
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
  if (!replica) return;
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
    row.querySelector('button').addEventListener('click', () => { togglePin(replica.name, m.id); renderAll(); });
    listEl.appendChild(row);
  }
}

function renderProfileScreen() {
  const replica = activeReplica();
  if (!replica) return;
  const registered = domainHasIdentity(replica.name);
  const via = hasIdentityCost(identityState, replica.name) ? 'SOL burn' : hasLocalPow(powState, replica.name) ? 'local PoW' : null;
  document.getElementById('profile-title').textContent = `Profile — ${replica.name}`;
  document.getElementById('profile-identity-status').textContent = registered
    ? `✅ registered via ${via}`
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
  listEl.innerHTML = active.map((m) => `<div class="stat-row"><span>${m.icon || '⬡'} ${m.name} (${currentNetwork()})</span><span>${m.auditStatus}</span></div>`).join('');
}

function renderCommitScreen() {
  const replica = activeReplica();
  if (!replica) return;
  document.getElementById('commit-burn-title').textContent = `🔥 Burn — ${replica.name}`;
  document.getElementById('pow-title').textContent = `⛏️ Mine locally — ${replica.name}`;
  document.getElementById('burn-btn').disabled = !replica.keypair || domainHasIdentity(replica.name);
  document.getElementById('pow-btn').disabled = domainHasIdentity(replica.name);
}

function renderContactsScreen() {
  const replica = activeReplica();
  if (!replica) return;
  const state = replica.materialize();
  document.getElementById('contacts-domain-name').textContent = replica.name;
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
  listEl.innerHTML = others.map((d) => `<div class="contact-row"><span>${d}</span><span>epoch ${state.cadence.domains[d].epoch}</span></div>`).join('');
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

  const replica = activeReplica();
  if (replica) {
    const registered = domainHasIdentity(replica.name);
    document.getElementById('c-pending').textContent = replica.pending.length;
    document.getElementById('commit-action-btn').disabled = !registered;
    document.getElementById('claim-btn').disabled = !registered;
    document.getElementById('claim-gated-hint').style.display = registered ? 'none' : 'block';
  }

  const targetSelect = document.getElementById('reconcile-target');
  const currentTarget = targetSelect.value;
  targetSelect.innerHTML = '';
  const others = [...domains.keys()].filter((d) => d !== activeDomainName);
  for (const d of others) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    targetSelect.appendChild(opt);
  }
  if (others.includes(currentTarget)) targetSelect.value = currentTarget;
  document.getElementById('reconcile-btn').disabled = others.length === 0;
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

// ── Reconcile: always a specific pair, never a global toggle ─────────

async function reconcile(withName) {
  const a = activeReplica();
  const b = domains.get(withName);
  if (!a || !b) return;
  a.dag.merge(b.dag);
  b.dag.merge(a.dag);
  const aFromA = a.materialize().balances[a.name] ?? 0;
  const aFromB = b.materialize().balances[a.name] ?? 0;
  const converged = aFromA === aFromB;
  log(`[${a.name}] reconciled with [${b.name}] (${a.dag.size} events on both sides now).`);
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
  await createDomain('earth');
  await createDomain('mars');
  activeDomainName = 'earth';

  document.getElementById('add-domain-btn').addEventListener('click', async () => {
    const name = prompt('New domain name (e.g. an outpost, a person, anything — no relation to any other domain implied):');
    if (!name) return;
    try {
      await createDomain(name.trim());
      activeDomainName = name.trim();
      log(`Domain '${name.trim()}' created.`);
      showDesktop();
      renderAll();
    } catch (err) {
      alert(err.message);
    }
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) { showDesktop(); return; }
      showScreen(btn.dataset.screen);
    });
  });

  document.getElementById('burn-btn').addEventListener('click', () => registerIdentityViaBurn(activeReplica()));
  document.getElementById('pow-btn').addEventListener('click', () => registerIdentityViaPow(activeReplica()));
  document.getElementById('submit-btn').addEventListener('click', () => submitPluginCode(activeReplica()));

  document.getElementById('commit-action-btn').addEventListener('click', () => {
    const replica = activeReplica();
    replica.commit(10);
    log(`[${replica.name}] staked claim b=10 at q0=${replica.epoch}`);
    renderAll();
  });
  document.getElementById('claim-btn').addEventListener('click', async () => {
    const replica = activeReplica();
    const n = await replica.claim();
    log(n > 0 ? `[${replica.name}] claimed ${n} commitment(s).` : `[${replica.name}] nothing to claim.`);
    renderAll();
  });
  document.getElementById('advance-btn')?.addEventListener('click', async () => {
    const replica = activeReplica();
    await replica.advanceCadence();
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

  document.getElementById('reconcile-btn').addEventListener('click', () => {
    const target = document.getElementById('reconcile-target').value;
    if (target) reconcile(target);
  });

  renderAll();
  document.getElementById('status').textContent = 'Ready — N independent domains, reconciled pairwise, never globally.';
}

main().catch((err) => {
  document.getElementById('status').textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
