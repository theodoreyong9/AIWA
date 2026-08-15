// main.js — AIWA app entry point. Pure JavaScript, no framework, no
// build step.
//
// Domain identity is derived from the wallet, not chosen. Earlier
// revisions let the user type/select a domain name ("Earth", "Mars",
// "+ New domain") — the user corrected this directly: a domain isn't
// a place you name, it's derived from your own identity (the wallet
// key). No domain/DAG exists at all until a wallet exists; once one
// does, the domain id is deterministic (a short hash of the public
// key), never chosen.
//
// Local PoW as an identity mechanism was removed entirely — a second
// direct correction: "on brûle du solana, point." Distance never makes
// a burn impossible, only slower to confirm; there is no second
// mechanism, only delay. The burn UI reflects this (an illustrative
// delay field, not a blocking one — no real network-delay simulation
// exists here, and pretending otherwise would be dishonest).
//
// Contacts show a domain hash and a delay, not a name — matching the
// user's explicit spec. A "create test peer" affordance in Parameters
// exists ONLY to demonstrate Reconcile in a single browser tab; it is
// clearly labeled as testing, not a real second domain (a real one is
// just another device running this same app with its own wallet).

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
const CONTACT_DELAY_PREFIX = 'aiwa-contact-delay-';

// ── Domain identity: derived from a wallet's public key, never typed ─

async function deriveDomainId(publicKeyBytes) {
  const digest = await crypto.subtle.digest('SHA-256', publicKeyBytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 12); // short, stable, deterministic — not chosen
}

// ── Domain replica ──────────────────────────────────────────────────

class DomainReplica {
  constructor(id, dag, keypair) {
    this.id = id;
    this.dag = dag;
    this.keypair = keypair;
    this.genesisId = null;
    this.lastEventId = null;
    this.lastCadenceId = null;
    this.epoch = 0;
    this.pending = [];
  }

  async advanceCadence() {
    const nextEpoch = this.epoch + 1;
    const parents = [...new Set([this.lastCadenceId ?? this.genesisId, this.lastEventId])];
    const id = await this.dag.addEvent(parents, { type: 'cadence', domain: this.id, epoch: nextEpoch });
    this.lastCadenceId = id;
    this.lastEventId = id;
    this.epoch = nextEpoch;
    return id;
  }

  commit(amount, patienceRate = 0) {
    this.pending.push({ b: amount, q0: this.epoch, T: patienceRate });
  }

  async claim() {
    const claimed = this.pending;
    this.pending = [];
    for (const c of claimed) {
      const id = await this.dag.addEvent([this.lastEventId], { type: 'accrual', domain: this.id, b: c.b, q0: c.q0, T: c.T });
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
    this.genesisId = await this.dag.addEvent([], { type: 'genesis', domain: this.id });
    this.lastEventId = this.genesisId;
  }

  materialize() { return materializeG(theta, this.dag.topoOrder()); }
  materializeModules() { return materializeModuleRegistry(this.dag.topoOrder()); }
}

// ── Global state ────────────────────────────────────────────────────

let theta = { reward: { alpha: 1.1, beta: 2.2, gamma: 3, C: 33 ** 3, minQ: 1 }, budgets: {} };
let myDomain = null; // the one real domain this app instance represents — null until a wallet exists
let testPeers = new Map(); // id -> DomainReplica, testing-only, never the primary UI concept
let identityState = initialIdentityCostState();
let submissionState = initialSubmissionState();
let solanaWeb3 = null;

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

function pinnedIds(domainId) {
  try { return JSON.parse(localStorage.getItem(DESKTOP_PIN_PREFIX + domainId) || '[]'); } catch { return []; }
}
function setPinned(domainId, ids) { localStorage.setItem(DESKTOP_PIN_PREFIX + domainId, JSON.stringify(ids)); }
function togglePin(domainId, id) {
  const ids = pinnedIds(domainId);
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
  setPinned(domainId, ids);
}

function contactDelay(domainId) {
  return parseFloat(localStorage.getItem(CONTACT_DELAY_PREFIX + domainId) || '0');
}
function setContactDelay(domainId, minutes) {
  localStorage.setItem(CONTACT_DELAY_PREFIX + domainId, String(minutes));
}

// ── Wallet / identity ─────────────────────────────────────────────

function walletStorageKey(domainId) { return `${WALLET_STORAGE_PREFIX}${domainId}`; }
async function ensureSolanaWeb3() {
  if (!solanaWeb3) solanaWeb3 = await loadSolanaWeb3();
  return solanaWeb3;
}

/** Creates a wallet, derives this app's one real domain from it, and boots the domain's DAG. */
async function createWalletAndDomain(password) {
  const web3 = await ensureSolanaWeb3();
  const keypair = generateKeypair(web3);
  const id = await deriveDomainId(keypair.publicKey.toBytes());
  const record = await encryptSecretKey(keypair.secretKey, password);
  localStorage.setItem(walletStorageKey(id), JSON.stringify(record));
  localStorage.setItem('aiwa-my-domain-id', id);

  myDomain = new DomainReplica(id, await createLedger(), keypair);
  await myDomain.init();
  theta = { ...theta, budgets: { ...theta.budgets, [id]: null } };
}

/** Unlocks a previously-created wallet — requires knowing the domain id it was saved under. */
async function unlockWalletAndDomain(password) {
  const savedId = localStorage.getItem('aiwa-my-domain-id');
  if (!savedId) throw new Error('No saved wallet on this device — create one first.');
  const raw = localStorage.getItem(walletStorageKey(savedId));
  if (!raw) throw new Error('No saved wallet for this domain.');
  const web3 = await ensureSolanaWeb3();
  const record = JSON.parse(raw);
  const secretKey = await decryptSecretKey(record, password);
  const keypair = keypairFromSecretKey(web3, secretKey);
  const id = await deriveDomainId(keypair.publicKey.toBytes());

  myDomain = new DomainReplica(id, await createLedger(), keypair);
  await myDomain.init();
  theta = { ...theta, budgets: { ...theta.budgets, [id]: null } };
}

async function registerIdentityViaBurn() {
  if (!myDomain) return setMsg('burn-msg', 'Create a wallet first (Parameters).', 'error');
  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  const lamports = parseInt(document.getElementById('burn-amount').value, 10);
  if (!Number.isInteger(lamports) || lamports <= 0) {
    return setMsg('burn-msg', 'Enter a positive lamport amount — any amount is accepted, there is no minimum.', 'error');
  }
  const delayMinutes = parseFloat(document.getElementById('burn-delay').value) || 0;
  const solAmount = lamports / 1_000_000_000;
  const confirmed = confirm(
    `Burn ${lamports} lamports (${solAmount} SOL) on ${config.label}?\n\n` +
      `This is sent to the network's incinerator address and is irreversible.\n` +
      (delayMinutes > 0 ? `Illustrative: at this distance, confirmation might take ~${delayMinutes} min (informational only).\n` : '') +
      (config.isRealCost ? 'This is REAL money on mainnet.' : 'This is free devnet SOL — no real cost, testing only.')
  );
  if (!confirmed) return;

  const web3 = await ensureSolanaWeb3();
  setMsg('burn-msg', 'Broadcasting burn transaction…');
  try {
    const result = await registerDomainViaBurn(web3, myDomain.keypair, identityState, { domain: myDomain.id, lamports, network });
    identityState = result.state;
    setMsg('burn-msg', `✅ Registered — tx ${result.signature.slice(0, 12)}…`, 'success');
    log(`[${myDomain.id}] identity registered via SOL burn — tx ${result.signature}`);
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

function renderDesktop() {
  const noWalletEl = document.getElementById('no-wallet-notice');
  const badgeEl = document.getElementById('my-domain-badge');
  if (!myDomain) {
    noWalletEl.style.display = 'block';
    badgeEl.style.display = 'none';
    return;
  }
  noWalletEl.style.display = 'none';
  badgeEl.style.display = 'block';
  document.getElementById('my-domain-id').textContent = myDomain.id;

  const gState = myDomain.materialize();
  document.getElementById('desktop-title').textContent = `Desktop — ${myDomain.id}`;
  document.getElementById('d-epoch').textContent = gState.cadence.domains[myDomain.id]?.epoch ?? 0;
  document.getElementById('d-balance').textContent = gState.balances[myDomain.id] ?? 0;

  const registry = myDomain.materializeModules();
  const pinned = new Set(pinnedIds(myDomain.id));
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
  if (!myDomain) return;
  const gState = myDomain.materialize();
  const registry = myDomain.materializeModules();
  const pinned = new Set(pinnedIds(myDomain.id));
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
    row.querySelector('button').addEventListener('click', () => { togglePin(myDomain.id, m.id); renderAll(); });
    listEl.appendChild(row);
  }
}

function renderProfileScreen() {
  if (!myDomain) return;
  const registered = hasIdentityCost(identityState, myDomain.id);
  document.getElementById('profile-identity-status').textContent = registered
    ? `✅ registered — burned ${identityState.registered[myDomain.id].burnedLamports} lamports`
    : '🔓 wallet ready, not registered';
  document.getElementById('profile-network').textContent = currentNetwork();

  const registry = myDomain.materializeModules();
  const pinned = new Set(pinnedIds(myDomain.id));
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
  if (!myDomain) return;
  document.getElementById('burn-btn').disabled = hasIdentityCost(identityState, myDomain.id);
}

function renderContactsScreen() {
  if (!myDomain) return;
  const state = myDomain.materialize();
  const query = (document.getElementById('contacts-search').value || '').toLowerCase();
  const others = Object.keys(state.cadence.domains).filter((d) => d !== myDomain.id && d.toLowerCase().includes(query));
  const listEl = document.getElementById('contacts-list');
  const emptyEl = document.getElementById('contacts-empty');
  if (others.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';
  for (const d of others) {
    const row = document.createElement('div');
    row.className = 'contact-row';
    row.innerHTML = `<div class="contact-hash">${d}</div><div class="contact-delay">epoch ${state.cadence.domains[d].epoch} · delay: <input type="number" min="0" step="1" value="${contactDelay(d)}" style="width:4rem;display:inline-block" data-domain="${d}"> min</div>`;
    row.querySelector('input').addEventListener('change', (e) => setContactDelay(d, parseFloat(e.target.value) || 0));
    listEl.appendChild(row);
  }
}

function renderParametersScreen() {
  const network = currentNetwork();
  const config = SOLANA_NETWORKS[network];
  const warnEl = document.getElementById('network-warning');
  warnEl.className = config.isRealCost ? 'mainnet' : '';
  warnEl.innerHTML = config.isRealCost
    ? '⚠️ Mainnet mode: burns use <strong>real SOL</strong> and are <strong>irreversible</strong>.'
    : 'Devnet mode: burns use free faucet SOL and provide <strong>no real Sybil resistance</strong> (§24).';

  document.getElementById('param-alpha').value = theta.reward.alpha;
  document.getElementById('param-beta').value = theta.reward.beta;
  document.getElementById('param-gamma').value = theta.reward.gamma;
  document.getElementById('param-C').value = theta.reward.C;
  document.getElementById('param-minQ').value = theta.reward.minQ;

  if (myDomain) {
    const registered = hasIdentityCost(identityState, myDomain.id);
    document.getElementById('c-pending').textContent = myDomain.pending.length;
    document.getElementById('commit-action-btn').disabled = !registered;
    document.getElementById('claim-btn').disabled = !registered;
    document.getElementById('claim-gated-hint').style.display = registered ? 'none' : 'block';
  }

  const targetSelect = document.getElementById('reconcile-target');
  const currentTarget = targetSelect.value;
  targetSelect.innerHTML = '';
  for (const id of testPeers.keys()) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    targetSelect.appendChild(opt);
  }
  if (testPeers.has(currentTarget)) targetSelect.value = currentTarget;
  document.getElementById('reconcile-btn').disabled = testPeers.size === 0 || !myDomain;
}

function renderAll() {
  renderDesktop();
  renderDomainScreen();
  renderProfileScreen();
  renderCommitScreen();
  renderContactsScreen();
  renderParametersScreen();
}

// ── Reconcile (testing-only peer) ────────────────────────────────────

async function createTestPeer() {
  const web3 = await ensureSolanaWeb3();
  const keypair = generateKeypair(web3);
  const id = await deriveDomainId(keypair.publicKey.toBytes());
  const replica = new DomainReplica(id, await createLedger(), keypair);
  await replica.init();
  theta = { ...theta, budgets: { ...theta.budgets, [id]: null } };
  testPeers.set(id, replica);
  log(`Test peer '${id}' created (testing only — not part of the real protocol).`);
  renderAll();
}

async function reconcileWithTestPeer(peerId) {
  if (!myDomain) return;
  const peer = testPeers.get(peerId);
  if (!peer) return;
  myDomain.dag.merge(peer.dag);
  peer.dag.merge(myDomain.dag);
  const mineFromMine = myDomain.materialize().balances[myDomain.id] ?? 0;
  const mineFromPeer = peer.materialize().balances[myDomain.id] ?? 0;
  const converged = mineFromMine === mineFromPeer;
  log(`Reconciled with test peer '${peerId}' (${myDomain.dag.size} events on both sides now).`);
  log(converged ? 'Convergence check passed: both replicas agree (§9).' : 'Convergence check FAILED — bug.');
  renderAll();
}

// ── Submission ────────────────────────────────────────────────────

async function submitPluginCode() {
  if (!myDomain) return setMsg('submit-msg', 'Create a wallet first (Parameters).', 'error');
  const moduleId = document.getElementById('submit-id').value.trim();
  const codeUrl = document.getElementById('submit-url').value.trim();
  const code = document.getElementById('submit-code').value;
  if (!moduleId || !codeUrl || !code.trim()) return setMsg('submit-msg', 'Fill in id, URL, and code.', 'error');

  setMsg('submit-msg', 'Hashing and signing…');
  const codeHash = await computeModuleHash(code);
  const seed = myDomain.keypair.secretKey.slice(0, 32);
  const pubkeyBytes = myDomain.keypair.publicKey.toBytes();
  const existing = myDomain.materializeModules().modules[moduleId];

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
  await myDomain.foldSubmission(event, Boolean(existing));
  setMsg('submit-msg', `✅ ${existing ? 'Updated' : 'Registered'} '${moduleId}' — hash verified for real, signature verified for real.`, 'success');
  log(`[${myDomain.id}] plugin '${moduleId}' ${existing ? 'updated' : 'submitted'} via signed pipeline`);
  renderAll();
}

// ── Boot ──────────────────────────────────────────────────────────

async function main() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) { showDesktop(); return; }
      showScreen(btn.dataset.screen);
    });
  });

  document.getElementById('advance-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    await myDomain.advanceCadence();
    renderAll();
  });

  document.getElementById('burn-btn').addEventListener('click', registerIdentityViaBurn);
  document.getElementById('submit-btn').addEventListener('click', submitPluginCode);

  document.getElementById('commit-action-btn').addEventListener('click', () => {
    if (!myDomain) return;
    const T = parseFloat(document.getElementById('patience-rate').value) || 0;
    myDomain.commit(10, T);
    log(`[${myDomain.id}] staked claim b=10 at q0=${myDomain.epoch}, T=${T}`);
    renderAll();
  });
  document.getElementById('claim-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    const n = await myDomain.claim();
    log(n > 0 ? `[${myDomain.id}] claimed ${n} commitment(s).` : `[${myDomain.id}] nothing to claim.`);
    renderAll();
  });

  document.getElementById('wallet-create-btn').addEventListener('click', async () => {
    const pw = document.getElementById('wallet-pw').value;
    if (!pw) return setMsg('wallet-msg', 'Enter a password first.', 'error');
    await createWalletAndDomain(pw);
    setMsg('wallet-msg', `Wallet created — domain id: ${myDomain.id}`, 'success');
    log(`Wallet created — domain id ${myDomain.id}`);
    renderAll();
  });
  document.getElementById('wallet-unlock-btn').addEventListener('click', async () => {
    const pw = document.getElementById('wallet-pw').value;
    try {
      await unlockWalletAndDomain(pw);
      setMsg('wallet-msg', `Wallet unlocked — domain id: ${myDomain.id}`, 'success');
      log(`Wallet unlocked — domain id ${myDomain.id}`);
    } catch (err) {
      setMsg('wallet-msg', `❌ ${err.message}`, 'error');
    }
    renderAll();
  });

  document.getElementById('network-select').addEventListener('change', renderAll);
  document.getElementById('contacts-search').addEventListener('input', renderContactsScreen);

  ['param-alpha', 'param-beta', 'param-gamma', 'param-C', 'param-minQ'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      theta = {
        ...theta,
        reward: {
          alpha: parseFloat(document.getElementById('param-alpha').value) || 0,
          beta: parseFloat(document.getElementById('param-beta').value) || 0,
          gamma: parseFloat(document.getElementById('param-gamma').value) || 0,
          C: parseFloat(document.getElementById('param-C').value) || 0,
          minQ: parseFloat(document.getElementById('param-minQ').value) || 0,
        },
      };
      renderAll();
    });
  });

  document.getElementById('create-test-peer-btn').addEventListener('click', createTestPeer);
  document.getElementById('reconcile-btn').addEventListener('click', () => {
    const target = document.getElementById('reconcile-target').value;
    if (target) reconcileWithTestPeer(target);
  });

  renderAll();
  document.getElementById('status').textContent = 'Ready — create or unlock a wallet to begin.';
}

main().catch((err) => {
  document.getElementById('status').textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
