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
import { createPersistedLedger } from '../core/event-dag-persistence.js';
import { materializeG } from '../core/economics/g.js';
import { deriveDomainId, shortDomainLabel } from '../core/identity/domain-id.js';
import { loadSolanaWeb3, generateKeypair, keypairFromSecretKey, encryptSecretKey, decryptSecretKey } from '../core/identity/solana-wallet.js';
import { broadcastAndVerifyBurn } from '../core/identity/identity-flow.js';
import { hasIdentityCost, linearCostCurve } from '../core/identity/identity-cost.js';
import { materializeIdentity } from '../core/identity/identity-cost-reducer.js';
import { SOLANA_NETWORKS, DEFAULT_NETWORK } from '../core/identity/solana-networks.js';
import { materializeModuleRegistry } from '../core/modules/module-registry-reducer.js';
import { materializeConservation, buildSignedTransferEvent } from '../core/conservation/conservation-bridge.js';
import { createDelayTolerantTransport } from '../core/transport/delay-tolerant-transport.js';
import { createConnectionWatchdog } from '../core/transport/connection-watchdog.js';
import { materializeFormulas, GENESIS_FORMULA_ID, GENESIS_FORMULA_PARAMS } from '../core/economics/formula-registry-reducer.js';
import { collectContextSnapshot, buildIdeaSystemPrompt, sanitizeIdeaReply } from '../core/ai/idea-agent.js';
import { detectWebGpuSupport, loadEngine, streamChat } from '../core/ai/webllm-engine.js';
import { materializePublicProfiles, publishedDataForDomain } from '../core/profile/public-profile-reducer.js';
import {
  potAddress, materializePool, verifyPoolPayout, computeWeightedDraw,
} from '../core/pool/pool-reducer.js';
import { materializeGenericContracts, verifyGenericRelease } from '../core/generic-contract-reducer.js';
import { extractModulePattern, summarizeModulePatterns } from '../core/ai/module-pattern-miner.js';
import {
  layoutFromPinnedIds, allModuleIdsInLayout, moveItem, createFolderFromDrop,
  mergeIntoFolder, ejectFromFolder, renameFolder, removeModuleFromLayout,
} from '../core/desktop/desktop-layout.js';
import { rankFromIdentityAndCadence, checkSubmissionEligibility, computeModuleRank } from '../core/modules/module-rank.js';
import { computeModuleHash } from '../core/modules/module-hash.js';
import { buildSubmissionEvent, validateSubmission, initialSubmissionState, recordNonce } from '../core/modules/module-submission.js';
import { mountModule } from '../core/modules/module-sandbox.js';
import { getTheme, DEFAULT_THEME_ID } from '../core/presentation/theme-tokens.js';
import { loadVerifiedModuleCode } from '../core/modules/module-loader.js';
import { verifyModuleIntegrity } from '../core/modules/module-hash.js';
import { vdfSeed, computeVdfChain } from '../core/economics/cadence-vdf.js';

const WALLET_STORAGE_PREFIX = 'aiwa-wallet-';
const DESKTOP_PIN_PREFIX = 'aiwa-desktop-pins-';
const CONTACT_DELAY_PREFIX = 'aiwa-contact-delay-';

// ── Domain identity: derived from a wallet's public key, never typed ─
// (deriveDomainId itself now lives in domain-id.js, shared with
// conservation-bridge.js's transfer-signature verification — see that
// file's header for why having two copies of this is exactly the kind
// of drift that silently breaks signature checks.)

// ── Domain replica ──────────────────────────────────────────────────

// ── Simulated network: real transport, real queueing, simulated wire ─
//
// There is no real network in this browser tab — this is honestly a
// simulation, not a claim otherwise. What is NOT simulated: the
// transport layer itself. Every domain's sync goes through a real
// createDelayTolerantTransport() instance (queue-then-attempt,
// FIFO-per-peer, real flush()), exactly as it would with a real
// backend behind sendFn. Only the "did the bytes actually leave the
// machine" primitive is faked, using the same untestable-network-seam
// pattern as solana-rpc.js — the queueing/timing logic built on top is
// exercised for real, not mocked away.

const allDomains = new Map(); // id -> DomainReplica, every real+test domain this tab knows about
const linkStates = new Map(); // "idA|idB" (sorted) -> boolean, connectivity between a pair — defaults to up

function linkKey(a, b) {
  return [a, b].sort().join('|');
}
function isLinkUp(a, b) {
  return linkStates.get(linkKey(a, b)) ?? true;
}
function setLinkUp(a, b, up) {
  linkStates.set(linkKey(a, b), up);
}

/**
 * The transport's injected sendFn — the one deliberately-fake piece.
 * When the simulated link is up, delivery is a real DAG merge()
 * (content-addressed, idempotent — the same mechanism proven correct
 * throughout this project, not a new serialization format invented for
 * this demo). When down, returns false, and the transport's own real
 * queueing logic takes over — this file has no queueing logic of its
 * own to keep in sync with delay-tolerant-transport.js's.
 */
async function simulatedNetworkSend(fromId, toId, payload) {
  if (!isLinkUp(fromId, toId)) return false;
  const from = allDomains.get(fromId);
  const to = allDomains.get(toId);
  if (!from || !to) return false;
  to.watchdog.recordActivity();
  from.watchdog.recordActivity();

  if (payload?.type === 'module-message') {
    // Real-time, module-addressed — deliver the actual payload to the
    // recipient's inbound dispatcher, not a DAG merge. If no module (or
    // a different one) is mounted there right now, the message is
    // simply not seen — there is no inbound queue on the receiving
    // side, matching real-time interaction semantics, not durable
    // delivery (§25's delay-tolerant transport still guarantees the
    // OUTER send() itself was queued if the link was down; what
    // happens once delivered is this app's own dispatch policy).
    to.handleInboundModuleMessage?.(fromId, payload.moduleId, payload.data);
    return true;
  }

  // Default: a sync-request, or any other payload — the existing
  // behavior, a real reconciliation merge.
  to.dag.merge(from.dag);
  from.dag.merge(to.dag);
  return true;
}

class DomainReplica {
  constructor(id, dag, keypair) {
    this.id = id;
    this.dag = dag;
    this.keypair = keypair;
    this.genesisId = null;
    this.lastEventId = null;
    this.lastCadenceId = null;
    this.lastCadenceVdfOutput = null; // R11 — the previous epoch's own real VDF chain output, seeds the next one
    this.epoch = 0;
    this.pending = [];
    this.activeFormulaId = GENESIS_FORMULA_ID; // local choice, not DAG state — see mintFormula()'s header
    this.transport = createDelayTolerantTransport((peerId, payload) => simulatedNetworkSend(this.id, peerId, payload));
    this.watchdog = createConnectionWatchdog({
      timeoutMs: 15000,
      onStale: () => log(`[${this.id}] connection watchdog: no activity for 15s — a real deployment would tear down and reinitialize the transport here (§25)`),
    });
    allDomains.set(id, this);
  }

  /**
   * Attempts to sync with `peerId` through the real transport — queues
   * if the simulated link is down, delivers a real DAG merge if up.
   * Replaces the earlier direct dag.merge() call this app used before
   * the transport layer existed: reconciliation now genuinely goes
   * through delay-tolerant-transport.js's queue-then-attempt logic,
   * not a special-cased shortcut.
   */
  async syncWith(peerId) {
    return this.transport.send(peerId, { type: 'sync-request' });
  }

  async flushTransport() {
    return this.transport.flush();
  }

  /**
   * R11: computes a real sequential-hash-chain proof before posting —
   * see cadence-vdf.js's own header. This is real, felt cost by
   * design, not a UX inconvenience to optimize away: the delay IS the
   * security property. cadenceVdfIterations is a per-deployment
   * config value (Parameters screen), matching §16.1's own stated
   * discipline that difficulty should never be a hardcoded constant.
   */
  async advanceCadence() {
    const nextEpoch = this.epoch + 1;
    const parents = [...new Set([this.lastCadenceId ?? this.genesisId, this.lastEventId])];
    const seed = vdfSeed(this.id, this.lastCadenceVdfOutput ?? 'genesis');
    const vdfOutput = computeVdfChain(seed, cadenceVdfIterations);
    const id = await this.dag.addEvent(parents, { type: 'cadence', domain: this.id, epoch: nextEpoch, vdfIterations: cadenceVdfIterations, vdfOutput });
    this.lastCadenceId = id;
    this.lastCadenceVdfOutput = vdfOutput;
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

  /**
   * Called after loading a domain from a persisted ledger
   * (event-dag-persistence.js), never for a brand-new domain. init()
   * alone is NOT enough here: it always resets lastEventId to genesis,
   * which is correct for a fresh domain but wrong for a restored one —
   * every subsequent addEvent() call in this app chains off
   * lastEventId as a single parent, so leaving it at genesis after
   * restoring real history would silently branch new events off the
   * very start, orphaning everything already accrued. Real, tested
   * state (cadence's own domains[id].lastId, §10) is used to recover
   * the true tip, not a guess.
   */
  restoreTipsFromDag() {
    const events = this.dag.topoOrder();
    if (events.length === 0) return;
    this.genesisId = events[0].id;
    this.lastEventId = events[events.length - 1].id; // the DAG's own deterministic topo order — this domain's own history is a single chain in practice, since only this domain ever adds to it directly
    const cadenceState = materializeG({ reward: GENESIS_FORMULA_PARAMS, budgets: {} }, events).cadence;
    const mine = cadenceState.domains[this.id];
    this.lastCadenceId = mine?.lastId ?? null;
    this.lastCadenceVdfOutput = mine?.vdfOutput ?? null;
    this.epoch = mine?.epoch ?? 0;
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
  /** Called by simulatedNetworkSend() when a real-time module message arrives — delivers to the currently-mounted module iframe only if this IS the domain whose UI has it open and it's the exact same module id. No inbound queue: real-time interaction, not durable delivery. */
  handleInboundModuleMessage(fromId, moduleId, data) {
    if (this === myDomain && activePluginModuleId === moduleId && activePluginHandle) {
      activePluginHandle.deliverPeerMessage(fromId, data);
    }
  }

  /**
   * Two-phase materialization, not circular despite the mutual
   * dependency it looks like at first: pool state needs Conservation's
   * real claim ownership to verify contributions are real (§
   * pool-reducer.js's own header — the general causal-contract
   * primitive a real community jackpot is one application of, not what
   * this mechanism is specifically for); Conservation needs pool state
   * (and, since §27.9's own last-mile work, generic-contract state too)
   * to verify 'pot-release' events. Resolved the same way every other
   * cross-reducer dependency in this project is — an explicit, ordered
   * pass, not a hidden import: (1) materialize Conservation with no
   * pot-release verifier at all (the safe default — every pot-release
   * is rejected, so this first pass simply excludes any payouts that
   * haven't happened yet); (2) materialize pool state AND generic-
   * contract state from that; (3) re-materialize Conservation, now
   * with a real verifier closing over both, so legitimate pot-release
   * events — whether for a pool or for a permissionlessly-minted
   * generic contract — are finally recognized and applied. A claim
   * that has already been legitimately released can never be
   * re-contributed regardless of which pass computed a given check
   * against it — the ownership test alone already prevents that — so
   * this two-pass order changes nothing about which contributions are
   * valid, only whether payouts already made are reflected in the
   * final view.
   *
   * The composed verifier tries the pool-specific check first, then
   * the generic-contract check — a pot-release event's releaseProof
   * carries either {poolId, cycleIndex} or {contractId}, structurally
   * distinguishable, so trying both in order is safe: a malformed or
   * mismatched releaseProof simply fails both and the release is
   * rejected, exactly matching every other reducer's tolerant-fold
   * discipline.
   */
  async materializeConservation() {
    const events = this.dag.topoOrder();
    const provisional = await materializeConservation(events);
    const poolState = materializePool(events, provisional.conservation);
    const genericContractState = materializeGenericContracts(events);
    const verifyPotRelease = async (claimId, from, to, releaseProof, conservationState) => {
      const poolOk = await verifyPoolPayout(poolState, conservationState, claimId, from, to, releaseProof);
      if (poolOk) return true;
      return verifyGenericRelease(genericContractState, conservationState, events, { computeWeightedDraw }, claimId, from, to, releaseProof);
    };
    return materializeConservation(events, verifyPotRelease);
  }

  /** The generic-contract view alone — a plugin defining a new permissionless contract (§27.9) reads this to see its own minted condition. */
  materializeGenericContracts() { return materializeGenericContracts(this.dag.topoOrder()); }

  /** The pool view alone — most callers (a plugin's own UI, e.g. the jackpot example) want this directly, not Conservation's full state. */
  async materializePool() {
    const events = this.dag.topoOrder();
    const conservationState = await materializeConservation(events);
    return materializePool(events, conservationState.conservation);
  }
  materializePublicProfiles() { return materializePublicProfiles(this.dag.topoOrder()); }

  materializeIdentity() { return materializeIdentity(this.dag.topoOrder(), identityChurnConfig ?? undefined); }

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
    const transferEvent = await buildSignedTransferEvent({ claimId, from: this.id, to: toDomainId }, seed, pubkeyBytes);
    id = await this.dag.addEvent([id], { type: 'transfer', ...transferEvent });
    this.lastEventId = id;
    return claimId;
  }
}

// ── Global state ────────────────────────────────────────────────────

let theta = { budgets: {} }; // .reward removed — see currentRewardParams(); §10's constants now live at formula id 'genesis', not here
let activeThemeId = DEFAULT_THEME_ID; // §27.5 presentation independence — a display preference, never DAG state
// R11: real, felt cost by design (cadence-vdf.js) — a per-deployment
// difficulty value, not a hardcoded constant (§16.1's own stated
// discipline). ~240ms on typical hardware at this default; a real
// deployment sizes this against its own target epoch duration and
// hardware, exactly like §16.1 already discusses for the heartbeat
// interval Δ.
let cadenceVdfIterations = 200000;
// §24 churn resistance: deployment-wide, real-slot-indexed identity
// cost (identity-cost.js's own header has the full rationale). OFF by
// default — this is a genuine, unresolved policy question (a legitimate
// late joiner years into a mature deployment pays the same escalated
// cost a churn attempt would), not something this reference
// implementation should silently decide for every deployment. A
// deployment that wants it configures genesisSlot + lamportsPerSlot in
// Parameters.
let identityChurnConfig = null;
// §28's deepened idea agent: real, GitHub-sourced trend data
// (scripts/fetch-github-trends.mjs's bot output, committed to
// data/github-trends.json). Fetched once, lazily, cached here — never
// awaited inside a render function, matching this project's own
// "delayed, never blocked" discipline (§7): the idea agent works
// identically whether this fetch has resolved yet, failed, or never
// runs at all (a partition, an offline build, a fresh clone before the
// bot's first scheduled run) — it just falls back to null, exactly
// like collectContextSnapshot's own documented default.
let cachedExternalTrends = null;
let externalTrendsFetchStarted = false;
function loadExternalTrendsOnce() {
  if (externalTrendsFetchStarted) return;
  externalTrendsFetchStarted = true;
  fetch('./data/github-trends.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { cachedExternalTrends = data; })
    .catch(() => { /* offline, partitioned, or file genuinely absent — cachedExternalTrends simply stays null, never blocks anything */ });
}

// §28's idea agent, further deepened at the user's own direct request
// after seeing a real YourMine pattern-mining system (mine-patterns.js
// / ym-spec.json) and asking for AIWA's own equivalent: which real ctx
// primitives already-registered modules actually use, mined from real,
// already-hash-verified source (loadVerifiedModuleCode — the exact
// content-addressing guarantee YourMine's own raw-fetch miner never
// had). Unlike the trends fetch above, this has no single external
// bot to poll — AIWA has no centralized module manifest a bot could
// crawl (module-pattern-miner.js's own header explains why) — so this
// mines whatever modules THIS domain already has in its own real
// registry. Bounded to a small sample and never awaited inside a
// render function, for the same reason as the trends fetch: mining
// works identically whether it has finished, is still running, or
// never started at all.
let cachedMechanismPatterns = null;
let mechanismMiningStarted = false;
const MAX_MODULES_TO_MINE = 20; // bounded — real network fetches per module, never worth doing for a potentially large registry on every idea-agent open
function mineMechanismPatternsOnce(registryState) {
  if (mechanismMiningStarted) return;
  mechanismMiningStarted = true;
  const entries = Object.values(registryState.modules).slice(0, MAX_MODULES_TO_MINE);
  Promise.all(entries.map(async (entry) => {
    try {
      const code = await loadVerifiedModuleCode(entry);
      return extractModulePattern(code, entry.id);
    } catch {
      return null; // an unreachable codeUrl or a failed integrity check simply doesn't contribute — never blocks the others
    }
  })).then((results) => {
    const extractions = results.filter(Boolean);
    cachedMechanismPatterns = summarizeModulePatterns(extractions);
  }).catch(() => { /* cachedMechanismPatterns simply stays null */ });
}
let myDomain = null; // the one real domain this app instance represents — null until a wallet exists
let testPeers = new Map(); // id -> DomainReplica, testing-only, never the primary UI concept
let submissionState = initialSubmissionState();
let solanaWeb3 = null;
let activePluginHandle = null; // { unmount, deliverPeerMessage } from mountModule(), or null
let activePluginModuleId = null; // which module id is currently mounted — lets an inbound peer message find its way in
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

/**
 * Reads this domain's desktop layout — icons and folders, in the exact
 * order the user last arranged them (desktop-layout.js). Migrates
 * transparently from the earlier flat array-of-ids format under the
 * SAME localStorage key, on read, so no existing user's pinned icons
 * are lost by this change; the migration is a pure, one-way upgrade
 * (old format read → new format returned), never written back until
 * the user's next real interaction saves it.
 */
function getDesktopLayout(domainId) {
  try {
    const raw = JSON.parse(localStorage.getItem(DESKTOP_PIN_PREFIX + domainId) || '[]');
    if (raw.length > 0 && typeof raw[0] === 'string') return layoutFromPinnedIds(raw); // old format
    return raw;
  } catch { return []; }
}
function setDesktopLayout(domainId, layout) { localStorage.setItem(DESKTOP_PIN_PREFIX + domainId, JSON.stringify(layout)); }

/** The flat set of pinned module ids, top-level or inside any folder — unchanged external behavior for every existing call site that only needs "is this module currently on the desktop," not the desktop's own arrangement. */
function pinnedIds(domainId) {
  return allModuleIdsInLayout(getDesktopLayout(domainId));
}
function togglePin(domainId, moduleId) {
  const layout = getDesktopLayout(domainId);
  const isPinned = allModuleIdsInLayout(layout).includes(moduleId);
  setDesktopLayout(domainId, isPinned ? removeModuleFromLayout(layout, moduleId) : [...layout, { kind: 'icon', moduleId }]);
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

  myDomain = new DomainReplica(id, await createPersistedLedger(id, createLedger), keypair);
  await myDomain.init();
  myDomain.restoreTipsFromDag(); // a brand-new domain: this is a no-op beyond confirming genesis is the tip
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

  myDomain = new DomainReplica(id, await createPersistedLedger(id, createLedger), keypair);
  if (myDomain.dag.size === 0) {
    await myDomain.init(); // genuinely first time this browser has seen this domain — nothing to restore
  }
  myDomain.restoreTipsFromDag(); // real history restored from IndexedDB — recover the true tip, not genesis
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
      type: 'identity-register', domain: myDomain.id, signature: result.signature, burnedLamports: result.burnedLamports, slot: result.slot, at: myDomain.epoch,
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
    async onSendToPeer(moduleId, peerId, data) {
      const delivered = await myDomain.transport.send(peerId, { type: 'module-message', moduleId, data });
      if (!delivered) log(`[plugin:${moduleId}] message to '${peerId}' queued — simulated link is down`);
      return delivered;
    },
    /**
     * The one Conservation primitive that genuinely cannot be generic:
     * a real, signed transfer, using the domain's real keypair, which
     * this handler holds and the sandboxed module never does. The
     * module only ever names WHICH claim and WHERE — it cannot forge
     * the `from`, since the signature itself is what proves control,
     * exactly as conservation-bridge.js already requires for every
     * transfer regardless of source (§7, Appendix H.18).
     */
    async onTransferClaim(moduleId, claimId, toDomainId) {
      const seed = myDomain.keypair.secretKey.slice(0, 32);
      const pubkeyBytes = myDomain.keypair.publicKey.toBytes();
      const event = await buildSignedTransferEvent({ claimId, from: myDomain.id, to: toDomainId }, seed, pubkeyBytes);
      const id = await myDomain.dag.addEvent([myDomain.lastEventId], { type: 'transfer', ...event });
      myDomain.lastEventId = id;
      log(`[plugin:${moduleId}] transferred claim '${claimId}' to '${toDomainId}'`);
      await renderAll();
      return true;
    },
    /**
     * The one general-purpose primitive for everything else — see
     * module-sandbox.js's own note on why this replaces what would
     * otherwise be a new bespoke ctx method per future contract.
     * `domain` and `postedBy` are ALWAYS forced to this domain's real
     * id here, overwriting anything the module supplied — this single
     * rule is what makes an otherwise-unrestricted event type safe to
     * post: a module can request anything, but can never claim to BE a
     * different domain while doing it. Whether the event is actually
     * ACCEPTED is entirely up to whichever reducer folds this event
     * type — this handler does not know or care what 'pool-contribute'
     * or any other type means, on purpose.
     */
    async onPostCausalEvent(moduleId, type, payload) {
      if (typeof type !== 'string' || !type) throw new Error('event type is required');
      const finalPayload = { ...payload, type, domain: myDomain.id, postedBy: myDomain.id, at: myDomain.epoch };
      const id = await myDomain.dag.addEvent([myDomain.lastEventId], finalPayload);
      myDomain.lastEventId = id;
      log(`[plugin:${moduleId}] posted '${type}' event`);
      await renderAll();
      return id;
    },
    /**
     * The read-side counterpart to postCausalEvent — a small, named
     * registry of materialized views a module may ask for. Extending
     * this to cover a future contract's own view is a change HERE
     * only, never to module-sandbox.js's own security boundary. Every
     * view returned is read-only data; nothing about calling this can
     * mutate anything.
     */
    async onQueryCausalState(moduleId, viewName, params) {
      if (viewName === 'pool') return await myDomain.materializePool();
      if (viewName === 'myBalance') return (myDomain.materialize()).balances[myDomain.id] ?? 0;
      if (viewName === 'myClaims') {
        const conState = await myDomain.materializeConservation();
        return Object.values(conState.conservation.claims).filter((c) => c.owner === myDomain.id && c.status === 'active');
      }
      if (viewName === 'poolClaims' && params?.poolId) {
        const conState = await myDomain.materializeConservation();
        return Object.values(conState.conservation.claims).filter((c) => c.owner === potAddress(params.poolId) && c.status === 'active');
      }
      if (viewName === 'poolDraw' && params?.poolId && Number.isInteger(params?.cycleIndex)) {
        const poolState = await myDomain.materializePool();
        const cycle = poolState.cycles[params.poolId]?.[params.cycleIndex];
        if (!cycle) return null;
        const { computeWeightedDraw } = await import('../core/pool/pool-reducer.js');
        return computeWeightedDraw(params.poolId, params.cycleIndex, cycle.contributions);
      }
      if (viewName === 'publicProfile' && params?.domainId) {
        return publishedDataForDomain(myDomain.materializePublicProfiles(), params.domainId);
      }
      return null; // unknown view name — degrade to null, never throw, so a module querying a not-yet-registered view fails gracefully
    },
  };

  activePluginHandle = await mountModule(containerEl, entry, code, verifyModuleIntegrity, hostHandlers, getTheme(activeThemeId), myDomain.id);
  activePluginModuleId = entry.id; // so an inbound transport message tagged for this module id can find its way in — see wireInboundModuleMessages()
  log(`[${myDomain.id}] running '${entry.id}' in a sandboxed iframe`);
}

function stopActiveModule() {
  if (activePluginHandle) {
    activePluginHandle.unmount();
    activePluginHandle = null;
  }
  activePluginModuleId = null;
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
  const layout = getDesktopLayout(myDomain.id);
  const rankOf = (moduleId) => {
    const m = registry.modules[moduleId];
    return m ? rankFromIdentityAndCadence(localIdentityState, gState.cadence, m.author, myDomain.currentRewardParams()) : 0;
  };

  const iconsEl = document.getElementById('desktop-icons');
  const emptyEl = document.getElementById('desktop-empty');
  if (layout.length === 0) {
    emptyEl.style.display = 'block';
    iconsEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  iconsEl.innerHTML = '';
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    const tile = document.createElement('div');
    tile.className = 'icon-tile';
    tile.dataset.index = String(i);

    if (item.kind === 'folder') {
      const glyphs = item.moduleIds.slice(0, 4).map((id) => registry.modules[id]?.icon || '⬡').join('');
      tile.innerHTML = `<div class="icon-glyph icon-glyph--folder">${glyphs}</div><div>${item.label}</div>`;
      tile.title = `${item.moduleIds.length} module${item.moduleIds.length === 1 ? '' : 's'}`;
      tile.addEventListener('click', () => openFolderPanel(item.id));
    } else {
      const m = registry.modules[item.moduleId];
      if (!m) continue; // a module that was unregistered since being pinned — skip rather than render a broken tile
      tile.innerHTML = `<div class="icon-glyph">${m.icon || '⬡'}</div><div>${m.name}</div>`;
      tile.title = `rank ${rankOf(item.moduleId).toFixed(2)}`;
      tile.addEventListener('click', () => runModule(m));
    }
    setupDesktopTileDrag(tile, iconsEl, i);
    iconsEl.appendChild(tile);
  }
}

/**
 * Real pointer-based drag-and-drop for one desktop tile — adapted from
 * the real mechanism in YourMine's desk.js (pointerdown/pointermove/
 * pointerup, not the HTML5 native drag API, since pointer events work
 * uniformly across touch and mouse) — scoped to AIWA's single-page
 * desktop grid: no multi-page edge-scroll, since AIWA's desktop has no
 * pagination concept to scroll between. Untestable in this development
 * sandbox for the same reason module-sandbox.js's DOM code is (no real
 * browser under `node --test`) — every RULE about where a drop lands
 * lives in desktop-layout.js instead, fully tested there; this
 * function only translates real pointer coordinates into calls to
 * those already-verified pure functions.
 */
function setupDesktopTileDrag(tile, gridEl, index) {
  let startX = 0, startY = 0, dragging = false, pointerDown = false;
  let ghost = null;

  tile.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    pointerDown = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
  });

  tile.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!dragging && dist > 8) {
      dragging = true;
      try { tile.setPointerCapture(e.pointerId); } catch { /* not critical if unsupported */ }
      ghost = tile.cloneNode(true);
      ghost.style.cssText = 'position:fixed;pointer-events:none;opacity:0.85;z-index:50;width:3rem;';
      document.body.appendChild(ghost);
      tile.style.opacity = '0.35';
    }
    if (!dragging) return;
    e.preventDefault();
    ghost.style.left = `${e.clientX - 24}px`;
    ghost.style.top = `${e.clientY - 24}px`;

    for (const other of gridEl.querySelectorAll('.icon-tile')) other.classList.remove('icon-tile--drop-target');
    const dropTarget = elementUnderPoint(gridEl, e.clientX, e.clientY);
    if (dropTarget && dropTarget !== tile) dropTarget.classList.add('icon-tile--drop-target');
  });

  tile.addEventListener('pointerup', async (e) => {
    pointerDown = false;
    if (!dragging) return;
    dragging = false;
    ghost?.remove();
    ghost = null;
    tile.style.opacity = '';
    for (const other of gridEl.querySelectorAll('.icon-tile')) other.classList.remove('icon-tile--drop-target');

    const dropTarget = elementUnderPoint(gridEl, e.clientX, e.clientY);
    if (!myDomain) return;
    let layout = getDesktopLayout(myDomain.id);

    if (!dropTarget || dropTarget === tile) {
      // Dropped on empty grid space, or back on itself — treat as a
      // reorder to the nearest position (or a no-op if it's itself).
      return;
    }

    const targetIndex = Number(dropTarget.dataset.index);
    const targetItem = layout[targetIndex];
    if (targetItem?.kind === 'folder') {
      layout = mergeIntoFolder(layout, index, targetItem.id);
    } else {
      layout = createFolderFromDrop(layout, index, targetIndex, () => `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    }
    setDesktopLayout(myDomain.id, layout);
    await renderAll();
  });

  tile.addEventListener('pointercancel', () => {
    pointerDown = false;
    dragging = false;
    ghost?.remove();
    ghost = null;
    tile.style.opacity = '';
  });
}

/** Hit-tests real screen coordinates against the grid's own tiles — simpler than YourMine's manual grid-cell math, since AIWA's desktop is a real CSS grid the browser already lays out; elementFromPoint reads that layout directly rather than recomputing it. */
function elementUnderPoint(gridEl, x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('.icon-tile');
}

let openFolderId = null;

function openFolderPanel(folderId) {
  openFolderId = folderId;
  renderFolderPanel();
  document.getElementById('folder-panel').classList.remove('folder-panel-hidden');
}
function closeFolderPanel() {
  openFolderId = null;
  document.getElementById('folder-panel').classList.add('folder-panel-hidden');
}

function renderFolderPanel() {
  if (!myDomain || !openFolderId) return;
  const layout = getDesktopLayout(myDomain.id);
  const folder = layout.find((it) => it.kind === 'folder' && it.id === openFolderId);
  if (!folder) { closeFolderPanel(); return; }

  const registry = myDomain.materializeModules();
  document.getElementById('folder-panel-label').value = folder.label;
  const listEl = document.getElementById('folder-panel-items');
  listEl.innerHTML = '';
  for (const moduleId of folder.moduleIds) {
    const m = registry.modules[moduleId];
    if (!m) continue;
    const row = document.createElement('div');
    row.className = 'folder-item-row';
    row.innerHTML = `<div class="icon-glyph">${m.icon || '⬡'}</div><div class="folder-item-name" style="flex:1">${m.name}</div><button class="eject-btn" title="Remove from folder">↩</button>`;
    row.querySelector('.folder-item-name').addEventListener('click', () => runModule(m));
    row.querySelector('.icon-glyph').addEventListener('click', () => runModule(m));
    row.querySelector('.eject-btn').addEventListener('click', async () => {
      setDesktopLayout(myDomain.id, ejectFromFolder(getDesktopLayout(myDomain.id), openFolderId, moduleId));
      await renderAll();
    });
    listEl.appendChild(row);
  }
}

function renderDomainScreen() {
  if (!myDomain) return;
  const gState = myDomain.materialize();
  const registry = myDomain.materializeModules();
  const localIdentityState = myDomain.materializeIdentity();

  loadExternalTrendsOnce();
  mineMechanismPatternsOnce(registry);
  const myPinnedModuleIds = pinnedIds(myDomain.id);
  const myPublishedData = publishedDataForDomain(myDomain.materializePublicProfiles(), myDomain.id);
  const ideaSnapshot = collectContextSnapshot(registry, myDomain.id, realContactIds(), { pinnedModuleIds: myPinnedModuleIds, publishedData: myPublishedData }, cachedExternalTrends, cachedMechanismPatterns);
  const contactCount = Object.keys(ideaSnapshot.contactModules).length;
  document.getElementById('idea-network-info').textContent =
    `Sees: ${ideaSnapshot.myModules.length} of your modules, ${contactCount} contact${contactCount === 1 ? '' : 's'} with registered modules.`;

  const pinned = new Set(myPinnedModuleIds);
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
    const schemeLabel = m.identityScheme ? (m.identityScheme === 'strong' ? '🔒 strong id' : '🔓 weak id') : 'non-issuing';
    row.innerHTML = `<div class="catalog-icon">${m.icon || '⬡'}</div><div class="catalog-info"><div class="catalog-name">${m.name}</div><div class="catalog-meta">rank ${m.rank.toFixed(2)} · ${m.auditStatus} · <span title="§11's Lemma 1: strong id required whenever this module's own reward is time-sensitive; weak id is cheaper and safe only when it isn't.">${schemeLabel}</span></div></div><button data-id="${m.id}">${isPinned ? '− Remove' : '+ Add'}</button>`;
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
      <p class="msg send-msg"></p>
      <button class="visit-profile-btn full-btn" style="margin-top:0.3rem">👤 Visit profile</button>
      <div class="visit-profile-panel" style="display:none;margin-top:0.4rem;font-size:0.78rem"></div>`;
    row.querySelector('.visit-profile-btn').addEventListener('click', () => {
      const panel = row.querySelector('.visit-profile-panel');
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
      if (isOpen) return;
      const published = publishedDataForDomain(myDomain.materializePublicProfiles(), d);
      const moduleIds = Object.keys(published);
      if (moduleIds.length === 0) {
        panel.innerHTML = '<p class="hint">This domain has published nothing publicly (§27.2/hyperprofile) — or you have not reconciled with it recently enough to see it.</p>';
        return;
      }
      panel.innerHTML = moduleIds.map((moduleId) => {
        const entries = Object.entries(published[moduleId]).map(([key, { value }]) => `<div class="stat-row"><span>${key}</span><span>${typeof value === 'object' ? JSON.stringify(value) : String(value)}</span></div>`).join('');
        return `<div style="margin-bottom:0.3rem"><strong>${moduleId}</strong>${entries}</div>`;
      }).join('');
    });
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

  const selectedPeer = targetSelect.value;
  if (myDomain && selectedPeer) {
    const linkUp = isLinkUp(myDomain.id, selectedPeer);
    document.getElementById('link-toggle-btn').textContent = linkUp ? '🔗 Link up — click to simulate a partition' : '⛓️‍💥 Link down — click to reconnect';
    document.getElementById('link-toggle-btn').disabled = false;
    document.getElementById('queue-depth-display').textContent = String(myDomain.transport.queueDepth(selectedPeer));
    document.getElementById('flush-btn').disabled = myDomain.transport.queueDepth(selectedPeer) === 0;
  } else {
    document.getElementById('link-toggle-btn').disabled = true;
    document.getElementById('queue-depth-display').textContent = '–';
    document.getElementById('flush-btn').disabled = true;
  }
}

async function renderAll() {
  await renderDesktop();
  renderDomainScreen();
  renderProfileScreen();
  renderCommitScreen();
  renderContactsScreen();
  renderParametersScreen();
  if (openFolderId) renderFolderPanel();
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
  const peer = allDomains.get(peerId);
  if (!peer) return;
  const delivered = await myDomain.syncWith(peerId);
  if (!delivered) {
    log(`[${myDomain.id}] sync with '${peerId}' queued — simulated link is down (real delay-tolerant queueing, not a shortcut). ${myDomain.transport.queueDepth(peerId)} message(s) waiting.`);
    await renderAll();
    return;
  }
  const mineFromMine = myDomain.materialize().balances[myDomain.id] ?? 0;
  const mineFromPeer = peer.materialize().balances[myDomain.id] ?? 0;
  const converged = mineFromMine === mineFromPeer;
  log(`Reconciled with test peer '${peerId}' via transport (${myDomain.dag.size} events on both sides now).`);
  log(converged ? 'Convergence check passed: both replicas agree (§9).' : 'Convergence check FAILED — bug.');
  await renderAll();
}

async function flushPendingSync() {
  if (!myDomain) return;
  const count = await myDomain.flushTransport();
  log(`[${myDomain.id}] flush attempted — ${count} queued message(s) actually delivered this pass.`);
  await renderAll();
}

// ── Submission ────────────────────────────────────────────────────

// ── AI idea agent (§28, deliberately scoped to only this) ───────────
// No cancel-mid-generation path exists yet — the streamChat generator
// itself supports an injected stop signal (webllm-engine.js), but
// nothing in this UI currently produces one. Recorded as an honest gap
// rather than left as inert, never-called scaffolding.

function realContactIds() {
  if (!myDomain) return [];
  const state = myDomain.materialize();
  return Object.keys(state.cadence.domains).filter((d) => d !== myDomain.id);
}

async function requestModuleIdea() {
  if (!myDomain) return;
  const btn = document.getElementById('idea-btn');
  const resultEl = document.getElementById('idea-result');
  const msgEl = document.getElementById('idea-msg');
  btn.disabled = true;
  msgEl.textContent = '';
  resultEl.textContent = '';

  try {
    msgEl.textContent = 'Checking on-device AI support…';
    const support = await detectWebGpuSupport();
    if (!support.supported) {
      msgEl.textContent = `❌ ${support.reason}`;
      msgEl.className = 'msg error';
      return;
    }

    const registry = myDomain.materializeModules();
    loadExternalTrendsOnce();
    mineMechanismPatternsOnce(registry);
    const snapshot = collectContextSnapshot(registry, myDomain.id, realContactIds(), {
      pinnedModuleIds: pinnedIds(myDomain.id),
      publishedData: publishedDataForDomain(myDomain.materializePublicProfiles(), myDomain.id),
    }, cachedExternalTrends, cachedMechanismPatterns);
    const systemPrompt = buildIdeaSystemPrompt(snapshot);

    msgEl.textContent = 'Loading on-device model — first run downloads it, later runs reuse it…';
    const engine = await loadEngine((p) => { msgEl.textContent = `Loading model: ${Math.round((p.progress ?? 0) * 100)}% — ${p.text ?? ''}`; });

    msgEl.textContent = 'Thinking…';
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Suggest one module idea based on what you see in this network.' },
    ];
    let full = '';
    for await (const chunk of streamChat(engine, support.model, messages, 280)) {
      full += chunk;
      resultEl.textContent = full;
    }
    full = sanitizeIdeaReply(full);
    resultEl.textContent = full || '(no response — try again)';
    msgEl.textContent = '';
  } catch (err) {
    msgEl.textContent = `❌ ${err.message}`;
    msgEl.className = 'msg error';
  } finally {
    btn.disabled = false;
  }
}


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

  const isIssuing = document.getElementById('submit-issuing').checked;
  let timeSensitive = null;
  let economicConfig = null;
  if (isIssuing) {
    timeSensitive = document.getElementById('submit-time-sensitive').checked;
    const alpha = parseFloat(document.getElementById('submit-alpha').value);
    const scarcityPolicy = document.getElementById('submit-scarcity').value.trim();
    // identityCostMechanism is derived, not typed: whether THIS domain
    // actually has a verified burn right now — matching §24.1's real
    // requirement (a genuine identity cost, not a self-declared label).
    const identityCostMechanism = hasIdentityCost(myDomain.materializeIdentity(), myDomain.id) ? 'sol-burn' : null;
    economicConfig = { alpha, identityCostMechanism, scarcityPolicy: scarcityPolicy || null };
  }

  const event = await buildSubmissionEvent(
    { moduleId, codeHash, codeUrl, name: moduleId, icon: '⬡', category: 'Tools', description: '', isIssuing, timeSensitive, economicConfig },
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
  document.getElementById('idea-btn').addEventListener('click', requestModuleIdea);
  document.getElementById('submit-issuing').addEventListener('change', (e) => {
    document.getElementById('issuing-fields').style.display = e.target.checked ? 'block' : 'none';
  });
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
  document.getElementById('theme-select').addEventListener('change', (e) => {
    activeThemeId = e.target.value; // local display preference — deliberately never touches theta, myDomain, or any DAG state
    log(`Presentation switched to '${activeThemeId}' — no module, rank, or economic state changed (§27.5).`);
  });
  document.getElementById('cadence-vdf-iterations').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isInteger(n) && n >= 1) {
      cadenceVdfIterations = n;
      log(`Cadence VDF difficulty set to ${n} iterations — a real, felt cost on every future epoch advance for this domain (R11).`);
    }
  });
  const updateChurnConfig = () => {
    const enabled = document.getElementById('churn-config-enabled').value === 'on';
    if (!enabled) {
      identityChurnConfig = null;
      log('Identity churn resistance disabled — no real-slot-indexed cost curve enforced (§24).');
      return;
    }
    const genesisSlot = parseInt(document.getElementById('churn-genesis-slot').value, 10);
    const lamportsPerSlot = parseInt(document.getElementById('churn-lamports-per-slot').value, 10);
    if (!Number.isInteger(genesisSlot) || !Number.isInteger(lamportsPerSlot) || lamportsPerSlot < 0) return;
    identityChurnConfig = { genesisSlot, costCurve: linearCostCurve({ baseLamports: 0, lamportsPerSlot }) };
    log(`Identity churn resistance enabled — genesis slot ${genesisSlot}, ${lamportsPerSlot} lamports/slot (§24, a deployment policy choice, not a prescribed default).`);
  };
  document.getElementById('churn-config-enabled').addEventListener('change', updateChurnConfig);
  document.getElementById('churn-genesis-slot').addEventListener('change', updateChurnConfig);
  document.getElementById('churn-lamports-per-slot').addEventListener('change', updateChurnConfig);
  document.getElementById('folder-panel-close').addEventListener('click', closeFolderPanel);
  document.getElementById('folder-panel-label').addEventListener('change', async (e) => {
    if (!myDomain || !openFolderId) return;
    setDesktopLayout(myDomain.id, renameFolder(getDesktopLayout(myDomain.id), openFolderId, e.target.value));
    await renderAll();
  });
  document.getElementById('contacts-search').addEventListener('input', renderContactsScreen);

  document.getElementById('create-test-peer-btn').addEventListener('click', createTestPeer);
  document.getElementById('reconcile-btn').addEventListener('click', () => {
    const target = document.getElementById('reconcile-target').value;
    if (target) reconcileWithTestPeer(target);
  });

  document.getElementById('reconcile-target').addEventListener('change', renderParametersScreen);

  document.getElementById('link-toggle-btn').addEventListener('click', async () => {
    if (!myDomain) return;
    const target = document.getElementById('reconcile-target').value;
    if (!target) return;
    const nowUp = !isLinkUp(myDomain.id, target);
    setLinkUp(myDomain.id, target, nowUp);
    log(`[${myDomain.id}] simulated link with '${target}' set to ${nowUp ? 'UP' : 'DOWN'}.`);
    await renderAll();
  });

  document.getElementById('flush-btn').addEventListener('click', flushPendingSync);

  // Real periodic staleness detection — the watchdog logic itself is
  // already fully tested with an injected clock (connection-watchdog.test.mjs);
  // this interval is just what calls checkStale() on a real wall clock
  // in the live app, the one piece that can't be unit-tested.
  setInterval(() => {
    if (myDomain) myDomain.watchdog.checkStale();
  }, 5000);

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
