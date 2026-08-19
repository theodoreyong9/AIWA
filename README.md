This project is the Safe version of the YourMine project
https://github.com/theodoreyong9/YourMinedApp

# AIWA — Autonomous Interplanetary Web Application

Reference implementation of the AIWA architecture: an event DAG (H_d) plus a materialized state view A = G(H_d, θ), deployed as a static app with no server and no build step.

The ledger has two interchangeable backends:

- **`public/js/core/event-dag.js`** — pure JS, zero dependencies, runs in production today.
- **`rust-core/`** — Rust compiled to WASM, replaces the JS version for performance and third-party module sandboxing.

`public/js/core/ledger-bridge.js` is the sole entry point. It loads WASM if present, falls back to JS. No other code depends on which backend is active. Both backends are verified against each other via shared test vectors and cross-language parity scripts.

---

## Repository structure

```
AIWA/
├── public/
│   ├── index.html
│   ├── css/
│   │   └── aiwa.css                    ← Design system (dark base, amber accent, IBM Plex, hairline borders)
│   ├── data/
│   │   └── github-trends.json          ← Daily GitHub trends feed for the idea agent
│   └── js/
│       ├── app/
│       │   └── main.js                 ← Entry point; wires all reducers, transport, UI panels
│       └── core/
│           ├── event-dag.js                ← Reference JS ledger; subscribe() for persistence hooks
│           ├── event-dag-persistence.js    ← IndexedDB persistence (H_d survives tab close)
│           ├── ledger-bridge.js            ← Backend selector (WASM or JS)
│           ├── wasm-ledger-adapter.js      ← Translates raw wasm-bindgen surface to JS EventDag interface
│           ├── domain-id.js                ← Deterministic domain id: SHA-256(pubkey), 64 hex chars
│           ├── economics/
│           │   ├── cadence.js              ← Monotonic epoch reducer; replay-protected; bounded +1
│           │   ├── cadence-vdf.js          ← Sequential SHA-256 chain (non-parallelizable); mandatory on every cadence transition
│           │   ├── reward.js               ← Proof-of-Will: r(b,q,q_total,T) = (b·q^α)/[ln(q_total^(β(1−T))+C)]^γ
│           │   ├── scarcity.js             ← Preallocated-budget policy; applyIssuanceAttempt(); simulateHourlyIssuance()
│           │   ├── g.js                    ← A = G(H_d, θ); full fold over topoOrder
│           │   └── formula-registry-reducer.js ← Immutable formula minting; 'genesis' is the protocol default
│           ├── conservation/
│           │   ├── conservation.js         ← Claim state machine: Deactivate→Prove→Verify→Consume→Activate
│           │   └── conservation-bridge.js  ← claim-issue / transfer (Ed25519-signed) / pot-release DAG events
│           ├── identity/
│           │   ├── identity-cost.js        ← c_id verification; identity-churn resistance (slot-scaled cost curve)
│           │   ├── identity-cost-reducer.js← identity-register as a real DAG event; replicated by merge()
│           │   ├── solana-networks.js      ← devnet / mainnet config; devnet default
│           │   ├── solana-wallet.js        ← Real keypair generation; AES-256-GCM encryption; burn-tx construction+signing
│           │   ├── solana-rpc.js           ← Real mainnet/devnet broadcast; untestable here (no network path)
│           │   └── identity-flow.js        ← Orchestrates wallet → broadcast → verify → DAG event
│           ├── modules/
│           │   ├── module-hash.js          ← Content-addressing: SHA-256 of module code
│           │   ├── module-registry.js      ← Open registration; economic self-declaration; audit status reset on code change
│           │   ├── module-registry-reducer.js ← Registry as a materialized view over H_d; propagates via merge()
│           │   ├── module-rank.js          ← Sort key (r(b,q) of author's burn+epoch); submission eligibility (ratio check); rankFromIdentityAndCadence()
│           │   ├── module-submission.js    ← Signed pipeline: real Ed25519 (@noble/curves); replay-guarded nonces; hash-checked against fetched code; author-only updates
│           │   ├── module-fetch.js         ← Real fetch(codeUrl) + submission; untestable here
│           │   ├── module-loader.js        ← Fetch + hash-verify before mounting (not before submitting)
│           │   └── module-sandbox.js       ← Real <iframe sandbox="allow-scripts"> without allow-same-origin;
│           │                                  ctx bridged over postMessage; theme injected as CSS vars + ctx.theme JSON;
│           │                                  hash-mismatch blocks mounting; close button unmounts cleanly
│           ├── transport/
│           │   ├── transport.js                ← Interface definition; assertImplementsTransport() makes partial implementations fail loudly
│           │   ├── delay-tolerant-transport.js ← Durable queue-then-attempt; FIFO per peer; stops at first failure; no reordering
│           │   └── connection-watchdog.js      ← Fires stale callback exactly once per episode; resets on reconnect
│           ├── pool/
│           │   └── pool-reducer.js         ← General pooling primitive: pool-init / pool-contribute / pot-release;
│           │                                  pot address has no keypair; verifyPoolPayout uses causal-condition-evaluator
│           ├── contracts/
│           │   └── generic-contract-reducer.js ← Composable declarative contracts; condition fixed permanently at mint time;
│           │                                      release event supplies only claimId/from/to/contractId; cannot smuggle a condition
│           ├── verification/
│           │   └── causal-condition-evaluator.js ← Six primitives: ownership / signature / count / deterministic-match / unique / causal-order;
│           │                                        composed as AND/OR/NOT declarative data; never executes submitted code
│           ├── presentation/
│           │   └── theme-tokens.js         ← Two presets: default / compact (monospace, max contrast, for bandwidth-constrained nodes);
│           │                                  both declare identical token key sets; themeToCssVariables() produces real :root{} block
│           ├── desktop/
│           │   └── desktop-layout.js       ← Pure DOM-free logic: reorder / fold two icons into folder / merge into existing /
│           │                                  eject / remove; rank computed + displayed but does not control layout order;
│           │                                  storage migration from flat pin lists is transparent
│           └── ai/
│               ├── idea-agent.js           ← Context builder: real desktop pins, published module data, recency-weighted category
│               │                              trends, category gaps, multi-contact overlap (2+ distinct contacts required);
│               │                              prompt constructor; reply sanitizer; never writes to consensus
│               ├── webllm-engine.js        ← Real WebGPU / dedicated Worker / @mlc-ai/web-llm streaming; untestable here
│               ├── module-pattern-miner.js ← Mines real ctx primitive usage across local registry (loadVerifiedModuleCode);
│               │                              reports which primitives are never used by any module
│               └── public-profile-reducer.js ← Hyperprofile: DAG-replicated key/value; latest-write-wins; null retracts
├── rust-core/
│   ├── src/
│   │   ├── core.rs / dag.rs / event.rs / lib.rs
│   │   ├── economics/      ← cadence, cadence_vdf, reward, scarcity, g, formula_registry_reducer
│   │   ├── conservation/   ← conservation (mod.rs), conservation_bridge
│   │   ├── identity/       ← identity-cost + identity_cost_reducer (full mirror incl. churn resistance)
│   │   ├── modules/        ← module_hash, module_registry, module_registry_reducer, module_rank, module_submission
│   │   ├── pool/           ← pool_reducer
│   │   ├── contracts/      ← generic_contract_reducer (with hand-written parse_condition — no serde derive for Condition enum)
│   │   ├── verification/   ← causal_condition_evaluator
│   │   └── ai/             ← public_profile_reducer
│   ├── examples/           ← check_id_parity, check_g_parity, check_conservation_parity,
│   │                          sign_submission_rust, verify_submission_from_js
│   └── tests/              ← g_scenario, counterexample_wallclock, conservation_scenario,
│                              counterexample_nonatomic_consume, pool_parity (cross-language draw hash)
├── tests/                  ← 415 JS tests
├── test-vectors/           ← id-parity.json / g-scenario.json / conservation-scenario.json
├── scripts/
│   ├── verify-parity.sh
│   ├── verify-g-parity.sh
│   ├── verify-conservation-parity.sh
│   ├── verify-submission-parity.sh    ← Both directions: JS signs → Rust verifies; Rust signs → JS verifies
│   └── fetch-github-trends.mjs
├── examples/
│   └── jackpot-plugin/jackpot.js      ← Real example plugin: jackpot funded and paid in AIWA
├── docs/
│   └── AIWA_whitepaper_v1_2_revised.md
├── package.json            ← Test-only devDependencies (@solana/web3.js, @noble/curves); app itself uses CDN
└── .github/workflows/
    ├── ci.yml                     ← Rust tests + all parity scripts + WASM build + auto-commit of binary
    ├── deploy-pages.yml           ← Deploys public/ to GitHub Pages on push to main
    └── update-github-trends.yml   ← Daily: GitHub search API → public/data/github-trends.json
```

---

## Layers

### Ledger — event DAG (H_d)

`event-dag.js` is a content-addressed DAG of events. Each event's id is SHA-256 of its canonicalized (key-sorted) payload and parent ids. `merge()` is a set union — idempotent, order-independent. `topoOrder()` sorts events id-first depth-first; this tie-breaking rule is part of the protocol contract, not an implementation detail (two implementations can each be internally deterministic while disagreeing on concurrent branches if they pick different tie-breaking rules).

`subscribe()` notifies listeners when genuinely new events are added via `addEvent()` or `merge()`. Re-adding an already-known event does not fire.

**Persistence**: `event-dag-persistence.js` uses IndexedDB. H_d survives tab close and page reload. `topologicalSortForReplay()` is extracted as pure logic and tested: its output is confirmed replayable through a real EventDag without hitting unknown-parent rejections. `restoreTipsFromDag()` recovers the domain's real cadence tip after restore, so a post-restore cadence advance correctly chains from the last known epoch rather than from genesis.

**Domain identity**: a domain id is `SHA-256(publicKey)` truncated to 64 hex characters (256 bits). `shortDomainLabel()` truncates for display only. The full id is used inside every signature verification path.

**JS/Rust id parity**: `JSON.stringify` preserves key insertion order; `serde_json` sorts keys alphabetically. The JS side recursively canonicalizes (sorts) object keys before hashing, matching Rust. Verified by `scripts/verify-parity.sh` over `test-vectors/id-parity.json` (flat payloads, nested payloads, arrays, unsorted parents, different key orders for the same logical object). 6/6 vectors match. Runs in CI on every push.

---

### Economics — G(H_d, θ)

`A = G(H_d, θ)` is a fold over a topologically-ordered event list. Three event types:

- `genesis` — initializes a domain
- `cadence` — advances q_d (monotonic, replay-protected, bounded +1, must carry a VDF proof)
- `accrual` — carries `{domain, b, q0}`; derives q from cadence state as folded so far; computes reward; hands the clamped issued amount to the scarcity reducer

**Reward formula** (Proof-of-Will, adapted from YourMine's `calcClaimable()`):

```
r(b, q, q_total, T) = (b · q^α) / [ln(q_total^(β(1−T)) + C)]^γ
```

Reference constants: α=1.1, β=2.2, γ=3, C=35937. Verified byte-for-byte JS and Rust: `r(1, 100, 100, 0) = 0.11844290947765648`, confirmed three ways (direct call, full cadence replay through real EventDag, cross-language parity script).

`q_total` is the domain's own cadence epoch count — not a shared global chain height, which would reintroduce cross-domain synchrony. The minimum-slot wait from the original formula becomes `minQ`, a deployment-chosen epoch count.

**Scarcity**: `applyIssuanceAttempt()` clamps reward to remaining per-domain budget (or unclamped for the unbounded control case). `simulateHourlyIssuance()` reproduces the whitepaper's simulation loop. Verified against the paper's own worked numbers: I(1000h)=2000, I(10000h)=20000 unbounded; saturates at 10000 under a 5000+5000 preallocated budget.

**Cadence VDF**: every cadence transition must carry a sequential SHA-256 chain: `h_i = SHA-256(h_{i-1})`, seeded from the domain and the prior epoch's real VDF output. Epoch N's proof cannot start without epoch N-1's real result. Verification means recomputing the chain. Iteration count is configurable in the Parameters screen (default 200,000 ≈ 240ms on typical hardware). Not a true asymmetric VDF — verification costs what computation costs. Difficulty is hardware-relative. Closes the ability to post thousands of structurally-valid cadence transitions within milliseconds of real time.

**Formula registry**: `formula-registry-reducer.js` makes reward parameters immutable once registered. A `formula-register` event mints an id permanently bound to fixed `(alpha, beta, gamma, C, minQ)` — no update path, ever. The same id cannot be re-minted with different parameters. `'genesis'` is the fixed protocol default, needing no event or burn (avoids a bootstrapping paradox). Which formula a domain currently uses is a separate, local, non-permanent choice from whether that formula exists. Two domains using silently different θ would materialize different balances from the same accrual event — this closes that fork risk.

**Sybil analysis**: capital-splitting is exactly reward-neutral before identity cost under the current formula's linear b-term — any c_id > 0 makes N*=1 optimal unconditionally. Identity churn (abandoning an aging domain for a fresh one to dodge the age-decay term) is confirmed to pay near genesis but reaches a crossover within a handful of simulated rounds as deployment matures. Damped by the slot-scaled identity cost curve (off by default).

---

### Conservation — claim state machine

Conservation moves or converts an *existing* claim. It never creates value; that is G's job. The five pipeline steps (`Deactivate → Prove → Verify → Consume → Activate`) are individually callable functions, not a black-box orchestrator.

A transfer is a transmutation whose derivation function is `identityDerivation`. The load-bearing invariant — `count(Consume(p)) ≤ 1` — is a direct port of the whitepaper's reference pseudocode.

**Wired to economics via `conservation-bridge.js`**:

- `claim-issue`: debits a domain's real G-balance (checks against G's rejected event id set; cannot issue more than was accrued), creates a spendable claim
- `transfer`: runs the full Deactivate→Prove→Verify→Consume→Activate pipeline; requires a real Ed25519 signature over `(claimId, from, to, nonce, timestamp)` verified against `signerPubkey`; further checks that `SHA-256(signerPubkey) == from` (proof of control, not a declared label); nonce replay guard
- `pot-release`: accepted without a signature only when an injected verifier (supplied by the caller, never hardcoded) confirms the release matches what the deterministic contract says it should be

A plain string ownership check (`claim.owner == from`) would allow any reconciled peer to forge a transfer. Confirmed rejected in tests: a real attacker keypair signing a transfer from someone else's domain id is blocked; victim's claim is untouched.

---

### Identity — c_id

**Mechanism**: before partition (while still connected), a domain burns real SOL to the Solana incinerator address (`1nc1nerator11111111111111111111111111111111`). The transaction signature becomes that domain's c_id proof. The cost is sunk instantly — no enforcement dependency during arbitrarily long partition, unlike bonded staking where slashing must be enforced after misbehavior is detected.

The verified burn is recorded as an `identity-register` DAG event, folded and propagated by `merge()`. Two domains that reconcile will learn each other's registered identities. Identity state was formerly a standalone variable that lived only in the registering domain's memory and was never replicated.

**Identity-churn resistance**: the burn required for a NEW registration scales monotonically with the real Solana slot number at which the burn was confirmed (configurable cost curve, off by default). The slot is already present in `getTransaction()`'s response — no new RPC call needed. This dampens the attack where a domain abandons an aging identity to dodge the reward formula's age-decay term. Does not distinguish an attacker from a legitimate late joiner; the tradeoff is stated, not decided.

**Files**:

- `identity-cost.js` / `mod.rs` — pure verification and registration logic; chain-agnostic (`NormalizedBurnTx` shape)
- `solana-wallet.js` — real keypair (Ed25519), AES-256-GCM password encryption via Web Crypto, burn-tx construction and signing; tested against the real `@solana/web3.js`; a real signature is verified by round-tripping through the library's own deserializer
- `solana-rpc.js` — real `fetch()` to a real Solana endpoint; has never been exercised here (no network path); confirmed real code, not a stub
- `identity-flow.js` — orchestrates wallet → broadcast → verify → `identity-register` event; no longer touches any local identity state

Adding a second chain: write a new `xxx-wallet.js` / `xxx-rpc.js` pair that produces the same `NormalizedBurnTx` shape. No change to `identity-cost.js`.

**UI**: wallet creation/unlock (encrypted, persisted to `localStorage`; plaintext secret key never touches storage); devnet/mainnet selector (devnet default, with explicit warning that free faucet SOL provides no real Sybil resistance); burn-to-register button behind a confirmation dialog naming the exact amount, network, and irreversibility. `Commit` and `Claim reward` are DOM-`disabled` until `hasIdentityCost(domain)` is true.

---

### Modules

Registration is open — no allow-list, no approval step. The only mechanical rejections are: duplicate id, or an internally inconsistent economic declaration for an issuing module (validated against the real reward formula). Audit is future AI work.

**Content addressing** (`module-hash.js`): every registration binds an id to a SHA-256 hash, not a mutable URL. A verdict stays attached to the exact bytes it was made about. `updateModuleCode()` resets audit status to `unaudited` on every code change. An update to an existing module id is rejected unless the signer matches the module's recorded author.

**Registry** (`module-registry.js`): `registerModule()`, `updateModuleCode()`, `auditModule()`. For an issuing module, validates the economic self-declaration against the real `reward.js` math. `identityScheme` is derived from the declaration: strong / weak / non-issuing (Lemma 1 reasoning attached as a labeled badge in the UI, not a bare label).

**DAG replication** (`module-registry-reducer.js`): `module-register` / `module-update` / `module-audit` are DAG event types. The registry is a materialized view over H_d, propagated for free by `merge()`/`topoOrder()`. A module registered on one domain propagates to all reconciled peers.

**Rank** (`module-rank.js`): list sort key = `r(burnedLamports, elapsedEpochs, θ)` of the author's real identity-cost and cadence state. Submission eligibility = a ratio-must-not-decline check (modeled on real `checkScoreEligibility`). `rankFromIdentityAndCadence()` composes both from real materialized state. Rank is displayed in the Domain catalog but does not control desktop layout order.

**Signed submission** (`module-submission.js`): builds a signed submission event (`moduleId`, `codeHash`, `codeUrl`, `nonce`, `timestamp`, `signature`); checks against actually-fetched code (not the caller's claim); replay-guards nonces; only then calls `registerModule()` or `updateModuleCode()`. Tested with real Ed25519 signing via `@noble/curves`. No economic gate on publishing — signing is for attribution and integrity only.

Cross-language submission parity: `scripts/verify-submission-parity.sh` confirms both directions (JS signs → Rust verifies; Rust signs → JS verifies) with real freshly-generated keypairs each run.

**Sandbox** (`module-sandbox.js`): module code runs inside `<iframe sandbox="allow-scripts">` *without* `allow-same-origin`. Isolation is a property of where the code executes, not a rule the code is asked to follow. A module whose fetched code doesn't match its registered hash is refused mounting outright. The `ctx` surface is bridged over `postMessage`, invisible to the module author.

**ctx surface available to modules**:
- `ctx.storage.get(key)` / `ctx.storage.set(key, value)` — durable, scoped to `(domain, moduleId)`
- `ctx.toast(message)` — logged to the real event log
- `ctx.commit(b)` — stakes a claim at the current cadence epoch
- `ctx.claim()` — claims reward for elapsed epochs
- `ctx.postCausalEvent(type, payload)` — generic DAG write; host forces the real caller's domain id onto every event
- `ctx.queryCausalState(contractId)` — generic DAG read
- `ctx.share(key, value)` — DAG-replicated key/value (hyperprofile); `null` retracts
- `ctx.sendToPeer(domainId, message)` — real-time via the real transport layer; delivered only if the target module is currently mounted on the receiving domain
- `ctx.onPeerMessage(handler)` — receives real-time messages addressed to this module
- `ctx.theme` — active theme as real, parseable JSON (identical token values as the CSS vars injected in the `<style>` tag)

**Theme injection**: `module-sandbox.js`'s `buildSandboxHtml()` injects the active theme both as CSS custom properties and as `ctx.theme`. Module code is confirmed byte-identical across both presets — only the injected presentation differs.

**`module-loader.js`**: fetches and hash-verifies a module's real code before mounting. A code swap behind the same URL is detected and rejected.

---

### Transport

`transport.js` defines the interface. `assertImplementsTransport()` makes partial backends fail loudly, naming exactly which method is missing.

`delay-tolerant-transport.js`: a message is durably queued before any network attempt. `flush()` preserves FIFO order per peer and stops at the first failure. Different peers' queues are independent. An already-delivered message is removed from the queue on success (not left as "queued").

`connection-watchdog.js`: fires its stale callback exactly once per episode (verified with an injected clock). Correctly resets on real reconnect. Resolves the boundary case — activity exactly at the timeout — explicitly.

The app's Reconcile action goes through `transport.send()`, not `dag.merge()` directly. Delivery is simulated within one browser tab (real `dag.merge()` when link is up; real queueing when down). A per-contact link up/down toggle, live queue-depth stat, and flush button are in the UI.

WebRTC mesh backend: honest, explicit stub. Real signaling infrastructure is not available in this environment; a fabricated never-connected implementation was deliberately not shipped.

---

### Pool and composable contracts

**Pool** (`pool-reducer.js` / `pool_reducer.rs`):

- `pool-init`: mints a pot address with no keypair (by design — no party moves money on anyone else's behalf)
- `pool-contribute`: records real signed claims
- `pot-release`: `verifyPoolPayout` uses `causal-condition-evaluator` rather than hand-written security checks

Cross-language draw parity: `(poolId, cycleIndex, contributions)` run through both languages' `computeWeightedDraw` produce identical `winnerDomain`, `totalAmount`, and full 64-character `drawHash`. Pinned as a permanent regression test.

**Composable verification** (`causal-condition-evaluator.js` / `causal_condition_evaluator.rs`):

Six primitives — `ownership` / `signature` / `count` / `deterministic-match` / `unique` / `causal-order` — composed as AND/OR/NOT declarative data. The evaluator never executes submitted code. Every primitive generalizes a check some already-shipped reducer already performed by hand.

`pool-reducer.js`'s `verifyPoolPayout` was rewritten to use the evaluator. The existing 25 pool tests passed unchanged against the rewritten implementation — confirmed drop-in replacement.

**Generic contracts** (`generic-contract-reducer.js` / `generic_contract_reducer.rs`):

A third party can define a new contract without touching platform code. The verification condition is supplied once, at mint time, and is fixed permanently (same discipline as formula-register). A release event supplies only `claimId` / `from` / `to` / `contractId` — the condition is substituted from the already-fixed mint record. A release event cannot supply its own condition. Confirmed: an attacker smuggling an extra `condition` field into a release attempt is completely ignored; the real minted condition (chosen to be unambiguously false in the test) is the one evaluated.

Demo: a real 2-of-2 threshold-release escrow — sharing zero code with `pool-reducer.js` — built as one `count` condition over real approval events.

Rust note: `generic_contract_reducer.rs` requires a hand-written `parse_condition` since the `Condition` enum has no direct serde derive for its shape.

**Example plugin**: `examples/jackpot-plugin/jackpot.js` — a jackpot funded and paid entirely in AIWA. The pool-address string prefix (`jackpot-pot:<poolId>`) is deliberately kept unchanged in the rename from `jackpot-reducer` to `pool-reducer` — renaming code around something already live in H_d must never retroactively change what's already there.

---

### Presentation and desktop

**Themes** (`theme-tokens.js`): `default` and `compact` (large monospace, maximum contrast, secondary text collapsed to same value as primary — for bandwidth- or hardware-constrained nodes). Both presets declare identical token key sets. `themeToCssVariables()` produces a real `:root {}` CSS block, confirmed to differ between presets. A Presentation selector in Parameters switches `activeThemeId` — confirmed to have exactly one side effect (reassigning that variable), touching no other state.

**Desktop** (`desktop-layout.js`): pure, DOM-free logic. Rules: reorder, fold two icons into a folder, merge into an existing folder, eject (explicit tap, not a drag back out), remove. Rank is computed and displayed but does not control layout order — a render that re-sorted by computed rank would silently discard drag arrangements on every state refresh. Storage migrates transparently from flat pin lists; corrupted data degrades to empty rather than crashing.

**Design system** (`css/aiwa.css`): dark base (#0B0D10), amber accent (#E3A008), green/red reserved strictly for semantic proof-status states. IBM Plex Mono for headers, IBM Plex Sans for body. Hairline 1px borders, near-zero border-radius, zero shadows, zero gradients. Status indicators reuse the whitepaper's own Proved/Tested/Conditional/Open vocabulary as a real UI primitive. Left sidebar above 900px; responsive multi-column card grid; plugin runner as a bounded floating panel.

---

### AI idea agent

`idea-agent.js` builds a context snapshot from:

- Real desktop pins and the domain's own published hyperprofile data (usage over registration)
- Recency-weighted trending categories across the network: only the most recently registered third of the network, so 3 new modules in one category outweigh months of stale accumulation
- Category gaps — categories that exist in the network but not in this domain's own modules
- Multi-contact overlap — categories where 2+ genuinely distinct contacts have registered modules (one contact with two modules in the same category does NOT count)
- GitHub repository trends (`public/data/github-trends.json`), labeled "NOT this AIWA network, for inspiration only" in the prompt; never leaks into fields that mean real AIWA network activity; freshness stated honestly (may be stale)
- `module-pattern-miner.js` — mines which `ctx` primitives (`storage`, `postCausalEvent`, `share`, `sendToPeer`, etc.) are actually used across locally-known modules (via `loadVerifiedModuleCode`); reports primitives never used by any module as concrete "nobody's tried this yet" hooks

The agent produces text suggestions only. No code generation. No consensus writes. No authoritative protocol role.

`webllm-engine.js`: real WebGPU detection, real dedicated Worker, real streaming chat via `@mlc-ai/web-llm`. Untestable here (no browser).

**GitHub trends bot** (`scripts/fetch-github-trends.mjs` + `update-github-trends.yml`): uses GitHub's official public search API (`GET /search/repositories`). Scheduled daily Action, commits result to `public/data/github-trends.json`. The app fetches this file once, lazily, cached — never awaited inside a render function. `ci.yml`'s `paths-ignore` excludes the bot's daily commit from triggering a full CI run.

**Pattern miner** (`module-pattern-miner.js`): bounded to 20 modules; uses the same hash-verifying fetch as `mountModule()`; cached and non-blocking. Confirmed: the rendered prompt never contains a code skeleton or the word "skeleton".

---

### Hyperprofile

`public-profile-reducer.js` / `public_profile_reducer.rs`: a DAG-replicated key/value store. `ctx.share(key, value)` publishes; `value: null` retracts. Latest-write-wins. A Contacts screen "Visit profile" button shows what a domain's modules have genuinely published, materialized the same way as every other view.

`ctx.sendToPeer(domainId, message)` / `ctx.onPeerMessage(handler)`: real-time, routed through the real transport layer. Delivered only if the target module is currently mounted on the receiving domain. No inbound queue. A real-time module message does not trigger a DAG merge (branched on the message's declared type before deciding what delivery means).

---

## Cross-language parity

Every layer has a parity check. All run in CI on every push.

| Layer | Script | Vectors / method |
|---|---|---|
| Ledger event ids | `scripts/verify-parity.sh` | `test-vectors/id-parity.json` |
| Composed G | `scripts/verify-g-parity.sh` | `test-vectors/g-scenario.json` |
| Conservation | `scripts/verify-conservation-parity.sh` | `test-vectors/conservation-scenario.json` |
| Module submission signing | `scripts/verify-submission-parity.sh` | Live keypairs, both directions, each run |
| Pool weighted draw | pinned regression test | `rust-core/tests/pool_parity.rs` |

**Materialization order** is part of the protocol contract: id-sorted depth-first topological order. Two implementations can each satisfy "G is a deterministic function of the converged event set" while disagreeing with each other if they pick different (both valid) tie-breaking rules for concurrent branches.

**Numeric/float semantics**, **protocol versioning**, and elevation of test vectors to a formal conformance suite are named open items in the whitepaper's consensus contract section.

---

## Deliberately-broken counterexamples

These files are kept permanently out of the production source directories and are never exported as usable code.

- `tests/counterexample-wallclock.test.mjs` / `rust-core/tests/counterexample_wallclock.rs` — a G that derives q from an injected wall clock instead of cadence state materializes the same event set to a 100x-different balance depending solely on when it's computed
- `tests/counterexample-nonatomic-consume.test.mjs` / `rust-core/tests/counterexample_nonatomic_consume.rs` — splitting the atomic `consume()` into two steps lets two branches both pass the check before either commits, minting two destination claims from one proof (the double-spend)
- `tests/lemma1.test.mjs` — a weak identifier that omits q collides two events with different reward under cadence-sensitive β; confirmed safe when β=0

---

## Running tests

```bash
# JS
npm install   # only needed for @solana/web3.js and @noble/curves tests
node --test tests/*.test.mjs

# Rust (native; no wasm32 target needed)
cd rust-core
cargo test

# Cross-language parity (no npm install needed)
./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh
```

Current counts: **415 JS tests · 238 Rust tests (232 lib + 6 integration) · zero warnings either language**.

---

## Building Rust → WASM

```bash
# On a machine with rustup:
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
cd rust-core
wasm-pack build --target web --out-dir ../public/js/wasm --out-name aiwa_core
```

CI builds and commits this binary automatically on every push. `ledger-bridge.js` picks it up on next reload. The binary has been confirmed to load in a deployed browser session with zero errors. What remains open: a live side-by-side comparison of WASM-backed vs. JS-backed computed results in the browser.

---

## Deploy to GitHub Pages

One-time setup: GitHub repo → **Settings → Pages** → set source to **GitHub Actions**.

`.github/workflows/deploy-pages.yml` deploys `public/` on every push to `main`. No build step — the same pure JS `public/` directory is served as-is.

---

## Whitepaper

`docs/AIWA_whitepaper_v1_2_revised.md` is kept in sync with the implementation. When the implementation surfaces a real finding — a bug, a gap in the model, a divergence between spec and what two interoperating implementations require — it gets a precise addition at the relevant point in the paper, not a standalone changelog bullet.

The §17 Claim-Evidence-Assumption Matrix is kept current. Closed: R11 (cadence integrity, VDF), R19 (module sandbox isolation). Dampened (not fully closed): identity churn. Open: WASM live-results comparison, AI authoritative layer, numeric/float consensus semantics, protocol versioning, formal conformance test vectors.
