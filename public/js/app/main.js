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
import { deriveDomainId, shortDomainLabel } from '../core/identity/domain-id.js';
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { broadcastAndVerifyBurn } from '../core/identity/identity-flow.js';
import { hasIdentityCost } from '../core/identity/identity-cost.js';
import { materializeIdentity } from '../core/identity/identity-cost-reducer.js';
import { SOLANA_NETWORKS, DEFAULT_NETWORK } from '../core/identity/solana-networks.js';
import { materializeModuleRegistry } from '../core/modules/module-registry-reducer.js';
import { materializeConservation, buildSignedTransferEvent } from '../core/conservation/conservation-bridge.js';
import { materializeFormulas, GENESIS_FORMULA_ID, GENESIS_FORMULA_PARAMS } from '../core/economics/formula-registry-reducer.js';
import { rankFromIdentityAndCadence, checkSubmissionEligibility, computeModuleRank } from '../core/modules/module-rank.js';
import { computeModuleHash } from '../core/modules/module-hash.js';
import { buildSubmissionEvent, validateSubmission, initialSubmissionState, recordNonce } from '../core/modules/module-submission.js';
import { mountModule } from '../core/modules/module-sandbox.js';
import { loadVerifiedModuleCode } from '../core/modules/module-loader.js';
import { verifyModuleIntegrity } from '../core/modules/module-hash.js';

const WALLET_STORAGE_PREFIX = 'aiwa-wallet-';
const DESKTOP_PIN_PREFIX = 'aiwa-desktop-pins-';
const CONTACT_DELAY_PREFIX = 'aiwa-contact-delay-';

// ── Domain identity: derived from a wallet's public key, never typed ─
// (deriveDomainId itself now lives in domain-id.js, shared with
// conservation-bridge.js's transfer-signature verification — see that
// file's header for why having two copies of this is exactly the kind
// of drift that silently breaks signature checks.)

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
    this.activeFormulaId = GENESIS_FORMULA_ID; // local choice, not DAG state — see mintFormula()'s header
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

  materialize() { return materializeG({ reward: this.currentRewardParams(), budgets: theta.budgets }, this.dag.topoOrder()); }
  materializeFormulas() { return materializeFormulas(this.dag.topoOrder()); }

  /** The active formula's params — 'genesis' (the real Proof-of-Will
   * constants, §10) unless this domain has switched to a minted one. */
  currentRewardParams() {
    const registry = this.materializeFormulas();
    return registry.formulas[this.activeFormulaId] ?? GENESIS_FORMULA_PARAMS;
  }

  /**
   * Mints a NEW, permanent formula — answers "puis-je changer la
   * formule quand je veux ? [...] ça doit être immuable" directly:
   * theta used to be a plain JS variable, editable at any time in
   * Parameters, never a DAG event — meaning two domains could silently
   * disagree on what the SAME accrual event was worth (a real,
   * unnamed fork). Now, the only way to get DIFFERENT parameters is to
   * mint a brand-new, permanently-fixed formula id; the id this domain
   * (or any domain) is currently USING is a separate, local,
   * non-permanent choice (activeFormulaId) — switching which formula
   * you use is not the same operation as changing one that exists.
   * Requires a registered identity (checked by the caller before this
   * is invoked, per the same application-layer gating pattern as
   * checkSubmissionEligibility — the pure reducer itself enforces only
   * immutability, not the burn requirement).
   */
  async mintFormula(id, params) {
    const payload = { type: 'formula-register', id, alpha: params.alpha, beta: params.beta, gamma: params.gamma, C: params.C, minQ: params.minQ, mintedBy: this.id, at: this.epoch };
    const newId = await this.dag.addEvent([this.lastEventId], payload);
    this.lastEventId = newId;
  }
  materializeModules() { return materializeModuleRegistry(this.dag.topoOrder()); }
  async materializeConservation() { return materializeConservation(this.dag.topoOrder()); }
  materializeIdentity() { return materializeIdentity(this.dag.topoOrder()); }

  /**
   * Sends `amount` of the domain's own accrued balance to `toDomainId`:
   * a real claim-issue (debits the balance, creates a spendable claim)
   * followed by a REAL SIGNED transfer — the transfer event now carries
   * an Ed25519 signature over (claimId, from, to, nonce, timestamp)
   * proving this domain's keypair actually authorized it, closing the
   * forgeable-string-comparison gap conservation-bridge.js used to have.
   */
  async sendAiwa(toDomainId, amount) {
    if (!this.keypair) throw new Error('a wallet is required to send AIWA — a transfer must be signed');
    const claimId = `claim-${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let id = await this.dag.addEvent([this.lastEventId], { type: 'claim-issue', domain: this.id, id: claimId, amount });
    const seed = this.keypair.secretKey.slice(0, 32);
    const pubkeyBytes = this.keypair.publicKey.toBytes();
    const transferEvent = buildSignedTransferEvent({ claimId, from: this.id, to: toDomainId }, seed, pubkeyBytes);
    id = await this.dag.addEvent([id], { type: 'transfer', ...transferEvent });
    this.lastEventId = id;
    return claimId;
  }
}

// ── Global state ────────────────────────────────────────────────────

let theta = { budgets: {} }; // .reward removed — see currentRewardParams(); §10's constants now live at formula id 'genesis', not here
let myDomain = null; // the one real domain this app instance represents — null until a wallet exists
let testPeers = new Map(); // id -> DomainReplica, testing-only, never the primary UI concept
let submissionState = initialSubmissionState();
let solanaWeb3 = null;
let activePluginHandle = null; // { unmount } from mountModule(), or null
const MODULE_STORAGE_PREFIX = 'aiwa-module-storage-';

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
    const result = await broadcastAndVerifyBurn(web3, myDomain.keypair, { lamports, network });
    // The verified burn becomes an 'identity-register' DAG event, folded
    // like everything else — propagated by merge(), not trapped in a
    // local variable (see identity-cost-reducer.js's header for why
    // that used to be a real problem).
    const id = await myDomain.dag.addEvent([myDomain.lastEventId], {
      type: 'identity-register', domain: myDomain.id, signature: result.signature, burnedLamports: result.burnedLamports, at: myDomain.epoch,
    });
    myDomain.lastEventId = id;
    setMsg('burn-msg', `✅ Registered — tx ${result.signature.slice(0, 12)}…`, 'success');
    log(`[${myDomain.id}] identity registered via SOL burn — tx ${result.signature}`);
  } catch (err) {
    setMsg('burn-msg', `❌ ${err.message}`, 'error');
  }
  await renderAll();
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

// ── Plugin execution: real sandboxed iframe, real ctx bridge ────────

function moduleStorageKey(domainId, moduleId, key) {
  return `${MODULE_STORAGE_PREFIX}${domainId}-${moduleId}-${key}`;
}

async function runModule(entry) {
  if (!myDomain) return;
  const statusEl = document.getElementById('plugin-runner-status');
  const titleEl = document.getElementById('plugin-runner-title');
  const containerEl = document.getElementById('plugin-runner-container');
  const runnerEl = document.getElementById('plugin-runner');

  titleEl.textContent = `${entry.icon || '⬡'} ${entry.name}`;
  statusEl.textContent = 'Fetching and verifying code…';
  containerEl.innerHTML = '';
  runnerEl.classList.remove('plugin-runner-hidden');

  let code;
  try {
    code = await loadVerifiedModuleCode(entry);
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    log(`[${myDomain.id}] refused to run '${entry.id}': ${err.message}`);
    return;
  }
  statusEl.textContent = '';

  const hostHandlers = {
    async onStorageGet(moduleId, key) {
      return localStorage.getItem(moduleStorageKey(myDomain.id, moduleId, key));
    },
    async onStorageSet(moduleId, key, value) {
      localStorage.setItem(moduleStorageKey(myDomain.id, moduleId, key), value);
    },
    onToast(moduleId, message, kind) {
      log(`[plugin:${moduleId}] ${message}`);
      statusEl.textContent = message;
      statusEl.className = `hint ${kind === 'error' ? 'error' : ''}`;
    },
    async onCommit(moduleId, amount) {
      if (!hasIdentityCost(myDomain.materializeIdentity(), myDomain.id)) throw new Error('domain has no registered identity — cannot commit');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('commit amount must be a positive number');
      myDomain.commit(amount, 0);
      log(`[plugin:${moduleId}] committed b=${amount} on behalf of ${myDomain.id}`);
      await renderAll();
    },
    async onClaim(moduleId) {
      const n = await myDomain.claim();
      log(`[plugin:${moduleId}] claimed ${n} commitment(s) on behalf of ${myDomain.id}`);
      await renderAll();
      return n;
    },
  };

  activePluginHandle = await mountModule(containerEl, entry, code, verifyModuleIntegrity, hostHandlers);
  log(`[${myDomain.id}] running '${entry.id}' in a sandboxed iframe`);
}

function stopActiveModule() {
  if (activePluginHandle) {
    activePluginHandle.unmount();
    activePluginHandle = null;
  }
  document.getElementById('plugin-runner').classList.add('plugin-runner-hidden');
}

// ── Renderers ─────────────────────────────────────────────────────

async function renderDesktop() {
  const noWalletEl = document.getElementById('no-wallet-notice');
  const badgeEl = document.getElementById('my-domain-badge');
  if (!myDomain) {
    noWalletEl.style.display = 'block';
    badgeEl.style.display = 'none';
    return;
  }
  noWalletEl.style.display = 'none';
  badgeEl.style.display = 'block';
  document.getElementById('my-domain-id').textContent = shortDomainLabel(myDomain.id);

  const gState = myDomain.materialize();
  document.getElementById('desktop-title').textContent = `Desktop — ${shortDomainLabel(myDomain.id)}`;
  document.getElementById('d-epoch').textContent = gState.cadence.domains[myDomain.id]?.epoch ?? 0;
  document.getElementById('d-balance').textContent = gState.balances[myDomain.id] ?? 0;

  const conState = await myDomain.materializeConservation();
  const ownedClaims = Object.values(conState.conservation.claims).filter((c) => c.owner === myDomain.id && c.status === 'active');
  const claimsTotal = ownedClaims.reduce((sum, c) => sum + c.amount, 0);
  document.getElementById('d-claims').textContent = `${claimsTotal} (${ownedClaims.length} claim${ownedClaims.length === 1 ? '' : 's'})`;

  const registry = myDomain.materializeModules();
  const localIdentityState = myDomain.materializeIdentity();
  const pinned = new Set(pinnedIds(myDomain.id));
  const pinnedModules = Object.values(registry.modules)
    .filter((m) => pinned.has(m.id))
    .map((m) => ({ ...m, rank: rankFromIdentityAndCadence(localIdentityState, gState.cadence, m.author, myDomain.currentRewardParams()) }))
    .sort((a, b) => b.rank - a.rank);

  const iconsEl = document.getElementById('desktop-icons');
  const emptyEl = document.getElementById('desktop-empty');
  if (pinnedModules.length === 0) {
    emptyEl.style.display = 'block';
    iconsEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  iconsEl.innerHTML = '';
  for (const m of pinnedModules) {
    const tile = document.createElement('div');
    tile.className = 'icon-tile';
    tile.title = `rank ${m.rank.toFixed(2)}`;
    tile.innerHTML = `<div class="icon-glyph">${m.icon || '⬡'}</div><div>${m.name}</div>`;
    tile.addEventListener('click', () => runModule(m));
    iconsEl.appendChild(tile);
  }
}

function renderDomainScreen() {
  if (!myDomain) return;
  const gState = myDomain.materialize();
  const registry = myDomain.materializeModules();
  const localIdentityState = myDomain.materializeIdentity();
  const pinned = new Set(pinnedIds(myDomain.id));
  const modules = Object.values(registry.modules).map((m) => ({
    ...m,
    rank: rankFromIdentityAndCadence(localIdentityState, gState.cadence, m.author, myDomain.currentRewardParams()),
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
    row.querySelector('button').addEventListener('click', async () => { togglePin(myDomain.id, m.id); await renderAll(); });
    listEl.appendChild(row);
  }
}

function renderProfileScreen() {
  if (!myDomain) return;
  const localIdentityState = myDomain.materializeIdentity();
  const registered = hasIdentityCost(localIdentityState, myDomain.id);
  document.getElementById('profile-identity-status').textContent = registered
    ? `✅ registered — burned ${localIdentityState.registered[myDomain.id].burnedLamports} lamports`
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
  document.getElementById('burn-btn').disabled = hasIdentityCost(myDomain.materializeIdentity(), myDomain.id);
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
    row.innerHTML = `<div class="contact-hash" title="${d}">${shortDomainLabel(d)}…</div><div class="contact-delay">epoch ${state.cadence.domains[d].epoch} · delay: <input type="number" min="0" step="1" value="${contactDelay(d)}" style="width:4rem;display:inline-block" data-domain="${d}"> min</div>
      <div class="row" style="margin-top:0.3rem">
        <input type="number" min="1" step="1" placeholder="amount" class="send-amount-input" style="flex:1">
        <button class="send-aiwa-btn" style="flex:0 0 auto">Send AIWA</button>
      </div>
      <p class="msg send-msg"></p>`;
    row.querySelector('input[data-domain]').addEventListener('change', (e) => setContactDelay(d, parseFloat(e.target.value) || 0));
    row.querySelector('.send-aiwa-btn').addEventListener('click', async () => {
      const amountInput = row.querySelector('.send-amount-input');
      const msgEl = row.querySelector('.send-msg');
      const amount = parseFloat(amountInput.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        msgEl.textContent = 'Enter a positive amount.';
        msgEl.className = 'msg error';
        return;
      }
      const currentBalance = myDomain.materialize().balances[myDomain.id] ?? 0;
      if (amount > currentBalance) {
        msgEl.textContent = `Insufficient balance (have ${currentBalance}).`;
        msgEl.className = 'msg error';
        return;
      }
      const claimId = await myDomain.sendAiwa(d, amount);
      msgEl.textContent = `✅ Sent — claim ${claimId.slice(0, 16)}…`;
      msgEl.className = 'msg success';
      log(`[${myDomain.id}] sent ${amount} AIWA to ${d} (claim ${claimId})`);
      await renderAll();
    });
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

  if (myDomain) {
    const formulaRegistry = myDomain.materializeFormulas();
    const active = formulaRegistry.formulas[myDomain.activeFormulaId] ?? GENESIS_FORMULA_PARAMS;
    document.getElementById('active-formula-id').textContent = myDomain.activeFormulaId;
    document.getElementById('param-alpha').textContent = active.alpha;
    document.getElementById('param-beta').textContent = active.beta;
    document.getElementById('param-gamma').textContent = active.gamma;
    document.getElementById('param-C').textContent = active.C;
    document.getElementById('param-minQ').textContent = active.minQ;

    const selectEl = document.getElementById('formula-select');
    const currentSelection = selectEl.value;
    selectEl.innerHTML = '';
    for (const id of Object.keys(formulaRegistry.formulas)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      selectEl.appendChild(opt);
    }
    selectEl.value = Object.keys(formulaRegistry.formulas).includes(currentSelection) ? currentSelection : myDomain.activeFormulaId;

    const registered = hasIdentityCost(myDomain.materializeIdentity(), myDomain.id);
    document.getElementById('mint-formula-btn').disabled = !registered;
    document.getElementById('mint-gated-hint').style.display = registered ? 'none' : 'block';
  }

  if (myDomain) {
    const registered = hasIdentityCost(myDomain.materializeIdentity(), myDomain.id);
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

async function renderAll() {
  await renderDesktop();
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
  await renderAll();
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
  await renderAll();
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

  // checkSubmissionEligibility (module-rank.js) was built and tested
  // since an earlier phase but never actually wired in — only gates a
  // genuinely NEW module id, never an update to one this author already
  // owns, matching the reasoning documented in module-rank.js itself.
  if (!existing) {
    const localIdentityState = myDomain.materializeIdentity();
    const localCadence = myDomain.materialize().cadence;
    const currentEpochsElapsed = localCadence.domains[myDomain.id]?.epoch ?? 0;
    const identity = localIdentityState.registered[myDomain.id];
    const currentRank = identity ? computeModuleRank(identity.burnedLamports, currentEpochsElapsed, myDomain.currentRewardParams()) : 0;
    const lastSubmission = submissionState.lastSubmissionByAuthor[event.signerPubkey] ?? null;
    const eligibility = checkSubmissionEligibility(currentRank, currentEpochsElapsed, lastSubmission);
    if (!eligibility.eligible) {
      setMsg('submit-msg', `❌ ${eligibility.reason}`, 'error');
      return;
    }
    submissionState = {
      ...submissionState,
      lastSubmissionByAuthor: { ...submissionState.lastSubmissionByAuthor, [event.signerPubkey]: { rank: currentRank, epochsElapsed: currentEpochsElapsed } },
    };
  }

  submissionState = recordNonce(submissionState, event.nonce);
  await myDomain.foldSubmission(event, Boolean(existing));
  setMsg('submit-msg', `✅ ${existing ? 'Updated' : 'Registered'} '${moduleId}' — hash verified for real, signature verified for real.`, 'success');
  log(`[${myDomain.id}] plugin '${moduleId}' ${existing ? 'updated' : 'submitted'} via signed pipeline`);
  await renderAll();
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
    await renderAll();
  });

  document.getElementById('burn-btn').addEventListener('click', registerIdentityViaBurn);
  document.getElementById('submit-btn').addEventListener('click', submitPluginCode);
  document.getElementById('plugin-runner-close').addEventListener('click', stopActiveModule);

  document.getElementById('commit-action-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    const T = parseFloat(document.getElementById('patience-rate').value) || 0;
    myDomain.commit(10, T);
    log(`[${myDomain.id}] staked claim b=10 at q0=${myDomain.epoch}, T=${T}`);
    await renderAll();
  });
  document.getElementById('claim-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    const n = await myDomain.claim();
    log(n > 0 ? `[${myDomain.id}] claimed ${n} commitment(s).` : `[${myDomain.id}] nothing to claim.`);
    await renderAll();
  });

  document.getElementById('wallet-create-btn').addEventListener('click', async () => {
    const pw = document.getElementById('wallet-pw').value;
    if (!pw) return setMsg('wallet-msg', 'Enter a password first.', 'error');
    await createWalletAndDomain(pw);
    setMsg('wallet-msg', `Wallet created — domain id: ${myDomain.id}`, 'success');
    log(`Wallet created — domain id ${myDomain.id}`);
    await renderAll();
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
    await renderAll();
  });

  document.getElementById('network-select').addEventListener('change', renderAll);
  document.getElementById('contacts-search').addEventListener('input', renderContactsScreen);

  document.getElementById('create-test-peer-btn').addEventListener('click', createTestPeer);
  document.getElementById('reconcile-btn').addEventListener('click', () => {
    const target = document.getElementById('reconcile-target').value;
    if (target) reconcileWithTestPeer(target);
  });

  document.getElementById('formula-select').addEventListener('change', async (e) => {
    if (!myDomain) return;
    myDomain.activeFormulaId = e.target.value;
    log(`[${myDomain.id}] switched active formula to '${e.target.value}' (a local choice — the formula itself is unchanged and permanent)`);
    await renderAll();
  });

  document.getElementById('mint-formula-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    const msgEl = document.getElementById('mint-msg');
    if (!hasIdentityCost(myDomain.materializeIdentity(), myDomain.id)) {
      msgEl.textContent = 'Requires a registered identity — minting a formula is a real economic object, gated the same way as issuing a module (§24.1).';
      msgEl.className = 'msg error';
      return;
    }
    const id = document.getElementById('mint-id').value.trim();
    const alpha = parseFloat(document.getElementById('mint-alpha').value);
    const beta = parseFloat(document.getElementById('mint-beta').value);
    const gamma = parseFloat(document.getElementById('mint-gamma').value);
    const C = parseFloat(document.getElementById('mint-C').value);
    const minQ = parseFloat(document.getElementById('mint-minQ').value);
    if (!id) return (msgEl.textContent = 'Enter a formula id.', msgEl.className = 'msg error');
    if (![alpha, beta, gamma, C, minQ].every(Number.isFinite)) {
      msgEl.textContent = 'All five parameters must be numbers.';
      msgEl.className = 'msg error';
      return;
    }
    await myDomain.mintFormula(id, { alpha, beta, gamma, C, minQ });
    const registry = myDomain.materializeFormulas();
    if (!registry.formulas[id]) {
      msgEl.textContent = `❌ Mint rejected — '${id}' may already be taken, or 'genesis' is reserved.`;
      msgEl.className = 'msg error';
    } else {
      msgEl.textContent = `✅ Minted '${id}' — permanent from now on, never editable again.`;
      msgEl.className = 'msg success';
      log(`[${myDomain.id}] minted formula '${id}'`);
    }
    await renderAll();
  });

  await renderAll();
  document.getElementById('status').textContent = 'Ready — create or unlock a wallet to begin.';
}

main().catch((err) => {
  document.getElementById('status').textContent = `Initialization error: ${err.message}`;
  console.error(err);
});
