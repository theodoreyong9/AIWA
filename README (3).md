# AIWA
## Autonomous Interplanetary Web Application

> **Reference implementation of a serverless, event-DAG-based application architecture for disconnected, intermittently connected domains.**
>
> AIWA separates the **causal ledger** `H_d` from the **materialized application state** `A = G(H_d, θ)`, and is designed to keep convergent state, economic rules, conservation rules, identity, modules, transport, and presentation independently testable.

<p align="center">

**Event DAG · Deterministic Materialization · Offline-First · JS/WASM · Cryptographic Identity · Sandboxed Modules**

</p>

---

## Table of contents

- [What is AIWA?](#what-is-aiwa)
- [Core idea](#core-idea)
- [Architecture at a glance](#architecture-at-a-glance)
- [Repository structure](#repository-structure)
- [Protocol model](#protocol-model)
- [Ledger — event DAG](#ledger--event-dag)
  - [Event identity](#event-identity)
  - [Merge semantics](#merge-semantics)
  - [Materialization order](#materialization-order)
  - [Persistence](#persistence)
  - [Domain identity](#domain-identity)
  - [JS/Rust parity](#jsrust-parity)
- [Economics — `G(H_d, θ)`](#economics--gh_d-θ)
  - [Reward formula](#reward-formula)
  - [Cadence](#cadence)
  - [Cadence VDF](#cadence-vdf)
  - [Scarcity](#scarcity)
  - [Formula registry](#formula-registry)
  - [Sybil analysis](#sybil-analysis)
- [Conservation](#conservation)
  - [Claim state machine](#claim-state-machine)
  - [Economic bridge](#economic-bridge)
  - [Transfer authorization](#transfer-authorization)
  - [Double-spend protection](#double-spend-protection)
- [Identity — `c_id`](#identity--c_id)
  - [Solana burn](#solana-burn)
  - [Identity churn resistance](#identity-churn-resistance)
  - [Wallet security](#wallet-security)
  - [Adding another chain](#adding-another-chain)
  - [Identity UI](#identity-ui)
- [Modules](#modules)
  - [Registration](#registration)
  - [Content addressing](#content-addressing)
  - [Registry replication](#registry-replication)
  - [Rank](#rank)
  - [Signed submission](#signed-submission)
  - [Sandbox](#sandbox)
  - [`ctx` API](#ctx-api)
  - [Theme injection](#theme-injection)
  - [Module loading](#module-loading)
- [Transport](#transport)
  - [Transport interface](#transport-interface)
  - [Delay-tolerant transport](#delay-tolerant-transport)
  - [Connection watchdog](#connection-watchdog)
  - [WebRTC status](#webrtc-status)
- [Pools and composable contracts](#pools-and-composable-contracts)
  - [Pool primitive](#pool-primitive)
  - [Causal condition evaluator](#causal-condition-evaluator)
  - [Generic contracts](#generic-contracts)
  - [Jackpot example](#jackpot-example)
- [Presentation and desktop](#presentation-and-desktop)
  - [Themes](#themes)
  - [Desktop layout](#desktop-layout)
  - [Design system](#design-system)
- [AI idea agent](#ai-idea-agent)
  - [Context construction](#context-construction)
  - [WebLLM](#webllm)
  - [Pattern miner](#pattern-miner)
  - [GitHub trends](#github-trends)
  - [AI boundaries](#ai-boundaries)
- [Hyperprofile](#hyperprofile)
- [Cross-language parity](#cross-language-parity)
- [Security model](#security-model)
- [Deliberately broken counterexamples](#deliberately-broken-counterexamples)
- [Testing](#testing)
- [Building Rust → WASM](#building-rust--wasm)
- [Running the application](#running-the-application)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Whitepaper](#whitepaper)
- [Current status](#current-status)
- [Open items](#open-items)
- [Design principles](#design-principles)

---

# What is AIWA?

**AIWA — Autonomous Interplanetary Web Application** is a reference implementation of an application architecture intended to operate across domains that may be:

- disconnected,
- intermittently connected,
- independently advancing,
- locally materializing state,
- and reconciling later.

The architecture is built around two separate concepts:

```text
                    Causal history
                         H_d
                          │
                          │ deterministic fold
                          ▼
                 A = G(H_d, θ)
                          │
                          ▼
               Materialized application
                       state
```

Where:

- `H_d` is an **event DAG** containing the domain's causal history.
- `θ` is the immutable protocol/economic parameter set relevant to the computation.
- `G` is a deterministic materialization function.
- `A` is the application state derived from the event history.

The key architectural rule is:

> **The event history is authoritative. The application state is derived.**

This prevents local mutable state from silently becoming protocol state.

AIWA is intentionally implemented as a **static web application**:

- no application server,
- no database server,
- no build step for the deployed `public/` application,
- persistence through browser storage,
- reconciliation through transport,
- optional Rust/WASM execution for the ledger core.

---

# Core idea

AIWA treats an application as a replicated causal system rather than as a conventional client/server application.

A domain can continue operating locally while disconnected:

```text
       DOMAIN A                          DOMAIN B

       H_A                               H_B
        │                                 │
        │ local events                    │ local events
        ▼                                 ▼
     A = G(H_A)                        B = G(H_B)

              disconnected
                   │
                   │
                   ▼

              reconciliation

                   │
                   ▼

              H_A ∪ H_B
                   │
                   ▼
             G(H_A ∪ H_B)
```

`merge()` is a set union of events. Once two domains exchange their missing events, they converge on the same event set.

That convergence only works if all implementations agree on:

1. event identifiers,
2. canonical serialization,
3. parent semantics,
4. merge behavior,
5. topological ordering,
6. reducer semantics,
7. numeric semantics,
8. protocol parameters.

AIWA therefore treats deterministic materialization and cross-language parity as protocol concerns rather than implementation details.

---

# Architecture at a glance

```text
┌──────────────────────────────────────────────────────────────────┐
│                           AIWA APP                               │
│                                                                  │
│  ┌───────────────────────┐        ┌───────────────────────────┐ │
│  │       UI / Desktop    │        │       AI Idea Agent       │ │
│  └───────────┬───────────┘        └────────────┬──────────────┘ │
│              │                                 │                │
│              └──────────────┬──────────────────┘                │
│                             ▼                                   │
│                  ┌──────────────────────┐                       │
│                  │   Domain Reducers    │                       │
│                  │ economics            │                       │
│                  │ conservation         │                       │
│                  │ identity             │                       │
│                  │ modules              │                       │
│                  │ pools/contracts      │                       │
│                  │ profiles             │                       │
│                  └──────────┬───────────┘                       │
│                             │                                   │
│                             ▼                                   │
│                  ┌──────────────────────┐                       │
│                  │    ledger-bridge     │                       │
│                  └──────────┬───────────┘                       │
│                             │                                   │
│                 ┌───────────┴───────────┐                       │
│                 ▼                       ▼                       │
│        ┌─────────────────┐     ┌─────────────────┐              │
│        │ event-dag.js    │     │ Rust → WASM     │              │
│        │ Reference core  │     │ Optimized core  │              │
│        └─────────────────┘     └─────────────────┘              │
│                                                                  │
│                  H_d  →  G(H_d, θ)                              │
└──────────────────────────────────────────────────────────────────┘
```

The backend boundary is deliberately narrow:

```text
application
    │
    ▼
ledger-bridge.js
    │
    ├── WASM available → wasm-ledger-adapter.js → Rust
    │
    └── otherwise      → event-dag.js            → JS
```

No application-level reducer should need to know which ledger implementation is active.

---

# Repository structure

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
│   │   │
│   │   ├── economics/
│   │   │   ├── cadence
│   │   │   ├── cadence_vdf
│   │   │   ├── reward
│   │   │   ├── scarcity
│   │   │   ├── g
│   │   │   └── formula_registry_reducer
│   │   │
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

# Protocol model

AIWA's protocol can be viewed as three nested layers:

```text
┌─────────────────────────────────────────────┐
│ Presentation / AI / Desktop / Plugins       │
├─────────────────────────────────────────────┤
│ Materialized state A = G(H_d, θ)            │
├─────────────────────────────────────────────┤
│ Event DAG H_d                                │
└─────────────────────────────────────────────┘
```

The distinction matters.

A UI variable is not automatically consensus state.

An AI suggestion is not automatically a protocol event.

A module-local value is not automatically globally authoritative.

A materialized balance is not independently stored authority; it is derived from the causal history.

---

# Ledger — event DAG

## `event-dag.js`

`public/js/core/event-dag.js` is the current production reference implementation.

It is:

- pure JavaScript,
- zero dependencies,
- content-addressed,
- deterministic,
- mergeable,
- independently testable.

Each event contains a canonical payload and parent references.

The event identifier is:

```text
eventId =
    SHA-256(
        canonicalized event payload
        +
        canonicalized parent ids
    )
```

The canonicalization step is critical because different languages must hash logically identical JSON structures identically.

---

## Event identity

JavaScript's normal:

```js
JSON.stringify(object)
```

preserves insertion order.

Rust's `serde_json` behavior does not inherently provide the same ordering guarantee for arbitrary objects.

AIWA therefore recursively canonicalizes JavaScript objects by sorting keys before hashing.

Conceptually:

```text
logical object
     │
     ▼
recursive key sorting
     │
     ▼
canonical JSON
     │
     ▼
SHA-256
     │
     ▼
event id
```

Arrays retain their semantic order.

Object keys are sorted.

Parent identifiers are canonicalized before hashing.

This is part of the protocol contract.

---

## Merge semantics

`merge()` is a set union.

If:

```text
H_A = {a, b, c}
H_B = {c, d, e}
```

then:

```text
merge(H_A, H_B)
=
{a, b, c, d, e}
```

The operation is:

- idempotent,
- order-independent,
- monotonic with respect to event knowledge.

Re-merging an event that is already known does not create another event.

---

## Subscription semantics

`subscribe()` notifies listeners only when genuinely new events are added through:

- `addEvent()`
- `merge()`

Re-adding an already-known event does **not** fire the listener.

This prevents duplicate notifications from becoming accidental application behavior.

---

## Materialization order

A deterministic event set is not sufficient by itself.

Concurrent events can have multiple valid topological orders.

AIWA therefore makes the following ordering rule explicit:

> **Materialization uses id-sorted depth-first topological ordering.**

This is a protocol-level rule.

Two implementations can both claim to deterministically topologically sort a DAG while still disagreeing on the order of concurrent branches if their tie-breaking rules differ.

Therefore:

```text
H_d
 │
 ├── valid topological order A
 ├── valid topological order B
 └── valid topological order C
```

is not enough.

AIWA requires:

```text
H_d
 │
 ▼
one specified deterministic order
 │
 ▼
G(H_d, θ)
```

`topologicalSortForReplay()` is extracted as pure logic and tested.

Its output is confirmed replayable through a real `EventDag` without triggering unknown-parent rejection.

---

# Persistence

## IndexedDB

`event-dag-persistence.js` persists `H_d` through IndexedDB.

The event history survives:

- tab close,
- page reload,
- browser session restart, subject to browser storage policy.

Persistence is deliberately separated from the ledger itself.

The DAG remains pure logic.

---

## Restoring the causal tip

A subtle restore problem exists around cadence.

If the application only restored an arbitrary cached tip, a post-restore cadence event could accidentally start from the wrong epoch.

AIWA therefore provides:

```text
restoreTipsFromDag()
```

which recovers the domain's actual cadence tip from the restored DAG.

A subsequent cadence advance therefore chains from the last known real cadence state rather than from genesis.

---

# Domain identity

`domain-id.js` derives the domain identifier as:

```text
domainId = SHA-256(publicKey)
```

The full identifier is:

```text
64 hexadecimal characters
```

That is the complete 256-bit SHA-256 output.

A shorter display label may be used in UI:

```text
shortDomainLabel(...)
```

but the full domain id is used inside signature verification.

This distinction is security-critical.

A display label is not an identity.

---

# JS/Rust parity

The JS and Rust cores are designed to produce the same results.

The parity suite covers:

- flat payloads,
- nested payloads,
- arrays,
- unsorted parents,
- different object key insertion orders representing the same logical object.

Current identity vector coverage:

```text
6 / 6 vectors match
```

The parity check is run in CI.

---

# Economics — `G(H_d, θ)`

The economic state is materialized through:

```text
A = G(H_d, θ)
```

`g.js` performs a complete fold over the deterministic topological order.

The core economic event types are:

```text
genesis
cadence
accrual
```

---

## `genesis`

A `genesis` event initializes the domain.

The protocol default reward formula is identified as:

```text
genesis
```

in the formula registry and does not require a separate registration event.

This avoids a bootstrapping paradox where the protocol would need an economic event to define the economic rule required to process the first economic event.

---

## `cadence`

A cadence event advances the domain's local epoch.

The cadence is:

- monotonic,
- replay-protected,
- bounded to `+1`,
- backed by a VDF proof.

Cadence is domain-local.

There is intentionally no requirement for all domains to share a global chain height.

---

## `accrual`

An accrual event carries:

```text
{
    domain,
    b,
    q0
}
```

The reducer derives the effective `q` from cadence state as materialized so far.

The resulting reward is calculated by the reward function and passed to the scarcity reducer.

---

# Reward formula

AIWA's current Proof-of-Will reward function is adapted from YourMine's `calcClaimable()`:

```text
r(b, q, q_total, T)
=
(b · q^α)
/
[ ln(q_total^(β(1−T)) + C) ]^γ
```

Reference parameters:

```text
α = 1.1
β = 2.2
γ = 3
C = 35937
```

A reference calculation is:

```text
r(1, 100, 100, 0)
=
0.11844290947765648
```

This result has been confirmed through:

1. direct function execution,
2. full cadence replay through a real `EventDag`,
3. cross-language JS/Rust parity.

---

## `q_total`

`q_total` is the domain's own cadence epoch count.

It is deliberately **not** a shared global chain height.

Using a global height would reintroduce cross-domain synchrony and undermine the disconnected-domain model.

The minimum-slot waiting concept from the original formula is represented as:

```text
minQ
```

which is a deployment-selected epoch count.

---

# Cadence VDF

Every cadence transition must carry a sequential SHA-256 chain.

The recurrence is:

```text
h_i = SHA-256(h_{i-1})
```

The seed incorporates:

- the domain,
- the prior epoch's real VDF output.

Therefore epoch `N` cannot simply fabricate an independent proof without computing from epoch `N-1`.

Conceptually:

```text
epoch 0
   │
   ▼
h0
 │
 ├── SHA-256
 ▼
h1
 │
 ├── SHA-256
 ▼
h2
 │
 ├── ...
 ▼
hN
```

Verification recomputes the chain.

---

## What the VDF does and does not guarantee

The implementation deliberately does **not** call this a cryptographically asymmetric VDF.

Verification costs approximately what computation costs.

That means:

```text
NOT:
"cheap verification vs expensive generation"
```

but rather:

```text
"sequential work that prevents thousands of cadence events
 from being fabricated in milliseconds"
```

The iteration count is configurable in the Parameters screen.

Default:

```text
200,000 iterations
```

Typical reference hardware:

```text
≈ 240 ms
```

The exact duration is hardware-dependent.

Difficulty is therefore hardware-relative.

---

# Scarcity

`scarcity.js` implements the preallocated-budget policy.

The central function:

```text
applyIssuanceAttempt()
```

clamps the amount that can actually be issued to the remaining domain budget.

The simulation helper:

```text
simulateHourlyIssuance()
```

reproduces the whitepaper's issuance simulation.

Reference results:

```text
I(1000h)  = 2,000
I(10000h) = 20,000
```

for the unbounded control case.

With a:

```text
5,000 + 5,000
```

preallocated budget, the simulated issuance saturates at:

```text
10,000
```

---

# Formula registry

`formula-registry-reducer.js` makes reward parameters immutable once registered.

A:

```text
formula-register
```

event permanently binds an identifier to:

```text
(alpha, beta, gamma, C, minQ)
```

There is no update path.

Once registered:

```text
formulaId
    │
    └── fixed forever
```

Attempting to re-mint the same formula id with different parameters is rejected.

This prevents two reconciled domains from interpreting the same formula identifier differently.

The protocol default:

```text
genesis
```

is fixed by the protocol itself.

---

## Local formula selection

The existence of a formula and the formula currently selected by a domain are separate concerns.

A domain may select a registered formula locally.

The formula's parameters cannot silently mutate.

This prevents a subtle fork where:

```text
same event
+
same formula id
+
different hidden parameters
```

would otherwise produce different materialized balances.

---

# Sybil analysis

The current formula has a linear `b` term.

Before identity cost is introduced, splitting capital into multiple domains is exactly reward-neutral under the model.

Therefore:

```text
capital splitting
```

does not itself create additional reward.

Once:

```text
c_id > 0
```

is introduced, the optimal number of identities is:

```text
N* = 1
```

unconditionally under the current capital-splitting analysis.

---

## Identity churn

A different attack is:

```text
abandon old domain
       ↓
create fresh domain
       ↓
avoid age decay
```

Simulation confirms that fresh identities can initially benefit from being near genesis.

The crossover occurs within a small number of simulated rounds as the deployment matures.

AIWA therefore includes a configurable slot-scaled identity cost curve.

This is explicitly described as:

> **Dampened, not fully closed.**

The mechanism does not distinguish an attacker from a legitimate late joiner.

That tradeoff is intentionally documented rather than hidden.

---

# Conservation

Economics creates value.

Conservation moves or transforms already-existing value.

The conservation layer therefore follows the rule:

> **Conservation never creates value.**

Value creation belongs to `G`.

---

# Claim state machine

A claim moves through five conceptual stages:

```text
Deactivate
    │
    ▼
Prove
    │
    ▼
Verify
    │
    ▼
Consume
    │
    ▼
Activate
```

These are implemented as individually callable functions.

The system does not hide them behind a single opaque black-box operation.

This matters because each stage can be tested independently.

---

# Economic bridge

`conservation-bridge.js` connects the conservation state machine to the economic materializer.

It implements three major event paths:

```text
claim-issue
transfer
pot-release
```

---

## `claim-issue`

A claim cannot simply be issued because a caller says a balance exists.

The bridge:

1. derives the domain's actual balance from `G`,
2. checks rejected economic event ids,
3. verifies that the requested amount was genuinely accrued,
4. creates the spendable claim.

The result is that conservation cannot become an independent mint.

---

# Transfer authorization

A transfer requires a real Ed25519 signature over:

```text
(claimId, from, to, nonce, timestamp)
```

The signature is verified against:

```text
signerPubkey
```

The system additionally verifies:

```text
SHA-256(signerPubkey) == from
```

This is proof of control over the domain key.

A declared string such as:

```text
claim.owner == from
```

is not sufficient.

Without cryptographic proof, a reconciled peer could forge a transfer claiming to be from another domain.

---

## Nonce replay protection

Transfers include a nonce.

The bridge rejects replayed nonces.

This prevents a valid signed transfer from being replayed repeatedly.

---

# Double-spend protection

The conservation invariant:

```text
count(Consume(p)) <= 1
```

is load-bearing.

AIWA keeps a deliberately broken counterexample showing why this must remain atomic.

If consumption is split into:

```text
check
    ↓
commit
```

without atomicity, two branches can both observe:

```text
"proof has not yet been consumed"
```

and both commit.

That can mint two destination claims from one proof.

The resulting behavior is a double spend.

AIWA therefore keeps the atomic consume invariant explicit and tested.

---

# `pot-release`

A pot release may be accepted without a direct transfer signature only when an injected verifier confirms that the release satisfies the deterministic contract.

The verifier is:

```text
injected by the caller
```

and is never silently hardcoded into the generic conservation bridge.

This keeps contract verification composable.

---

# Identity — `c_id`

AIWA uses a real economic identity cost.

Before a domain partitions from a connected environment, it can burn real SOL.

The resulting transaction becomes its identity-cost proof.

---

# Solana burn

The identity mechanism burns SOL to the Solana incinerator address:

```text
1nc1nerator11111111111111111111111111111111
```

The burn transaction signature becomes the domain's `c_id` proof.

The cost is sunk immediately.

This is intentional.

It avoids a model where a domain must remain connected so that a later slashing mechanism can enforce a bond.

---

## Identity registration flow

The identity flow is:

```text
wallet
  │
  ▼
construct burn transaction
  │
  ▼
sign
  │
  ▼
broadcast
  │
  ▼
verify
  │
  ▼
identity-register DAG event
  │
  ▼
merge / reconcile
```

Identity registration is a real DAG event.

This matters because identity state was previously a local standalone variable that would not automatically replicate.

Now:

```text
identity-register
```

is folded into materialized state and propagated through:

```text
merge()
```

---

# Identity churn resistance

The cost of registering a new identity can scale monotonically with the real Solana slot at which the burn was confirmed.

The slot is already present in the transaction response.

No additional RPC call is required.

Conceptually:

```text
later slot
    ↓
higher registration cost
    ↓
less attractive identity replacement
```

This specifically dampens the strategy of abandoning an aging identity to escape the age-dependent reward term.

It is not claimed to be a complete anti-Sybil solution.

---

# Wallet security

`solana-wallet.js` uses:

- real Ed25519 keypair generation,
- Web Crypto,
- AES-256-GCM encryption,
- password-based local protection.

The plaintext secret key is never persisted to storage.

The wallet is encrypted before being stored in `localStorage`.

Real signing is tested against the actual `@solana/web3.js` library.

A generated signature is round-tripped through the library's own deserializer and verified.

---

# Solana RPC

`solana-rpc.js` contains real RPC integration for:

```text
devnet
mainnet
```

The implementation has not been exercised live in this development environment because there is no available network path.

This is explicitly documented.

The code is not represented as a fake successful network implementation.

---

# Adding another chain

The identity-cost core is deliberately chain-agnostic.

A second chain should provide:

```text
xxx-wallet.js
xxx-rpc.js
```

and produce the same:

```text
NormalizedBurnTx
```

shape.

The chain-specific integration then remains outside:

```text
identity-cost.js
```

and its pure verification logic.

---

# Identity UI

The UI provides:

- wallet creation,
- wallet unlock,
- encrypted persistence,
- devnet/mainnet selector,
- explicit devnet warning,
- burn-to-register confirmation.

The confirmation dialog names:

```text
exact amount
network
irreversibility
```

The UI also prevents:

```text
Commit
Claim reward
```

from being activated until:

```text
hasIdentityCost(domain) === true
```

Devnet faucet SOL is explicitly described as **not providing real Sybil resistance**.

---

# Modules

AIWA supports third-party modules.

The module system is deliberately open.

There is:

- no allow-list,
- no approval step,
- no platform-side code generation requirement.

The mechanical registration checks are limited to protocol-level integrity and economic consistency.

---

# Registration

The registry provides:

```text
registerModule()
updateModuleCode()
auditModule()
```

The only basic mechanical rejections include:

- duplicate module id,
- inconsistent economic declaration for an issuing module.

Audit is intentionally a future AI/system responsibility.

---

# Content addressing

Every module registration binds its id to a:

```text
SHA-256(code)
```

hash.

The URL is not the identity.

The bytes are.

This means:

```text
module id
    +
code hash
    ↓
exact code version
```

An audit verdict therefore remains attached to the exact code it was made about.

---

## Code updates

Updating module code resets audit status to:

```text
unaudited
```

A module update is rejected unless the signer matches the recorded author.

This prevents an unrelated party from replacing another author's code under the same module id.

---

# Registry replication

The registry itself is a materialized view over the DAG.

The following event types are replicated:

```text
module-register
module-update
module-audit
```

Because they are DAG events:

```text
domain A registers module
          │
          ▼
        H_A
          │
          │ merge
          ▼
        H_B
          │
          ▼
module visible on B
```

No separate module database synchronization mechanism is necessary.

---

# Rank

`module-rank.js` computes a ranking key based on:

```text
r(burnedLamports, elapsedEpochs, θ)
```

using the author's real:

- identity cost,
- cadence state.

Submission eligibility is a ratio-must-not-decline check modeled on the real `checkScoreEligibility` behavior.

`rankFromIdentityAndCadence()` composes these inputs from materialized state.

Rank is displayed in the Domain catalog.

It does **not** control desktop layout order.

---

# Signed submission

`module-submission.js` implements a signed submission pipeline.

A submission contains:

```text
moduleId
codeHash
codeUrl
nonce
timestamp
signature
```

The pipeline:

1. fetches the actual code,
2. hashes the fetched bytes,
3. verifies the hash against the submission,
4. verifies the Ed25519 signature,
5. checks the nonce replay guard,
6. verifies author/update permissions,
7. only then performs registration/update.

The caller cannot simply submit a claimed code hash.

The system checks the code it actually fetched.

---

## Publishing is not economically gated

There is deliberately no economic gate on publishing.

The signature exists for:

- attribution,
- integrity,
- authorization.

It is not a token-payment requirement for publication.

---

# Sandbox

Module code runs in:

```html
<iframe sandbox="allow-scripts">
```

Critically:

```text
allow-same-origin
```

is not enabled.

The isolation is a property of where the code executes.

The module is not merely asked to behave safely.

---

## Context bridge

The module communicates with the host through:

```text
postMessage
```

The module does not receive unrestricted host application objects.

The host exposes the defined `ctx` surface.

---

## Hash mismatch behavior

Before mounting:

```text
fetch code
   ↓
SHA-256
   ↓
compare registered hash
```

If the hashes differ:

```text
mount = rejected
```

A URL changing behind the same module registration is therefore detected.

---

# `ctx` API

Modules receive a constrained context.

### Storage

```js
ctx.storage.get(key)
ctx.storage.set(key, value)
```

Storage is scoped to:

```text
(domain, moduleId)
```

---

### UI notifications

```js
ctx.toast(message)
```

The notification is logged through the real event-log path.

---

### Economic operations

```js
ctx.commit(b)
ctx.claim()
```

`commit()` stakes a claim at the current cadence epoch.

`claim()` claims reward for elapsed epochs.

---

### Causal events

```js
ctx.postCausalEvent(type, payload)
```

The host forces the real caller domain id onto every event.

A module cannot impersonate another domain by simply placing a different domain id in its payload.

---

### Causal state

```js
ctx.queryCausalState(contractId)
```

This exposes generic causal state without giving modules arbitrary authority over consensus evaluation.

---

### Hyperprofile

```js
ctx.share(key, value)
```

A `null` value retracts the key.

---

### Peer messaging

```js
ctx.sendToPeer(domainId, message)
ctx.onPeerMessage(handler)
```

Messages are routed through the real transport layer.

Delivery requires the target module to currently be mounted.

There is no inbound queue for modules.

---

### Theme

```js
ctx.theme
```

The theme is provided as real parseable JSON.

---

# Theme injection

`module-sandbox.js` injects the active theme in two forms:

```text
CSS custom properties
+
ctx.theme JSON
```

The token values are identical.

The module's source code remains byte-identical across theme presets.

Only the injected presentation data changes.

---

# Module loading

`module-loader.js`:

1. fetches the real module,
2. hashes the fetched bytes,
3. compares them to the registered hash,
4. blocks mounting on mismatch,
5. mounts only verified code.

The check is performed before execution.

---

# Transport

AIWA's transport layer is deliberately abstract.

`transport.js` defines the interface.

The rest of the application should use:

```text
transport.send()
```

rather than directly assuming a specific network backend.

---

# Transport interface

`assertImplementsTransport()` ensures that incomplete transport implementations fail loudly.

Instead of silently discovering a missing method later, the application identifies exactly which interface requirement is absent.

---

# Delay-tolerant transport

`delay-tolerant-transport.js` implements:

```text
queue first
then attempt delivery
```

A message is durably queued before a network attempt.

---

## FIFO behavior

FIFO is preserved **per peer**.

If:

```text
A → B:
  m1
  m2
  m3
```

then:

```text
m1
m2
m3
```

must not be reordered.

If `m1` fails:

```text
m1  ← failure
m2
m3
```

the queue stops at the first failure.

Different peers have independent queues.

---

## Successful delivery

Once a message is successfully delivered, it is removed from the queue.

It is not retained as a permanently "queued" message after successful delivery.

---

# Connection watchdog

`connection-watchdog.js` fires the stale callback:

```text
exactly once per stale episode
```

A reconnect resets the episode.

The boundary condition:

```text
activity exactly at timeout
```

is explicitly defined and tested with an injected clock.

---

# WebRTC status

A WebRTC mesh backend is intentionally **not fabricated**.

Real signaling infrastructure is not available in the development environment.

Therefore the repository does not ship a pretend implementation that claims to establish real connections.

The current app uses a simulated within-tab delivery path:

```text
link up
    ↓
real dag.merge()

link down
    ↓
real queueing
```

The Reconcile action goes through:

```text
transport.send()
```

rather than directly calling:

```text
dag.merge()
```

---

# Pools and composable contracts

AIWA contains a general pooling primitive and a generic contract system.

The goal is to avoid writing a new hand-coded security evaluator for every new application primitive.

---

# Pool primitive

`pool-reducer.js` provides:

```text
pool-init
pool-contribute
pot-release
```

---

## Pool addresses

A pool is represented by a pot address that deliberately has no keypair.

This is intentional.

No individual party should be able to move pooled value simply because the pool has a string identifier.

---

## Contributions

`pool-contribute` records real signed claims.

---

## Payout verification

`verifyPoolPayout` uses:

```text
causal-condition-evaluator
```

rather than embedding another custom security-check implementation.

---

# Weighted draw parity

The weighted draw is cross-language tested.

Both JS and Rust receive:

```text
poolId
cycleIndex
contributions
```

and must produce identical:

```text
winnerDomain
totalAmount
drawHash
```

The full 64-character draw hash is pinned as a regression property.

---

# Causal condition evaluator

`causal-condition-evaluator.js` and its Rust counterpart expose six primitives:

```text
ownership
signature
count
deterministic-match
unique
causal-order
```

They can be composed using:

```text
AND
OR
NOT
```

---

## Security boundary

The evaluator never executes submitted code.

Conditions are declarative data.

Conceptually:

```text
submitted condition
       │
       ▼
declarative parser
       │
       ▼
known primitives
       │
       ▼
deterministic evaluation
```

No arbitrary JavaScript is evaluated as a verification rule.

---

# Generic contracts

`generic-contract-reducer.js` allows third parties to define new contracts without changing platform code.

The key invariant is:

> **The verification condition is fixed at mint time.**

A contract's release event only supplies:

```text
claimId
from
to
contractId
```

It cannot provide or replace the condition.

---

## Condition smuggling defense

A malicious release event such as:

```text
{
    claimId,
    from,
    to,
    contractId,
    condition: maliciousCondition
}
```

cannot smuggle a new condition.

The reducer loads the condition that was fixed in the original mint record.

A test explicitly chooses a minted condition that is unambiguously false and confirms that an injected release-time condition is ignored.

---

# 2-of-2 escrow demo

The generic contract system includes a real example of a:

```text
2-of-2 threshold-release escrow
```

It is expressed as a `count` condition over real approval events.

The demo uses the generic contract machinery rather than duplicating pool-specific logic.

---

# Jackpot example

The repository contains:

```text
examples/jackpot-plugin/jackpot.js
```

This is a real example plugin.

The jackpot is:

- funded through AIWA,
- represented through AIWA's pool mechanism,
- paid through AIWA's causal contract machinery.

The historical pool address prefix:

```text
jackpot-pot:<poolId>
```

is intentionally preserved.

This is an important protocol discipline:

> Renaming implementation files around data that is already live in `H_d` must never retroactively change the meaning of that existing data.

---

# Presentation and desktop

AIWA separates presentation state from causal protocol state.

The desktop layout is implemented as pure logic.

---

# Themes

`theme-tokens.js` provides two presets:

```text
default
compact
```

Both contain the exact same token key set.

The `compact` preset is designed for:

- bandwidth-constrained nodes,
- hardware-constrained nodes,
- maximum-contrast presentation.

Its secondary text is collapsed toward the same visual value as primary text.

---

## Theme conversion

`themeToCssVariables()` produces a real:

```css
:root {
    ...
}
```

block.

The Parameters screen switches:

```text
activeThemeId
```

and the theme selector has exactly one state side effect:

```text
reassign activeThemeId
```

It does not mutate unrelated application state.

---

# Desktop layout

`desktop-layout.js` is DOM-free.

It handles:

- reorder,
- folding two icons into a folder,
- merging into an existing folder,
- eject,
- removal.

---

## Explicit eject

Eject is an explicit tap/action.

It is not implemented as an implicit drag-out gesture.

---

## Rank does not control layout

Rank is calculated and displayed.

It does not determine desktop ordering.

This is intentional.

If rendering automatically sorted icons by rank, every state refresh could silently destroy the user's manual arrangement.

---

## Storage migration

Older flat pin-list storage can be migrated transparently.

Corrupted desktop storage degrades to an empty layout rather than crashing the application.

---

# Design system

`public/css/aiwa.css` defines the visual system.

Core characteristics:

```text
dark base
amber accent
IBM Plex typography
hairline borders
near-zero border radius
zero shadows
zero gradients
```

Reference colors:

```text
background: #0B0D10
accent:     #E3A008
```

Green and red are reserved for semantic proof/status states.

---

## Typography

The design system uses:

```text
IBM Plex Mono
```

for headings and technical/protocol presentation.

It uses:

```text
IBM Plex Sans
```

for body content.

The interface is deliberately closer to a technical instrument than a conventional consumer dashboard.

---

## Responsive layout

The UI provides:

- left sidebar above approximately 900px,
- responsive multi-column card grids,
- compact presentation mode,
- bounded floating plugin runner.

Status indicators reuse the whitepaper vocabulary:

```text
Proved
Tested
Conditional
Open
```

These are UI primitives rather than decorative labels.

---

# AI idea agent

The AI layer is intentionally advisory.

`idea-agent.js` produces suggestions.

It does not write consensus.

It does not create protocol events by itself.

It does not have an authoritative role.

---

# Context construction

The idea agent builds a context snapshot from:

1. real desktop pins,
2. the domain's own published hyperprofile data,
3. published module data,
4. recency-weighted network categories,
5. category gaps,
6. multi-contact overlap,
7. GitHub repository trends,
8. module primitive usage.

---

## Desktop context

The agent can inspect what the local user has pinned.

This is local application context, not network consensus.

---

## Hyperprofile context

The domain's own published profile information is used after registration.

This lets the agent reason about actual published intent rather than inventing a profile.

---

# Recency-weighted categories

The agent does not simply count all historical modules equally.

It considers the most recently registered third of the network.

Therefore:

```text
3 recent modules
```

can outweigh:

```text
months of stale accumulation
```

This makes the trend signal responsive to current network activity.

---

# Category gaps

The agent can identify categories that exist in the network but are absent from the local domain's modules.

This creates:

```text
network capability
        ↓
local gap
        ↓
idea suggestion
```

---

# Multi-contact overlap

A category is considered to have meaningful multi-contact overlap only when:

```text
2+ distinct contacts
```

have registered modules in that category.

Two modules from the same contact do not count as multi-contact evidence.

This prevents a single prolific publisher from artificially manufacturing a social signal.

---

# GitHub trends

The agent can also use:

```text
public/data/github-trends.json
```

generated by the GitHub trends workflow.

The prompt explicitly labels this information as:

> **NOT this AIWA network — inspiration only.**

GitHub trends never leak into fields that represent actual AIWA network activity.

Freshness is also stated honestly.

The data may be stale.

---

# WebLLM

`webllm-engine.js` uses:

- WebGPU detection,
- a dedicated Worker,
- `@mlc-ai/web-llm`,
- streaming responses.

The AI runs in the browser.

This path is currently marked as untestable in the available development environment because a real browser/WebGPU runtime is not available here.

The implementation is nevertheless real rather than a fake placeholder.

---

# Pattern miner

`module-pattern-miner.js` mines real module code from the local registry.

It uses the same hash-verifying loading path as module mounting:

```text
loadVerifiedModuleCode()
```

The miner is bounded to:

```text
20 modules
```

It identifies actual usage of primitives such as:

```text
storage
postCausalEvent
share
sendToPeer
```

It can report primitives that no locally-known module has used yet.

This creates concrete:

```text
"nobody's tried this yet"
```

hooks for the idea agent.

The implementation is bounded, cached, and non-blocking.

---

## Prompt safety boundary

The rendered prompt is verified not to contain:

```text
code skeletons
```

or the word:

```text
skeleton
```

The agent produces text suggestions only.

It does not generate executable module code.

---

# GitHub trends workflow

`scripts/fetch-github-trends.mjs` uses GitHub's official public repository search API:

```text
GET /search/repositories
```

The scheduled GitHub Action runs daily and commits:

```text
public/data/github-trends.json
```

The app fetches this file lazily and caches it.

It is never awaited inside a render function.

---

## CI optimization

The main CI workflow uses:

```text
paths-ignore
```

to prevent the automated daily trends commit from unnecessarily triggering the complete CI suite.

---

# Hyperprofile

`public-profile-reducer.js` and its Rust counterpart implement a DAG-replicated key/value store.

Conceptually:

```text
ctx.share(key, value)
```

creates public profile information.

A:

```text
value: null
```

retracts the value.

---

## Latest-write-wins

The profile uses:

```text
latest-write-wins
```

materialization.

The state is replicated through the DAG like other protocol-visible state.

---

## Visiting a profile

The Contacts screen can expose a:

```text
Visit profile
```

action.

The resulting profile view shows information that the domain has genuinely published.

It is materialized through the same causal-state architecture rather than being a separate hidden profile database.

---

# Real-time peer messaging

Modules can communicate with peers through:

```js
ctx.sendToPeer(domainId, message)
```

and:

```js
ctx.onPeerMessage(handler)
```

The route is through the transport layer.

---

## Mounted-module requirement

Messages are delivered only when the destination module is currently mounted.

There is no inbound module-message queue.

This intentionally distinguishes:

```text
real-time delivery
```

from:

```text
causal DAG replication
```

---

## No accidental DAG merge

A real-time module message does not automatically trigger a DAG merge.

The application branches on the message's declared type before deciding whether the data is:

- real-time,
- causal,
- or otherwise handled.

---

# Cross-language parity

The Rust implementation is intended to be a drop-in semantic counterpart to the JS reference core.

The parity suite currently covers the major protocol layers.

| Layer | Script / test | Coverage |
|---|---|---|
| Event IDs | `scripts/verify-parity.sh` | canonicalization + hashing |
| `G` | `scripts/verify-g-parity.sh` | composed materialization |
| Conservation | `scripts/verify-conservation-parity.sh` | claim scenarios |
| Submission signatures | `scripts/verify-submission-parity.sh` | both signing directions |
| Pool draw | Rust parity test | deterministic weighted draw |

---

## Submission parity

The submission parity test verifies both directions:

```text
JS signs
  ↓
Rust verifies
```

and:

```text
Rust signs
  ↓
JS verifies
```

Fresh keypairs are generated for each run.

This avoids accidentally relying on a single hard-coded signing fixture.

---

# Security model

AIWA's security model is based on explicit boundaries.

## 1. Event identity

Events are content-addressed.

Changing the signed/hashed event payload changes the event id.

---

## 2. Deterministic replay

Materialized state is recomputed from:

```text
H_d
+
θ
```

rather than trusted as a mutable local balance.

---

## 3. Cryptographic ownership

Transfers require real Ed25519 signatures.

The signer public key must correspond to the claimed domain id:

```text
SHA-256(pubkey) == domainId
```

---

## 4. Replay protection

Nonce guards are used for signed submissions and transfers.

---

## 5. Content-addressed modules

A mutable URL cannot silently change the code behind an already-audited module registration.

The hash is authoritative.

---

## 6. Sandboxing

Third-party module code runs inside a sandboxed iframe without `allow-same-origin`.

---

## 7. Declarative contract conditions

Verification conditions are declarative.

The evaluator does not execute submitted code.

---

## 8. Immutable economic formulas

Registered formula identifiers cannot be rebound to different parameters.

---

## 9. Atomic consumption

A proof can only be consumed once:

```text
count(Consume(p)) <= 1
```

---

## 10. Honest network boundaries

The system does not pretend that an unavailable WebRTC signaling service or unavailable Solana RPC path is operational.

Unimplemented live infrastructure is clearly separated from tested local logic.

---

# Deliberately broken counterexamples

AIWA permanently keeps several broken implementations as tests.

They are intentionally excluded from production source directories and are never exported as usable code.

---

## Wall-clock materialization

Files:

```text
tests/counterexample-wallclock.test.mjs
rust-core/tests/counterexample_wallclock.rs
```

The broken implementation derives `q` from an injected wall clock instead of cadence state.

The same event set can then produce balances differing by roughly:

```text
100×
```

depending only on when materialization occurs.

This demonstrates why:

```text
time of computation
```

must not become:

```text
consensus state
```

---

## Non-atomic consume

Files:

```text
tests/counterexample-nonatomic-consume.test.mjs
rust-core/tests/counterexample_nonatomic_consume.rs
```

The broken version separates:

```text
check
```

from:

```text
commit
```

Two concurrent branches can both pass the check before either commits.

Both then create a destination claim.

That is the double-spend.

---

## Lemma 1 collision

`tests/lemma1.test.mjs` demonstrates that a weak identifier omitting `q` can collide two events with different rewards when cadence-sensitive `β` is non-zero.

The same identifier construction is safe under:

```text
β = 0
```

because the reward no longer depends on the omitted cadence variable in that case.

---

# Testing

Current test counts:

```text
415 JS tests
238 Rust tests
```

Rust breakdown:

```text
232 library tests
6 integration tests
```

Current stated result:

```text
zero warnings
```

for both language test suites.

---

# Running tests

## JavaScript

Install the test dependencies:

```bash
npm install
```

Then:

```bash
node --test tests/*.test.mjs
```

The application itself remains CDN-based; `package.json` dependencies are used for test/integration work such as:

```text
@solana/web3.js
@noble/curves
```

---

## Rust

From the Rust directory:

```bash
cd rust-core
cargo test
```

Native Rust tests do not require the `wasm32` target.

---

# Cross-language parity commands

From the repository root:

```bash
./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh
```

These scripts are also run by CI.

---

# Building Rust → WASM

Install the target:

```bash
rustup target add wasm32-unknown-unknown
```

Install `wasm-pack`:

```bash
cargo install wasm-pack
```

Then:

```bash
cd rust-core

wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core
```

The result is placed under:

```text
public/js/wasm/
```

---

# WASM backend selection

`ledger-bridge.js` is the sole backend selection point.

Conceptually:

```text
ledger-bridge
      │
      ├── WASM present
      │       │
      │       ▼
      │   Rust core
      │
      └── WASM absent
              │
              ▼
          JS core
```

`wasm-ledger-adapter.js` translates the raw `wasm-bindgen` API into the same interface exposed by the JS `EventDag`.

No other application code needs to care which backend is active.

---

# WASM CI

CI builds the WASM binary automatically and commits the resulting binary.

The deployed browser has already been confirmed to load the WASM binary with:

```text
zero browser load errors
```

What remains open is a live side-by-side browser comparison of:

```text
WASM-backed results
vs.
JS-backed results
```

under the deployed application.

---

# Running the application

AIWA is intentionally deployable as a static site.

The production application is the:

```text
public/
```

directory.

There is no application build pipeline required to serve it.

A static server can serve the directory directly.

---

# Deploying to GitHub Pages

One-time GitHub configuration:

```text
Repository
  → Settings
  → Pages
  → Source
  → GitHub Actions
```

Then:

```text
.github/workflows/deploy-pages.yml
```

deploys `public/` on every push to `main`.

The deployed site is therefore served as the same static application represented in the repository.

---

# CI/CD

The repository contains three primary workflows.

## `ci.yml`

Runs:

- Rust tests,
- JS tests,
- parity scripts,
- WASM build,
- associated validation.

It also automatically commits the WASM binary.

---

## `deploy-pages.yml`

Deploys:

```text
public/
```

to GitHub Pages whenever the main branch is updated.

---

## `update-github-trends.yml`

Runs daily.

It:

1. queries GitHub's public repository search API,
2. generates `github-trends.json`,
3. commits the data.

The main CI workflow ignores these automated trend-only commits through its configured path filtering.

---

# Whitepaper

The protocol specification is maintained in:

```text
docs/AIWA_whitepaper_v1_2_revised.md
```

The implementation and whitepaper are intentionally kept synchronized.

When implementation work discovers:

- a bug,
- a missing invariant,
- a model gap,
- a cross-language divergence,
- a protocol ambiguity,

the finding is added at the relevant point in the whitepaper.

It is not merely appended as an isolated changelog note.

---

# Claim-Evidence-Assumption Matrix

The whitepaper's:

```text
§17 Claim-Evidence-Assumption Matrix
```

tracks the evidence status of major protocol claims.

This is intended to distinguish:

```text
implemented
tested
conditionally supported
still open
```

rather than treating every feature as equally proven.

---

# Current status

The implementation currently has:

```text
┌───────────────────────────────────────────────┐
│ JS reference ledger             Production    │
│ Rust ledger                     Implemented   │
│ JS/Rust event-id parity         Verified      │
│ G parity                        Verified      │
│ Conservation parity             Verified      │
│ Submission signature parity     Verified      │
│ Pool draw parity                Verified      │
│ IndexedDB persistence           Implemented   │
│ Ed25519 transfers               Implemented   │
│ Module hash verification        Implemented   │
│ iframe module sandbox            Implemented   │
│ Generic contracts               Implemented   │
│ Declarative verifier             Implemented   │
│ Solana identity integration      Implemented*  │
│ WebLLM integration               Implemented*  │
│ WebRTC mesh                      Open           │
│ WASM browser side-by-side parity Open           │
└───────────────────────────────────────────────┘
```

`*` means the implementation exists but the relevant live environment is not fully exercised in the current development environment.

---

# Closed / dampened / open protocol items

The whitepaper currently identifies:

### Closed

```text
R11 — cadence integrity / VDF
R19 — module sandbox isolation
```

---

### Dampened

```text
Identity churn
```

The current cost curve makes churn more expensive but does not claim to make it impossible.

---

### Open

```text
WASM live-results comparison
AI authoritative layer
numeric / floating-point consensus semantics
protocol versioning
formal conformance test vectors
```

---

# Numeric semantics

One important consensus item remains open:

```text
numeric / float semantics
```

The current JS and Rust implementations have been made to agree over the tested vectors.

That is not the same thing as having a complete cross-platform numerical consensus specification.

For a production protocol, this should eventually define:

- numeric representation,
- rounding,
- overflow behavior,
- underflow behavior,
- transcendental function requirements,
- platform independence.

This is deliberately tracked rather than silently assumed.

---

# Protocol versioning

Protocol versioning is another explicit open item.

A production deployment needs an unambiguous mechanism for determining:

```text
which protocol rules
```

apply to:

```text
which event history
```

especially across long-lived partitions and later reconciliation.

The current implementation documents the issue rather than pretending that versioning is already completely solved.

---

# Formal conformance suite

The current parity scripts are strong regression tools.

A future formal conformance suite should elevate them into a versioned protocol artifact containing:

- canonical event vectors,
- expected event ids,
- expected topological orders,
- expected materialized states,
- expected rejected events,
- expected signatures,
- expected condition results,
- expected numerical outputs.

This would allow independent implementations to prove interoperability against the same protocol corpus.

---

# What is deliberately NOT claimed

AIWA does not claim that every layer is equally mature.

In particular:

### It is not a true asymmetric VDF

The cadence proof uses sequential hashing.

Verification recomputes the chain.

---

### Devnet SOL is not real Sybil resistance

The UI explicitly warns about this.

---

### Identity churn is not fully solved

The mechanism is a damping mechanism.

---

### WebRTC is not currently a live production mesh

The signaling infrastructure is not shipped.

---

### WebLLM is not a consensus authority

The AI layer produces suggestions.

---

### GitHub trends are not network truth

They are labeled external inspiration.

---

### Browser WebGPU testing is environment-dependent

The code path is real, but it requires a browser runtime with WebGPU support.

---

### Float parity is not a complete numerical specification

The tested implementations agree on current vectors, but numerical consensus semantics remain an open protocol item.

---

# Design principles

AIWA follows several principles consistently.

## 1. State is derived from history

Prefer:

```text
A = G(H_d, θ)
```

over:

```text
mutable authoritative A
```

---

## 2. Causality beats wall-clock time

Use explicit cadence events.

Do not let computation time accidentally become consensus time.

---

## 3. Reconciliation is set union

Prefer:

```text
merge(H_A, H_B)
```

over bespoke synchronization logic.

---

## 4. Security checks must be load-bearing

A security rule should be backed by an invariant or cryptographic proof, not merely by a UI convention.

---

## 5. Third-party code must be isolated by execution context

Do not ask untrusted code to behave.

Put it inside a sandbox.

---

## 6. Hash the bytes

Module identity is tied to the exact code bytes, not to a mutable URL.

---

## 7. Immutable definitions stay immutable

Formula parameters and contract conditions are fixed at registration/mint time.

---

## 8. Do not execute declarative security rules as code

The causal evaluator only interprets known primitives.

---

## 9. Separate local UX from protocol state

Desktop ordering, themes, and presentation choices must not silently alter causal state.

---

## 10. AI is advisory by default

The idea agent can suggest.

It cannot silently become consensus.

---

## 11. Do not fake unavailable infrastructure

If real signaling, RPC, or browser capabilities are unavailable, the implementation says so.

---

## 12. Cross-language behavior is part of the protocol

JS and Rust are not two unrelated implementations.

They are expected to agree on the same causal semantics.

---

# Implementation map

For a quick orientation:

| Area | Main implementation |
|---|---|
| Event DAG | `public/js/core/event-dag.js` |
| Persistence | `public/js/core/event-dag-persistence.js` |
| Backend selection | `public/js/core/ledger-bridge.js` |
| WASM adapter | `public/js/core/wasm-ledger-adapter.js` |
| Domain ID | `public/js/core/domain-id.js` |
| Materialization | `public/js/core/economics/g.js` |
| Cadence | `public/js/core/economics/cadence.js` |
| Cadence VDF | `public/js/core/economics/cadence-vdf.js` |
| Reward | `public/js/core/economics/reward.js` |
| Scarcity | `public/js/core/economics/scarcity.js` |
| Formula registry | `public/js/core/economics/formula-registry-reducer.js` |
| Conservation | `public/js/core/conservation/conservation.js` |
| Conservation bridge | `public/js/core/conservation/conservation-bridge.js` |
| Identity cost | `public/js/core/identity/identity-cost.js` |
| Identity DAG reducer | `public/js/core/identity/identity-cost-reducer.js` |
| Solana wallet | `public/js/core/identity/solana-wallet.js` |
| Solana RPC | `public/js/core/identity/solana-rpc.js` |
| Identity flow | `public/js/core/identity/identity-flow.js` |
| Module hash | `public/js/core/modules/module-hash.js` |
| Module registry | `public/js/core/modules/module-registry.js` |
| Module replication | `public/js/core/modules/module-registry-reducer.js` |
| Module rank | `public/js/core/modules/module-rank.js` |
| Signed submission | `public/js/core/modules/module-submission.js` |
| Module fetch | `public/js/core/modules/module-fetch.js` |
| Module loader | `public/js/core/modules/module-loader.js` |
| Module sandbox | `public/js/core/modules/module-sandbox.js` |
| Transport | `public/js/core/transport/transport.js` |
| Delay-tolerant transport | `public/js/core/transport/delay-tolerant-transport.js` |
| Connection watchdog | `public/js/core/transport/connection-watchdog.js` |
| Pool | `public/js/core/pool/pool-reducer.js` |
| Contract evaluator | `public/js/core/verification/causal-condition-evaluator.js` |
| Generic contracts | `public/js/core/contracts/generic-contract-reducer.js` |
| Themes | `public/js/core/presentation/theme-tokens.js` |
| Desktop | `public/js/core/desktop/desktop-layout.js` |
| Idea agent | `public/js/core/ai/idea-agent.js` |
| WebLLM | `public/js/core/ai/webllm-engine.js` |
| Pattern miner | `public/js/core/ai/module-pattern-miner.js` |
| Hyperprofile | `public/js/core/ai/public-profile-reducer.js` |

---

# Quick-start

```bash
# Clone
git clone <repository-url>

# Enter the project
cd AIWA

# Install test dependencies
npm install

# Run JS tests
node --test tests/*.test.mjs

# Run Rust tests
cd rust-core
cargo test
cd ..

# Run parity checks
./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh
```

For WASM:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

cd rust-core
wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core
```

Then serve the repository's `public/` directory through a static web server.

---

# Final architecture summary

The shortest accurate description of AIWA is:

```text
┌────────────────────────────────────────────────────────────┐
│                         AIWA                               │
│                                                            │
│  Event history                                             │
│      H_d                                                   │
│       │                                                    │
│       │ content-addressed events                           │
│       │ deterministic merge                                │
│       ▼                                                    │
│  ┌─────────────────────────────────────┐                   │
│  │ Deterministic topological replay    │                   │
│  └────────────────┬────────────────────┘                   │
│                   │                                        │
│                   ▼                                        │
│             A = G(H_d, θ)                                  │
│                   │                                        │
│       ┌───────────┼───────────┬───────────┐                │
│       ▼           ▼           ▼           ▼                │
│   Economics   Conservation Identity    Modules             │
│       │           │           │           │                │
│       └───────────┴───────────┴───────────┘                │
│                           │                                 │
│                           ▼                                 │
│                  Materialized application                  │
│                           │                                 │
│             ┌─────────────┴──────────────┐                 │
│             ▼                            ▼                 │
│        Local browser                 Reconciliation         │
│             │                            │                 │
│             ▼                            ▼                 │
│       IndexedDB                    Delay-tolerant           │
│                                    transport               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

The implementation intentionally keeps the boundaries visible:

```text
history ≠ state
state ≠ UI
identity ≠ display label
URL ≠ module identity
AI suggestion ≠ consensus
transport ≠ causal merge
economic issuance ≠ conservation
JS implementation ≠ protocol definition
```

That separation is the central architectural property of AIWA.

---

# License

See the repository's license file for the authoritative licensing terms.

---

# Status vocabulary

Throughout the project and whitepaper:

| Label | Meaning |
|---|---|
| **Proved** | Backed by a demonstrated invariant, formal reasoning, or cryptographic property |
| **Tested** | Implemented and covered by executable tests |
| **Conditional** | Valid under explicitly stated assumptions |
| **Open** | Known unresolved protocol or implementation issue |

These labels are intended to make the boundary between implementation, evidence, and assumption visible.

---

> **AIWA is a reference implementation, not a claim that every component is production-hardened. Its purpose is to make the architecture executable, testable, inspectable, and honest about what has and has not been established.**
