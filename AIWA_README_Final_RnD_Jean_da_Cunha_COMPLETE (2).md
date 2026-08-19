
# AIWA
## Autonomous Interplanetary Web Application

> **A research implementation for autonomous, delay-tolerant web applications that continue to operate without a continuously available server and reconcile deterministically when connectivity returns.**

AIWA explores a deceptively simple question:

> **Can a useful web application carry its own history, continue operating while disconnected, exchange events opportunistically, and reconstruct its state deterministically from that history — without making a continuously available server the authority?**

The answer implemented here is deliberately not presented as a finished solution to distributed consensus, Sybil resistance, interplanetary coordination, or browser security. AIWA is a **working research platform** in which those difficult questions are separated, implemented, measured, attacked, and documented with their assumptions visible.

The central model is:

```text
                         EVENT HISTORY
                              H_d
                               │
                               │ canonical materialization
                               ▼
                         A = G(H_d, θ)
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
      Economics           Conservation          Contracts
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
                       Application state

        Transport · Identity · Modules · AI
        support the system without silently
        becoming the authoritative history.
```

### Why this is a research project

AIWA sits at the intersection of:

**distributed systems · offline-first computing · deterministic state materialization · cryptographic identity · economic coordination · delay-tolerant networking · browser security · sandboxed extensibility · declarative contracts · local AI**

The interesting questions are not hidden:

- When concurrent branches are individually valid but economically conflicting, **what does deterministic reconciliation actually mean?**
- When does a deterministic materialization rule constitute useful convergence, and when does it merely produce a deterministic but semantically questionable outcome?
- What does a sequential cadence proof really provide against heterogeneous hardware and many independent identities?
- What does an external-chain burn prove: **proof of cost, proof of key control, or something stronger?**
- Can third-party modules remain useful without becoming trusted computing principals?
- Which application properties can remain autonomous during arbitrary partitions, and which require stronger coordination?
- Can an independent implementation reproduce the same event identity and state without reverse-engineering the reference code?

**AIWA does not claim that these questions are all solved. It makes them concrete enough to test.**

### What is already built

The repository is a working reference implementation, not only a design document. It includes:

- a content-addressed event DAG with idempotent set-union merge;
- deterministic materialization `A = G(H_d, θ)`;
- durable browser persistence for the event history;
- cadence-derived economic time and a sequential SHA-256 cadence proof;
- reward, scarcity, formula-registry and identity-cost reducers;
- a conservation state machine with signed transfer authorization;
- Solana-backed identity-cost registration;
- content-addressed, signed, sandboxed third-party modules;
- declarative causal verification and generic contracts;
- delay-tolerant transport with durable queues and watchdog logic;
- JS and Rust implementations with cross-language parity vectors;
- deliberately broken counterexamples;
- an advisory AI layer that cannot write authoritative consensus state.

The implementation currently contains **415 JavaScript tests and 238 Rust tests**, plus cross-language parity checks and explicit counterexamples. These are evidence about the tested implementation and fault classes; they are **not** a blanket security proof.

### What AIWA does not claim

AIWA does not currently claim:

- general Byzantine consensus;
- semantic correctness of every concurrent economic conflict;
- a true asymmetric VDF;
- proof-of-human identity;
- universal Sybil resistance;
- complete malicious-module resistance;
- physical truth merely from cryptographic commitment;
- complete numeric cross-platform consensus semantics;
- a finished protocol-versioning model;
- machine-checked correctness of the complete implementation.

The project is stronger when these limits are explicit.

### Research participation

AIWA is intentionally open to people who want to **break the model rather than merely use it**.

A valuable contribution can be:

- a counterexample;
- an adversarial fork/convergence scenario;
- a formal invariant;
- a proof or failed proof;
- a fuzzing harness;
- an independent implementation;
- a transport backend;
- a browser-security audit;
- an economic attack simulation;
- a contract;
- a benchmark;
- a visualization;
- or a precise argument that one of the assumptions is wrong.

**A convincing counterexample is a first-class contribution.**

The immediate research agenda is:

1. **Adversarial convergence** — characterize when canonical ordering is semantically sufficient.
2. **Threat modelling** — connect attacker capabilities to invariants and executable tests.
3. **Cadence economics** — quantify hardware-relative epoch production and multi-identity attacks.
4. **Module security** — attack the complete `postMessage → ctx → storage → transport` boundary.
5. **Formal invariants** — move important properties toward TLA+, Isabelle/HOL, or equivalent mechanization.
6. **Independent conformance** — turn current parity fixtures into a normative protocol conformance suite.

---
# Table of Contents

- [Architecture at a Glance](#architecture-at-a-glance)
- [Repository Structure](#repository-structure)
- [Core Model](#core-model)
- [Ledger — Event DAG](#ledger--event-dag)
- [Materialization — `A = G(H_d, θ)`](#materialization--a--gh_d-θ)
- [Economics](#economics)
- [Cadence and VDF](#cadence-and-vdf)
- [Formula Registry](#formula-registry)
- [Scarcity](#scarcity)
- [Sybil Resistance](#sybil-resistance)
- [Conservation](#conservation)
- [Identity](#identity)
- [Modules](#modules)
- [Module Sandbox](#module-sandbox)
- [Transport](#transport)
- [Pools and Contracts](#pools-and-contracts)
- [Causal Verification](#causal-verification)
- [Presentation and Desktop](#presentation-and-desktop)
- [AI Idea Agent](#ai-idea-agent)
- [Hyperprofile](#hyperprofile)
- [Rust / WASM](#rust--wasm)
- [Cross-Language Parity](#cross-language-parity)
- [Security Model](#security-model)
- [Deliberately Broken Counterexamples](#deliberately-broken-counterexamples)
- [Testing](#testing)
- [Running Locally](#running-locally)
- [Building Rust → WASM](#building-rust--wasm)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Network Model](#network-model)
- [What AIWA Does Not Claim](#what-aiwa-does-not-claim)
- [Open Items](#open-items)
- [Whitepaper](#whitepaper)
- [Design Vocabulary](#design-vocabulary)
- [License](#license)

---

# Architecture at a Glance

AIWA separates the system into three fundamental layers:

```text
┌──────────────────────────────────────────────────────────────┐
│                         PRESENTATION                          │
│                                                              │
│  Desktop · Contacts · Domains · Modules · Parameters · AI   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       MATERIALIZED STATE                      │
│                                                              │
│                    A = G(H_d, θ)                              │
│                                                              │
│  Economics · Identity · Registry · Claims · Contracts       │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                          EVENT DAG                            │
│                                                              │
│  Immutable events · content addressing · causal parents     │
│  deterministic merge · deterministic replay                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                        TRANSPORT                             │
│                                                              │
│  Durable queues · FIFO per peer · reconnect / watchdog      │
│  delay-tolerant synchronization · WebRTC-ready interface    │
└──────────────────────────────────────────────────────────────┘
```

The important distinction is:

> **The DAG is authoritative. The UI is not.**

A UI state can always be reconstructed from the event set.

---

# Repository Structure

```text
AIWA/
├── public/
│   ├── index.html
│   ├── css/
│   │   └── aiwa.css
│   │
│   ├── data/
│   │   └── github-trends.json
│   │
│   └── js/
│       ├── app/
│       │   └── main.js
│       │
│       └── core/
│           ├── event-dag.js
│           ├── event-dag-persistence.js
│           ├── ledger-bridge.js
│           ├── wasm-ledger-adapter.js
│           ├── domain-id.js
│           │
│           ├── economics/
│           │   ├── cadence.js
│           │   ├── cadence-vdf.js
│           │   ├── reward.js
│           │   ├── scarcity.js
│           │   ├── g.js
│           │   └── formula-registry-reducer.js
│           │
│           ├── conservation/
│           │   ├── conservation.js
│           │   └── conservation-bridge.js
│           │
│           ├── identity/
│           │   ├── identity-cost.js
│           │   ├── identity-cost-reducer.js
│           │   ├── solana-networks.js
│           │   ├── solana-wallet.js
│           │   ├── solana-rpc.js
│           │   └── identity-flow.js
│           │
│           ├── modules/
│           │   ├── module-hash.js
│           │   ├── module-registry.js
│           │   ├── module-registry-reducer.js
│           │   ├── module-rank.js
│           │   ├── module-submission.js
│           │   ├── module-fetch.js
│           │   ├── module-loader.js
│           │   └── module-sandbox.js
│           │
│           ├── transport/
│           │   ├── transport.js
│           │   ├── delay-tolerant-transport.js
│           │   └── connection-watchdog.js
│           │
│           ├── pool/
│           │   └── pool-reducer.js
│           │
│           ├── contracts/
│           │   └── generic-contract-reducer.js
│           │
│           ├── verification/
│           │   └── causal-condition-evaluator.js
│           │
│           ├── presentation/
│           │   └── theme-tokens.js
│           │
│           ├── desktop/
│           │   └── desktop-layout.js
│           │
│           └── ai/
│               ├── idea-agent.js
│               ├── webllm-engine.js
│               ├── module-pattern-miner.js
│               └── public-profile-reducer.js
│
├── rust-core/
│   ├── src/
│   │   ├── core.rs
│   │   ├── dag.rs
│   │   ├── event.rs
│   │   ├── lib.rs
│   │   ├── economics/
│   │   ├── conservation/
│   │   ├── identity/
│   │   ├── modules/
│   │   ├── pool/
│   │   ├── contracts/
│   │   ├── verification/
│   │   └── ai/
│   │
│   ├── examples/
│   │   ├── check_id_parity
│   │   ├── check_g_parity
│   │   ├── check_conservation_parity
│   │   ├── sign_submission_rust
│   │   └── verify_submission_from_js
│   │
│   └── tests/
│
├── tests/
│
├── test-vectors/
│   ├── id-parity.json
│   ├── g-scenario.json
│   └── conservation-scenario.json
│
├── scripts/
│   ├── verify-parity.sh
│   ├── verify-g-parity.sh
│   ├── verify-conservation-parity.sh
│   ├── verify-submission-parity.sh
│   └── fetch-github-trends.mjs
│
├── examples/
│   └── jackpot-plugin/
│       └── jackpot.js
│
├── docs/
│   └── AIWA_whitepaper_v1_2_revised.md
│
├── package.json
│
└── .github/
    └── workflows/
        ├── ci.yml
        ├── deploy-pages.yml
        └── update-github-trends.yml
```

---

# Core Model

AIWA has one central abstraction:

```text
H_d = { immutable events belonging to / observed by domain d }

A = G(H_d, θ)
```

Where:

- `H_d` is the event DAG.
- `θ` is the protocol parameter set.
- `G` is the deterministic materialization function.
- `A` is the resulting application state.

The application does **not** treat the materialized state as the source of truth.

Instead:

```text
events
  ↓
canonical ordering
  ↓
reducers
  ↓
materialized state
  ↓
UI
```

This distinction is critical for offline operation and reconciliation.

---

# Ledger — Event DAG

## Event identity

Every event is content-addressed.

Conceptually:

```text
eventId =
  SHA-256(
    canonicalized(event payload + parent ids)
  )
```

Objects are recursively canonicalized by sorting keys before hashing.

This prevents the following two logical objects from producing different identifiers merely because their JSON properties were written in a different order.

```json
{
  "domain": "abc",
  "amount": 10,
  "nonce": 4
}
```

and:

```json
{
  "nonce": 4,
  "amount": 10,
  "domain": "abc"
}
```

represent the same canonical payload.

---

## Merge semantics

`merge()` is a set union.

Therefore:

```text
merge(A, B) = merge(B, A)
merge(A, A) = A
merge(merge(A, B), C) = merge(A, merge(B, C))
```

Replaying an already-known event is a no-op.

This is the foundation for reconciliation.

---

## Deterministic topological ordering

The event set alone is not sufficient.

Two implementations could both claim to be deterministic while choosing different valid orders for concurrent events.

AIWA therefore makes the ordering rule part of the protocol:

> **id-sorted depth-first topological ordering.**

That rule is used by both implementations.

This means:

```text
same event set
      +
same protocol parameters
      +
same ordering rule
      ↓
same materialized state
```

---

## Persistence

`event-dag-persistence.js` stores the DAG in IndexedDB.

Consequently:

```text
open tab
   ↓
events created
   ↓
IndexedDB
   ↓
close tab
   ↓
reopen
   ↓
restore H_d
   ↓
replay
   ↓
same state
```

The replay path explicitly verifies that restored events can be inserted into a fresh DAG without violating unknown-parent constraints.

The real cadence tip is reconstructed from the restored DAG rather than from a stale local variable.

---

# Materialization — `A = G(H_d, θ)`

`g.js` performs a complete fold over the deterministic topological order.

The current economic event vocabulary includes:

- `genesis`
- `cadence`
- `accrual`

The broader application uses additional event types for identity, modules, claims, contracts, profiles, etc.

The important rule is:

> **Reducers consume causal history; they do not invent history.**

This allows every materialized view to be reconstructed from the same underlying event set.

---

# Economics

AIWA's economic reducer implements a deterministic reward function adapted from the original YourMine model.

## Reward function

```text
                 b · q^α
r(b,q,q_total,T) = ─────────────────────────────
                   [ln(q_total^(β(1−T)) + C)]^γ
```

Reference parameters:

```text
α = 1.1
β = 2.2
γ = 3
C = 35937
```

For the reference test case:

```text
r(1, 100, 100, 0)
= 0.11844290947765648
```

The result is verified through:

1. direct JavaScript execution,
2. full EventDag replay,
3. cross-language JS/Rust parity.

---

## Local cadence

`q_total` is the domain's own cadence epoch count.

It is deliberately **not** a global blockchain height.

This avoids introducing a hidden requirement that all domains share the same wall clock or global chain progress.

The minimum-slot waiting requirement from the original model becomes a deployment-chosen `minQ`.

---

# Cadence and VDF

Cadence is monotonic.

A cadence transition:

- cannot be replayed,
- cannot jump arbitrarily,
- advances by at most `+1`,
- must contain a valid VDF proof.

The proof is a sequential SHA-256 chain:

```text
h₀ = seed(domain, previous VDF output)

h₁ = SHA256(h₀)
h₂ = SHA256(h₁)
...
hₙ = SHA256(hₙ₋₁)
```

The next cadence epoch cannot begin without the previous epoch's actual VDF result.

---

## Important limitation

This is **not a true asymmetric VDF**.

Verification requires recomputing the same sequential hash chain.

Therefore:

```text
proof generation ≈ proof verification
```

The VDF provides a computational delay and makes it substantially harder to create thousands of structurally valid cadence transitions immediately.

It does **not** provide the stronger asymmetry of a cryptographic VDF where verification is dramatically cheaper than computation.

---

## Difficulty

The iteration count is configurable.

Default:

```text
200,000 iterations
```

The measured runtime is hardware-dependent.

The UI therefore exposes the parameter explicitly rather than pretending the duration is universal.

---

# Formula Registry

Reward formulas are immutable once registered.

A:

```text
formula-register
```

event permanently binds an identifier to:

```text
(alpha, beta, gamma, C, minQ)
```

There is no update path.

Attempting to reuse the same formula identifier with different parameters is rejected.

`genesis` is the fixed protocol-default formula and requires no registration event.

This prevents two peers from silently interpreting the same economic event with different parameters.

---

# Scarcity

Issuance is bounded by a preallocated budget when the bounded mode is enabled.

`applyIssuanceAttempt()`:

```text
requested reward
       ↓
remaining budget
       ↓
min(requested, remaining)
       ↓
issued amount
```

The system also exposes:

```text
simulateHourlyIssuance()
```

for reproducing the reference simulation.

The reference scenarios include:

```text
I(1000h)  = 2000
I(10000h) = 20000
```

for the unbounded control case.

Under a:

```text
5000 + 5000
```

preallocated budget, issuance saturates at:

```text
10000
```

---

# Sybil Resistance

The economic model explicitly analyzes capital splitting.

Because the current reward function is linear in `b`, splitting capital across identities is reward-neutral **before identity cost**.

Therefore:

```text
c_id > 0
```

makes a single identity preferable to arbitrary capital splitting.

Identity churn is a separate attack:

```text
old identity
     ↓
age decay
     ↓
abandon
     ↓
new identity
     ↓
fresh age
```

The implementation includes an optional slot-scaled identity-cost curve to make this increasingly expensive.

This is described as a **dampening mechanism**, not a complete proof of Sybil resistance.

---

# Conservation

Economics creates value.

Conservation moves existing value.

These are intentionally separate.

```text
G(H_d, θ)
     │
     │ creates
     ▼
 claims
     │
     │ transformed by
     ▼
Conservation pipeline
```

The conservation pipeline is:

```text
Deactivate
    ↓
Prove
    ↓
Verify
    ↓
Consume
    ↓
Activate
```

Each stage is implemented as a separate function.

---

## Conservation invariant

The critical invariant is:

```text
count(Consume(p)) ≤ 1
```

This prevents a proof from being consumed twice.

A deliberately broken implementation demonstrates how splitting the atomic consume operation allows two branches to both observe an unconsumed proof and create two destination claims.

---

## Economics bridge

`conservation-bridge.js` connects claims to the economic reducer.

### `claim-issue`

A claim can only be issued from an actual G-balance.

The bridge checks the rejected-event set and prevents issuance above the real accrued amount.

### `transfer`

A transfer requires:

- Ed25519 signature,
- `(claimId, from, to, nonce, timestamp)`,
- signature verification,
- nonce replay protection,
- proof that:

```text
SHA-256(signerPubkey) == from
```

A declared ownership label is therefore insufficient.

---

# Identity

AIWA uses an external burn as the identity-cost mechanism.

Before partition, a domain can burn SOL to the Solana incinerator address. The resulting transaction signature becomes the identity-cost proof, and the verified burn is recorded as an `identity-register` DAG event.

The browser implementation includes:

- real Ed25519 keypair generation;
- AES-256-GCM password encryption through Web Crypto;
- encrypted wallet persistence without storing the plaintext secret key;
- explicit `devnet` / `mainnet` selection, with `devnet` as the default;
- a confirmation flow that names the exact amount, network, and irreversibility of the burn;
- real transaction construction, signing, broadcast and verification paths.

`solana-rpc.js` uses real `fetch()` calls to a Solana endpoint. The RPC path has not been exercised in the original test environment because that environment had no network path; it is therefore described as real integration code, not as a completed end-to-end network test.

The default devnet mode is deliberately not treated as Sybil resistance: faucet SOL has no meaningful economic cost. Mainnet is the deployment mode in which the external burn has real economic significance.

The identity-cost layer is chain-agnostic. `identity-cost.js` / the Rust equivalent consume a normalized `NormalizedBurnTx` shape, so a second chain can be integrated by supplying a new wallet/RPC pair without changing the pure identity-cost reducer.

# Identity

AIWA uses an external burn as the identity-cost mechanism.

Before partition, a domain can burn SOL to the Solana incinerator address.

The resulting transaction signature becomes the identity-cost proof.

The verified burn is then recorded as:

```text
identity-register
```

inside the DAG.

This means identity information propagates through ordinary DAG reconciliation.

---

## Why burn instead of staking?

A burn is immediately final from the application's perspective.

There is no requirement for the AIWA protocol to remain online to enforce future slashing.

The cost is sunk before partition.

This is particularly relevant to the intended delay-tolerant / intermittently connected model.

---

## Identity ID

The domain identifier is:

```text
SHA-256(publicKey)
```

represented as:

```text
64 hexadecimal characters
```

The full identifier is used for cryptographic verification.

Short identifiers are presentation-only.

---

## Identity churn

New identity registration can optionally scale with the Solana slot at which the burn was confirmed.

The intent is:

```text
older network
      ↓
new identity
      ↓
higher registration cost
```

This does not perfectly distinguish:

```text
attacker
```

from:

```text
legitimate late joiner
```

That tradeoff is intentionally documented rather than hidden.

---

# Modules

AIWA has an open module registry. There is no allow-list or manual approval requirement.

The mechanical rejection conditions include:

- duplicate module ID;
- invalid economic declaration for an issuing module;
- invalid signature;
- inconsistent code hash;
- unauthorized update.

### Module ranking

`module-rank.js` computes a display rank from the author's real identity cost and cadence state. The sort key is the reward function applied to burned capital and elapsed cadence epochs.

`rankFromIdentityAndCadence()` composes those inputs from materialized state.

Submission eligibility includes a ratio-must-not-decline check modeled on the original score-eligibility logic.

**Rank is displayed in the Domain catalog but does not control desktop layout order.** This is intentional: a renderer that re-sorted desktop items by computed rank would silently destroy user-defined arrangements every time state was refreshed.

# Modules

AIWA has an open module registry.

There is no allow-list or manual approval requirement.

The mechanical rejection conditions include:

- duplicate module ID,
- invalid economic declaration for an issuing module,
- invalid signature,
- inconsistent code hash,
- unauthorized update.

---

## Content addressing

A module is identified by the SHA-256 hash of its code.

Therefore:

```text
module ID
     │
     └──► code hash
```

rather than:

```text
module ID
     │
     └──► mutable URL
```

If code changes, the hash changes.

An audit verdict is reset to:

```text
unaudited
```

when the code changes.

---

## Signed submission

A submission contains:

```text
moduleId
codeHash
codeUrl
nonce
timestamp
signature
```

The submission pipeline:

```text
fetch code
   ↓
hash code
   ↓
compare with declared hash
   ↓
verify signature
   ↓
check nonce
   ↓
register / update
```

The caller cannot simply claim that the fetched code matches.

---

## Attribution

Ed25519 signatures establish authorship and integrity.

They are **not** treated as an economic publishing gate.

Publishing remains open.

---

# Module Sandbox

Third-party modules execute inside:

```html
<iframe sandbox="allow-scripts">
```

with:

```text
allow-same-origin = absent
```

This is intentional.

The isolation boundary is the browser execution environment, not a promise made to module authors.

---

## Hash verification before execution

The module loader:

```text
fetch
  ↓
SHA-256
  ↓
registered hash?
  ├── no → refuse mount
  └── yes
       ↓
     sandbox
```

A mutable URL cannot silently replace the code associated with a registered hash.

---

# Module API

Modules receive a constrained `ctx` surface.

### Storage

```js
ctx.storage.get(key)
ctx.storage.set(key, value)
```

Storage is scoped to:

```text
(domain, moduleId)
```

### Economic actions

```js
ctx.commit(b)
ctx.claim()
```

### DAG interaction

```js
ctx.postCausalEvent(type, payload)
ctx.queryCausalState(contractId)
```

### Public profile

```js
ctx.share(key, value)
```

`null` retracts a value.

### Peer messaging

```js
ctx.sendToPeer(domainId, message)
ctx.onPeerMessage(handler)
```

### Presentation

```js
ctx.theme
```

The theme is exposed as real JSON and matches the CSS variables injected into the sandbox.

---

# Transport

The transport layer is deliberately separated from the ledger.

```text
Application
    │
    ▼
Transport interface
    │
    ├── Delay-tolerant transport
    │
    └── Future WebRTC mesh
```

`assertImplementsTransport()` ensures incomplete implementations fail loudly.

---

## Delay-tolerant transport

Messages are durably queued before a network attempt.

For each peer:

```text
queue:
  message 1
  message 2
  message 3
```

FIFO is preserved.

If message 2 fails:

```text
message 3 is not sent
```

Different peers have independent queues.

A successfully delivered message is removed from the queue.

---

## Connection watchdog

The watchdog:

- fires stale exactly once per outage episode,
- resets after reconnection,
- handles the exact timeout boundary explicitly.

This avoids repeated stale callbacks during a single outage.

---

# Pools and Contracts

The pool primitive is implemented by `pool-reducer.js` and its Rust mirror.

A pool consists of:

- `pool-init` — creates a pot address with no keypair;
- `pool-contribute` — records real signed claims;
- `pot-release` — releases according to the deterministic causal condition.

The pot deliberately has no keypair. No party is given a private key that could authorize movement of funds on behalf of everyone else.

`verifyPoolPayout` uses the shared causal-condition evaluator rather than maintaining a separate hand-written security language.

The weighted draw is deterministic. Both JS and Rust derive identical `winnerDomain`, `totalAmount`, and the complete 64-character `drawHash` from the same `(poolId, cycleIndex, contributions)` inputs.

The repository also contains:

```text
examples/jackpot-plugin/jackpot.js
```

as a real example plugin. Its jackpot is funded and paid through AIWA's pool machinery. The existing `jackpot-pot:<poolId>` address prefix is deliberately preserved: renaming surrounding implementation code must not retroactively change identifiers already present in the event history.

# Pools and Contracts

AIWA provides a general-purpose pooling primitive.

Events include:

```text
pool-init
pool-contribute
pot-release
```

A pool pot has no private keypair.

This is intentional:

> No participant should be able to impersonate the pot and arbitrarily move funds.

---

## Deterministic weighted draw

The pool implementation computes weighted draws deterministically.

The following values are cross-language parity tested:

```text
winnerDomain
totalAmount
drawHash
```

The complete 64-character draw hash is pinned in regression tests.

---

# Causal Verification

`causal-condition-evaluator.js` provides six primitives:

```text
ownership
signature
count
deterministic-match
unique
causal-order
```

They can be composed declaratively:

```text
AND
OR
NOT
```

The evaluator **never executes submitted code**.

Instead:

```text
declarative condition
        ↓
known primitives
        ↓
deterministic evaluation
```

This makes it possible to define new contracts without adding new executable verification logic to the platform.

---

# Generic Contracts

A third party can mint a contract with a verification condition.

The condition is fixed at mint time.

A later release event only supplies:

```text
claimId
from
to
contractId
```

It cannot replace the original condition.

Therefore an attacker cannot submit:

```json
{
  "condition": "always-true"
}
```

during release and override the condition that was actually minted.

The implementation explicitly tests this attack.

---

## Example: 2-of-2 escrow

The repository includes a threshold-release example.

Conceptually:

```text
approval A
    +
approval B
    ↓
count >= 2
    ↓
release
```

The escrow is implemented using the generic contract system rather than bespoke escrow code.

---

# Presentation and Desktop

AIWA's presentation layer includes two concrete theme presets:

```text
default
compact
```

Both presets expose the identical token key set. `themeToCssVariables()` produces a real `:root { ... }` CSS block from the active token set.

The compact preset is intended for bandwidth- or hardware-constrained nodes: it uses a large monospace presentation and collapses secondary text toward the primary value while preserving the same semantic token vocabulary.

The Presentation selector changes only `activeThemeId`; it does not mutate unrelated application state.

# Presentation and Desktop

AIWA's presentation layer is deliberately separate from protocol state.

## Themes

Two presets are currently available:

```text
default
compact
```

Both contain the same token keys.

The compact preset is intended for:

- constrained hardware,
- bandwidth-limited environments,
- maximum contrast,
- reduced secondary information.

The active theme changes exactly one presentation variable.

It does not alter protocol state.

---

## Design language

The reference UI uses:

```text
dark base
amber accent
IBM Plex Sans
IBM Plex Mono
1px hairline borders
near-zero border radius
zero shadows
zero gradients
```

Semantic proof states reserve green/red for actual status meaning.

The vocabulary intentionally mirrors the whitepaper:

```text
Proved
Tested
Conditional
Open
```

---

## Desktop layout

Desktop behavior is pure DOM-free logic.

Supported operations:

```text
reorder
fold
merge into folder
eject
remove
```

Rank is displayed but does not control layout ordering.

This prevents a render from silently undoing the user's arrangement after every state refresh.

Legacy flat pin storage is migrated transparently.

Corrupted storage degrades to an empty layout rather than crashing the application.

---

# AI Idea Agent

The AI layer is advisory only. It never writes authoritative consensus state and it does not generate executable module code.

`idea-agent.js` builds its context from real application material, including:

- desktop pins;
- published hyperprofile data;
- recency-weighted network categories;
- category gaps;
- multi-contact overlap;
- GitHub repository trends for inspiration;
- primitive usage mined from locally known modules.

The module-pattern miner is bounded to **20 modules** and uses the same verified-code loading path as module mounting. It can identify `ctx` primitives that no locally known module currently uses, turning those into concrete exploratory prompts.

The rendered prompt is sanitized so it does not become an implicit protocol-writing mechanism.

# AI Idea Agent

The AI layer is deliberately **non-authoritative**.

It produces suggestions.

It does not write consensus state.

It does not decide protocol truth.

---

## Context sources

The idea agent can inspect:

- local desktop pins,
- published hyperprofile data,
- recent network module categories,
- category gaps,
- overlap across distinct contacts,
- GitHub repository trends,
- actual primitive usage across locally-known modules.

---

## Recency weighting

The network trend calculation emphasizes the most recently registered third of the known network.

Therefore:

```text
3 recent modules
```

can outweigh:

```text
months of stale modules
```

This is intentional.

---

## Multi-contact overlap

A category only qualifies as genuine overlap when it appears across at least:

```text
2 distinct contacts
```

Two modules published by the same contact do not count as network-wide corroboration.

---

## GitHub trends

GitHub trends are external inspiration only.

They are explicitly labeled as such.

They do not become AIWA network activity.

The feed may be stale, and the prompt states this honestly.

---

# WebLLM

`webllm-engine.js` is a real browser integration path:

```text
WebGPU
  ↓
dedicated Worker
  ↓
@mlc-ai/web-llm
  ↓
streaming response
```

It performs actual WebGPU capability detection and uses a dedicated Worker for inference. This path is browser-dependent and was not fully exercisable in the original non-browser test environment, so the README does not present browser execution as equivalent to the JS/Rust parity results.

# WebLLM

`webllm-engine.js` uses:

- WebGPU detection,
- a dedicated Worker,
- `@mlc-ai/web-llm`,
- streaming responses.

The AI engine is therefore local-browser oriented rather than dependent on a centralized inference API.

The current environment cannot perform the browser-level WebGPU test, so this is explicitly classified as browser-dependent behavior.

---

# Hyperprofile

`public-profile-reducer.js` implements a DAG-replicated key/value profile.

```js
ctx.share(key, value)
```

publishes a value.

```js
ctx.share(key, null)
```

retracts it.

The current materialization rule is latest-write-wins.

Because profile changes are DAG events, they propagate through ordinary reconciliation.

---

# Peer Messaging

Modules can communicate through:

```js
ctx.sendToPeer(domainId, message)
```

and:

```js
ctx.onPeerMessage(handler)
```

Delivery occurs only while the destination module is mounted.

There is intentionally no inbound message queue.

A real-time module message does not automatically become a DAG event.

The system distinguishes:

```text
real-time message
```

from:

```text
causal event
```

before deciding what semantics apply.

---

# Rust / WASM

The Rust implementation mirrors the JavaScript protocol core.

```text
JS reference implementation
          │
          │ shared vectors
          ▼
Rust implementation
          │
          ▼
WASM production backend
```

The Rust code covers:

- DAG
- event handling
- economics
- conservation
- identity
- modules
- pools
- contracts
- causal verification
- public profiles

---

## Backend selection

`ledger-bridge.js` is the sole integration point.

Conceptually:

```text
                    ledger-bridge
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
        WASM backend             JS backend
             │                       │
             └───────────┬───────────┘
                         ▼
                  same interface
```

No application reducer should care which backend is active.

---

# Cross-Language Parity

The JS and Rust implementations are intended to be interchangeable implementations of the same protocol surface.

Parity covers:

| Layer | Mechanism |
|---|---|
| Event identity | canonicalized payload + parent hashing |
| Materialization | `G(H_d, θ)` scenario vectors |
| Conservation | claim-state scenario vectors |
| Submission signing | JS → Rust and Rust → JS |
| Pool draw | deterministic weighted-draw hash |

The submission parity script uses freshly generated real keypairs on each run and checks both directions:

```text
JS signs → Rust verifies
Rust signs → JS verifies
```

The parity suite is evidence that the tested implementations agree. It is not, by itself, a complete normative specification for every numeric or versioning choice.

# Cross-Language Parity

Every critical deterministic layer has a parity test.

| Layer | Verification | Method |
|---|---|---|
| Event IDs | `verify-parity.sh` | Shared JSON vectors |
| `G` | `verify-g-parity.sh` | Shared economic scenario |
| Conservation | `verify-conservation-parity.sh` | Shared scenario |
| Submission signatures | `verify-submission-parity.sh` | Both signing directions |
| Pool draw | Rust regression test | Full draw hash parity |

---

## Event ID parity

The test vectors include:

- flat objects,
- nested objects,
- arrays,
- unsorted parent IDs,
- different object key orderings.

The JS implementation recursively canonicalizes objects to match Rust's serialization semantics.

Reference status:

```text
6 / 6 vectors match
```

---

## Submission parity

Both directions are tested:

```text
JavaScript signs
      ↓
Rust verifies
```

and:

```text
Rust signs
      ↓
JavaScript verifies
```

Fresh Ed25519 keypairs are generated during the parity run.

---

# Security Model

AIWA's security philosophy is:

> **Make the security boundary executable and testable wherever possible.**

Examples include:

### Identity

```text
SHA-256(pubkey) == domain
```

### Module integrity

```text
SHA-256(fetched code) == registered codeHash
```

### Transfer authorization

```text
valid Ed25519 signature
+
correct domain derivation
+
fresh nonce
```

### Contract integrity

```text
condition fixed at mint time
```

### Pool release

```text
causal-condition-evaluator
```

### Conservation

```text
Consume(p) ≤ 1
```

### DAG

```text
content-addressed events
+
deterministic merge
+
deterministic replay
```

---

# Deliberately Broken Counterexamples

The repository permanently retains several deliberately broken implementations as regression evidence.

They are not production code.

---

## Wall-clock materialization

A broken reducer derives economic state from the current wall clock.

The same event set can then materialize to radically different balances depending on when the computation happens.

The test demonstrates approximately:

```text
100× balance divergence
```

from computation timing alone.

The correct implementation derives `q` from causal cadence state.

---

## Non-atomic consume

A broken conservation implementation splits:

```text
check
```

from:

```text
consume
```

Two concurrent branches can both observe:

```text
proof unused
```

before either branch commits.

Both then consume the same proof.

The resulting state creates two destination claims from one source proof.

The correct implementation keeps the consume invariant atomic.

---

## Weak identity / Lemma 1

A deliberately weak identifier that omits `q` can collide events that should have different rewards when the reward function depends on cadence.

The test also confirms the special case where:

```text
β = 0
```

removes that dependency.

---

# Testing

Current test inventory:

```text
415 JavaScript tests
238 Rust tests
232 Rust library tests
6 Rust integration tests
0 warnings
```

The project treats tests as part of the protocol specification rather than merely implementation checks.

---

# Running Locally

The repository keeps the application itself dependency-light. `package.json` contains test-only development dependencies such as `@solana/web3.js` and `@noble/curves`; the deployed browser application can use its CDN-based runtime dependencies.

# Running Locally

## JavaScript

```bash
npm install
node --test tests/*.test.mjs
```

`npm install` is only required for the development/test dependencies such as:

- `@solana/web3.js`
- `@noble/curves`

The application itself is designed to run from static assets/CDN dependencies.

---

## Rust

```bash
cd rust-core
cargo test
```

No `wasm32` target is required for native Rust testing.

---

## Cross-language parity

```bash
./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh
```

---

# Building Rust → WASM

CI builds the WASM artifact and commits the generated binary automatically on push. `ledger-bridge.js` loads the WASM backend when present and falls back to the pure-JS reference ledger otherwise. A deployed browser session has been confirmed to load the binary without errors; a live side-by-side comparison of WASM-backed versus JS-backed materialized results remains an explicit open item.


Install the target:

```bash
rustup target add wasm32-unknown-unknown
```

Install `wasm-pack`:

```bash
cargo install wasm-pack
```

Build:

```bash
cd rust-core

wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core
```

The generated binary is consumed by:

```text
public/js/core/ledger-bridge.js
```

CI builds the WASM artifact automatically.

The deployed browser has been confirmed to load the generated binary without errors.

The remaining browser-level validation item is a live side-by-side comparison of:

```text
WASM-backed results
vs.
JS-backed results
```

inside the deployed application.

---

# Deploying to GitHub Pages

AIWA is intentionally deployable as static files.

One-time configuration:

```text
GitHub repository
      ↓
Settings
      ↓
Pages
      ↓
GitHub Actions
```

The workflow:

```text
.github/workflows/deploy-pages.yml
```

deploys:

```text
public/
```

on pushes to `main`.

There is no application server.

There is no application build step.

---

# GitHub Trends Automation

The repository includes:

```text
scripts/fetch-github-trends.mjs
.github/workflows/update-github-trends.yml
public/data/github-trends.json
```

The scheduled workflow uses GitHub's official public repository search API to produce a daily trends snapshot.

The application fetches the committed JSON lazily and caches it. It is explicitly labelled as **external inspiration, not AIWA network activity**. It is never mixed into fields whose meaning is authoritative AIWA network state.

The CI workflow excludes the bot's daily data commit from triggering a full CI cycle through `paths-ignore`, avoiding an unnecessary self-trigger loop.

# GitHub Trends Automation

The workflow:

```text
.github/workflows/update-github-trends.yml
```

runs daily.

It uses GitHub's public repository search API to generate:

```text
public/data/github-trends.json
```

The application:

- fetches the file lazily,
- caches it,
- does not await it inside render functions.

The main CI workflow ignores the bot's daily data commit through `paths-ignore`.

---

# Network Model

The intended network model is delay-tolerant.

A domain can continue operating while disconnected:

```text
Domain A
   │
   │ partition
   ▼
local events
local materialization
local modules
local claims
```

Later:

```text
Domain A
   │
   │ reconnect
   ▼
transport queue
   │
   ▼
Domain B
   │
   ▼
merge()
   │
   ▼
same event set
   │
   ▼
deterministic materialization
```

---

# WebRTC

A WebRTC mesh transport is intentionally **not faked**.

The repository defines the transport interface required to support it, but a real signaling infrastructure is not available in the reference environment.

Instead of shipping a fabricated implementation that pretends to connect, AIWA keeps the backend explicitly marked as a future integration.

This distinction matters:

> **An honest stub is safer than a fake distributed system.**

---

# Protocol-Level Invariants

Some of the most important invariants are:

### Deterministic event identity

```text
same canonical event → same event ID
```

### Idempotent merge

```text
merge(H, H) = H
```

### Deterministic materialization

```text
same H_d + same θ → same A
```

### Monotonic cadence

```text
q_next ∈ {q, q + 1}
```

with replay protection.

### Conservation

```text
Consume(p) ≤ 1
```

### Module integrity

```text
registered hash == fetched hash
```

### Contract immutability

```text
release.condition = mint.condition
```

not:

```text
release.condition = attacker supplied condition
```

### Identity proof

```text
SHA-256(signerPubkey) == domain
```

---

# What AIWA Does Not Claim

AIWA deliberately avoids several stronger claims.

It does **not** currently claim to be:

- a production-ready public blockchain,
- a formally verified distributed consensus protocol,
- a true asymmetric VDF system,
- a complete Sybil-resistant identity system,
- a Byzantine fault tolerant consensus protocol,
- a globally synchronized clock,
- a fully specified cross-platform floating-point standard,
- a complete WebRTC mesh implementation,
- an authoritative AI consensus layer.

The project is a **reference implementation and experimental architecture**.

That distinction is intentional.

---

# Open Items

The current whitepaper tracks open issues explicitly.

## Closed / materially addressed

```text
R11 — cadence integrity
     → VDF mechanism

R19 — module sandbox isolation
     → sandboxed iframe without allow-same-origin
```

## Dampened, not fully closed

```text
Identity churn
```

The slot-scaled identity-cost curve makes churn more expensive but does not mathematically eliminate the strategy.

## Open

### WASM live-result comparison

The binary loads in the browser, but a deployed-browser side-by-side execution comparison remains to be completed.

### AI authoritative layer

The AI remains advisory.

There is currently no protocol role for AI-generated authority.

### Numeric / float consensus semantics

The protocol still needs a stronger specification for numeric behavior across runtimes and architectures.

### Protocol versioning

A formal versioning strategy remains an open protocol item.

### Formal conformance suite

The current test vectors are strong regression artifacts, but they should eventually become a formally defined conformance suite that independent implementations can run.

---

# Whitepaper

The implementation specification is maintained in:

```text
docs/AIWA_whitepaper_v1_2_revised.md
```

The whitepaper is kept synchronized with implementation findings.

When implementation work reveals:

- a bug,
- a model gap,
- an interoperability issue,
- a protocol ambiguity,
- a security boundary,

the finding is incorporated at the relevant location in the paper rather than hidden in a changelog.

---

# Claim / Evidence / Assumption Discipline

AIWA uses three categories when discussing protocol properties:

| Label | Meaning |
|---|---|
| **Proved** | Directly established by the model or an invariant |
| **Tested** | Confirmed by executable tests |
| **Conditional** | True under explicitly stated assumptions |
| **Open** | Not yet established |

This vocabulary is intentional.

A test passing is not automatically a mathematical proof.

A model assumption is not automatically an implementation guarantee.

And an implementation working in one environment is not automatically a universal protocol property.

---

# Design Vocabulary

## `H_d`

The event DAG associated with a domain.

## `G`

The deterministic materialization function.

## `θ`

The protocol parameter set.

## `A`

Materialized application state.

## Domain

A cryptographically identified participant context.

## Cadence

The monotonic local epoch progression used by the economic model.

## Claim

A conserved unit of value that can be transformed but not created by conservation logic.

## Pot

A contract-controlled address/state container without an autonomous private key.

## Module

A third-party application component executed inside the sandbox.

## Causal event

An event whose meaning depends on DAG history.

## Transport message

A real-time or queued communication payload that does not automatically become consensus history.

---

# Architectural Summary

AIWA can be summarized as:

```text
                    ┌──────────────────┐
                    │      AI / UI     │
                    │   non-authority  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Materialized A   │
                    │     = G(H, θ)    │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
         Economics      Conservation    Contracts
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    ┌──────────────────┐
                    │    Event DAG     │
                    │       H_d        │
                    └────────┬─────────┘
                             │
                    deterministic merge
                             │
                             ▼
                    ┌──────────────────┐
                    │ Delay-Tolerant   │
                    │    Transport     │
                    └──────────────────┘
```

The central design constraint is simple:

> **If a property matters to interoperability, security, or economic correctness, it should be represented in deterministic data and executable verification rather than left as an informal convention.**

---

# Status

AIWA is an **experimental reference implementation**.

The repository currently demonstrates:

- deterministic event-DAG materialization,
- JS/Rust parity,
- persistent local history,
- cadence and VDF verification,
- deterministic economics,
- scarcity accounting,
- conservation semantics,
- external identity-cost proofs,
- signed module registration,
- content-addressed module integrity,
- browser sandboxing,
- delay-tolerant transport,
- generic causal contracts,
- deterministic pools,
- replicated profiles,
- local WebLLM integration,
- automated GitHub trend ingestion,
- static deployment.

The remaining limitations are documented rather than hidden.

---

# License

See the repository license file for the applicable terms.

---

<div align="center">

**AIWA**

*Autonomous · Deterministic · Delay-Tolerant · Inspectable*

`H_d` → `G(H_d, θ)` → `A`

</div>
