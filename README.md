# AIWA — Autonomous Interplanetary Web Application

> **A reference implementation and research platform for autonomous, delay-tolerant web applications that continue to operate during communication partitions and reconcile deterministic histories when connectivity returns.**


AIWA is a research and development project. It is deliberately **not** presented as a solved interplanetary consensus protocol, a proof-of-human identity system, a true asymmetric VDF, or a complete browser security proof.

Its purpose is narrower and more useful:

> **Make the difficult parts of a partition-tolerant application explicit, executable, testable, and auditable.**

The project separates replicated history, deterministic state materialization, economics, conservation, identity, transport, third-party modules, contracts, presentation, and AI assistance so that each can be analyzed without silently treating one layer as another.

---

## Table of Contents

- **PART I — PURPOSE, POSITIONING AND CONCEPTUAL MODEL**
  - [1. The central idea](#1-the-central-idea)
  - [The question AIWA explores](#the-question-aiwa-explores)
  - [Position relative to existing systems](#position-relative-to-existing-systems)
  - [2. What AIWA actually claims](#2-what-aiwa-actually-claims)
  - [3. The conceptual framework](#3-the-conceptual-framework)
- **PART II — REPOSITORY AND CORE ARCHITECTURE**
  - [4. Repository structure](#4-repository-structure)
  - [5. Core architecture](#5-core-architecture)
  - [6. Event DAG](#6-event-dag)
  - [7. Materialization: `A = G(H_d, θ)`](#7-materialization-a--ghd-)
- **PART III — ECONOMICS, CADENCE AND SCARCITY**
  - [8. Economics](#8-economics)
  - [9. Cadence](#9-cadence)
  - [10. Cadence VDF / sequential hash chain](#10-cadence-vdf--sequential-hash-chain)
  - [11. Reception cadence](#11-reception-cadence) · [12. Formula registry](#12-formula-registry)
  - [13. Scarcity and autonomous issuance](#13-scarcity-and-autonomous-issuance)
  - [14. Sybil resistance](#14-sybil-resistance)
- **PART IV — IDENTITY, CONSERVATION AND VALUE FLOW**
  - [15. Identity](#15-identity)
  - [16. Conservation](#16-conservation)
- **PART V — NETWORK, TRANSPORT AND EXTENSIBILITY**
  - [17. Transport](#17-transport)
  - [18. WebRTC](#18-webrtc)
  - [19. Modules](#19-modules)
  - [20. Module ranking](#20-module-ranking)
  - [21. Sandbox](#21-sandbox)
  - [22. Module API](#22-module-api)
- **PART VI — CAUSAL APPLICATION PRIMITIVES**
  - [23. Causal verification](#23-causal-verification)
  - [24. Generic contracts](#24-generic-contracts)
  - [25. Pools](#25-pools)
- **PART VII — APPLICATION LAYERS AND IMPLEMENTATIONS**
  - [26. Presentation](#26-presentation)
  - [27. Desktop](#27-desktop)
  - [28. Hyperprofile](#28-hyperprofile)
  - [29. AI assistance](#29-ai-assistance)
  - [30. GitHub trends](#30-github-trends)
  - [31. Rust and WASM](#31-rust-and-wasm)
  - [32. Cross-language parity](#32-cross-language-parity)
- **PART VIII — FAILURE MODES AND SECURITY**
  - [33. Counterexamples](#33-counterexamples)
  - [34. Threat model](#34-threat-model)
  - [35. Security boundaries](#35-security-boundaries)
  - [36. What remains unresolved](#36-what-remains-unresolved)
  - [37. Adversarial test matrix](#37-adversarial-test-matrix)
- **PART IX — OPERATIONS, BUILD AND DEPLOYMENT**
  - [38. Running tests](#38-running-tests)
  - [39. Building Rust → WASM](#39-building-rust--wasm)
  - [40. GitHub Pages deployment](#40-github-pages-deployment)
  - [41. Participation](#41-participation)
- **PART X — CONCLUSION AND RESEARCH DIRECTION**
  - [42. Bottom line](#42-bottom-line)
  - [Forkability beyond open source](#forkability-beyond-open-source)
  - [From decentralization to global interoperability](#from-decentralization-to-global-interoperability)
  - [Programmable applications](#programmable-applications)

---

# PART I — PURPOSE, POSITIONING AND CONCEPTUAL MODEL

## 1. The central idea

A continuously synchronized client/server application usually assumes:

```text
client → network → server → authoritative state
```

AIWA starts from a different assumption:

```text
                 communication unavailable
                           │
                           ▼
                 ┌───────────────────┐
                 │   local domain    │
                 │                   │
                 │    H_d (history)  │
                 │         │         │
                 │         ▼         │
                 │    G(H_d, θ)      │
                 │         │         │
                 │         ▼         │
                 │   local state     │
                 └───────────────────┘
                           │
                    transmission
                           │
                           ▼
                 ┌───────────────────┐
                 │ reconciliation /  │
                 │      merge        │
                 └───────────────────┘
```

The important design choice is:

> **Non-synchronization is the normal operating condition. Synchronization is a transmission and reconciliation mode.**

This does not mean that synchronization is unimportant. It means that the application is not defined as "correct only while synchronized."

That distinction is particularly relevant to delay-tolerant and interplanetary scenarios, where communication delay and outages are properties of the environment rather than exceptional software failures.

## The question AIWA explores

Most distributed applications assume that a shared state must remain synchronized to remain authoritative.

AIWA starts from a different assumption:

> **What if synchronization is a mode of information exchange rather than a prerequisite for operation?**

A domain can continue operating from its local history during a communication partition. When another history becomes observable, histories can be exchanged, merged, and deterministically materialized.

This leads to the broader research question:

> **Can a programmable application become globally interoperable without requiring continuous global coordination?**

AIWA does not claim to have solved this question. It provides an executable architecture in which the hypothesis can be made concrete and tested.

```text
partition
   ↓
local history
   ↓
local operation
   ↓
history exchange
   ↓
reconciliation
   ↓
deterministic materialization
   ↓
protocol state
```

Here, **global** does not mean merely international. It means that the application protocol is not inherently tied to one server, one operator, one network, one terminal, or one implementation.

---

## Position relative to existing systems

AIWA does not claim to invent distributed histories, CRDTs, peer-to-peer networking, content addressing, cryptographic identity, or programmable contracts individually. Those areas have substantial prior art.

The research question is whether these mechanisms can be composed around one explicit application-protocol boundary.

```text
Automerge       → distributed / local-first data
Yjs             → replicated collaborative data
IPFS            → content-addressed distributed data
ActivityPub     → federated communication
Urbit           → persistent identity + autonomous network
Ethereum        → globally coordinated programmable state

AIWA            → distributed, deterministic, programmable
                  application state under partition
```

This comparison is architectural, not a claim that AIWA replaces these systems. The distinctive hypothesis is that history, state derivation, authority, causal constraints, conservation rules, and programmable logic can be made explicit enough to remain independently reproducible across disconnected environments and independently operated implementations.

---

# 2. What AIWA actually claims

AIWA makes several concrete claims about its **reference implementation**:

- local event history is represented as a content-addressed DAG;
- event insertion is idempotent;
- merge is set union;
- canonical materialization order is explicitly specified;
- the economic view is derived from history rather than replicated as an authoritative balance;
- cadence is protocol-derived rather than advanced directly from wall-clock time;
- the reference reward formula and scarcity policies are executable;
- conservation is separated from issuance;
- transfer authorization uses real Ed25519 signatures and binds the signer to the domain identifier;
- module code is content-addressed and hash-verified before mounting;
- untrusted module code executes inside a sandboxed iframe boundary;
- contracts can express declarative causal conditions without executing submitted condition code;
- transport has a delay-tolerant queueing backend;
- JS and Rust implementations are checked against shared vectors and parity scripts;
- deliberately broken variants are retained as counterexamples;
- AI assistance has no authoritative path into consensus or economic validity.

AIWA **does not** claim that these mechanisms, individually or collectively, prove:

- Byzantine consensus;
- semantic correctness of every concurrent reconciliation;
- proof of human identity;
- physical truth;
- a true asymmetric verifiable delay function;
- universal Sybil resistance;
- complete browser isolation against every browser or resource-exhaustion attack;
- globally synchronized economic time;
- safe deployment parameters for every environment.

Those distinctions are part of the design.

---

# 3. The conceptual framework

The project uses three research concepts. They are deliberately separated from protocol mechanisms already implemented.

## 3.1 Asynchrony

The operational assumption is:

```text
partition
   ↓
local execution continues
   ↓
events accumulate locally
   ↓
communication becomes available
   ↓
histories are exchanged
   ↓
merge / reconciliation
   ↓
deterministic materialization
```

The system therefore does not require a permanently shared clock or permanently shared state to continue local operation.

## 3.2 Finality as a semantic spectrum

The term **finality spectrum** is used as a research model, not as a physical frequency.

A domain has a cryptographic identity:

```text
domainId = SHA-256(publicKey)
```

The research hypothesis is that distributed applications can also be described by the **purpose-space** in which their state is meaningful.

The "silence" between two purposes is a semantic boundary:

```text
purpose A        boundary / silence        purpose B

███████████               ···               ███████████
```

Here, "silence" means:

> **this domain does not claim this semantic purpose as part of its own state or authority.**

It does **not** mean:

- the data does not exist;
- no other domain knows it;
- the state is globally absent;
- the state is invalid.

The current protocol does not use this concept as a consensus primitive. It is a framework for future formalization.

## 3.3 Intention and impatience

AIWA also uses **intention** as a research axis.

A measurable economic system can observe actions and commitments:

```text
patience ───────────────────────────── impatience
   │                                       │
   │                                       │
lower action pressure              higher action pressure
```

The term **impatience** refers to observable economic behaviour such as:

- accepting a cost to obtain a result sooner;
- increasing action frequency;
- committing capital earlier;
- paying identity or computational cost to advance;
- repeatedly attempting an action while waiting for reconciliation.

It is **not** a claim that the protocol can read a person's psychological intention.

```text
observed behaviour ≠ direct access to mental intention
economic commitment ≠ proof of motive
```

The research question is whether such observable quantities can be formalized as useful economic variables without overstating what they mean.

## 3.4 Three independent dimensions

```text
                 SEMANTIC PURPOSE
                       ▲
                       │
                       │
                       └──────────────► ECONOMIC PRESSURE
                      /
                     /
                    ▼
               OBSERVABILITY
```

Operationally:

| Dimension | Question |
|---|---|
| Purpose / finality | What semantic domain does this history describe? |
| Intention / pressure | What measurable economic pressure is associated with action? |
| Transmission / observability | When can another domain learn the history? |

Only the third is a concrete network mechanism in the current implementation. The first two are partially represented by existing protocol objects and otherwise remain research directions.

---

# 4. Repository structure

```text
AIWA/
├── public/
│   ├── index.html
│   ├── css/
│   │   └── aiwa.css
│   ├── data/
│   │   └── github-trends.json
│   └── js/
│       ├── app/
│       │   └── main.js
│       └── core/
│           ├── event-dag.js
│           ├── event-dag-persistence.js
│           ├── ledger-bridge.js
│           ├── wasm-ledger-adapter.js
│           ├── causal-condition-evaluator.js
│           ├── generic-contract-reducer.js
│           ├── economics/
│           │   ├── cadence.js
│           │   ├── cadence-vdf.js
│           │   ├── reward.js
│           │   ├── scarcity.js
│           │   ├── g.js
│           │   └── formula-registry-reducer.js
│           ├── conservation/
│           │   ├── conservation.js
│           │   └── conservation-bridge.js
│           ├── identity/
│           │   ├── domain-id.js
│           │   ├── identity-cost.js
│           │   ├── identity-cost-reducer.js
│           │   ├── solana-networks.js
│           │   ├── solana-wallet.js
│           │   ├── solana-rpc.js
│           │   └── identity-flow.js
│           ├── modules/
│           │   ├── module-hash.js
│           │   ├── module-registry.js
│           │   ├── module-registry-reducer.js
│           │   ├── module-rank.js
│           │   ├── module-submission.js
│           │   ├── module-fetch.js
│           │   ├── module-loader.js
│           │   └── module-sandbox.js
│           ├── transport/
│           │   ├── transport.js
│           │   ├── delay-tolerant-transport.js
│           │   └── connection-watchdog.js
│           ├── pool/
│           │   └── pool-reducer.js
│           ├── profile/
│           │   └── public-profile-reducer.js
│           ├── presentation/
│           │   └── theme-tokens.js
│           ├── desktop/
│           │   └── desktop-layout.js
│           └── ai/
│               ├── idea-agent.js
│               ├── webllm-engine.js
│               └── module-pattern-miner.js
├── rust-core/
│   ├── src/
│   ├── examples/
│   └── tests/
├── tests/
├── test-vectors/
├── scripts/
├── examples/
│   └── jackpot-plugin/
├── docs/
│   └── AIWA_WHITEPAPER.md
├── package.json
└── .github/workflows/
    ├── ci.yml
    ├── deploy-pages.yml
    └── update-github-trends.yml
```

---

# 5. Core architecture

```text
                         H_d
                 content-addressed
                  event DAG / history
                         │
                         ▼
                 canonical topoOrder()
                         │
                         ▼
                    G(H_d, θ)
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
   Economics       Conservation       Contracts
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
                  materialized state

 Transport ─ Identity ─ Modules ─ Presentation ─ AI
       provide capabilities around the protocol boundary
```

The key separation is:

```text
replicated history       H_d
materialized state       A = G(H_d, θ)
protocol parameters      θ
```

A derived balance is therefore not itself the replicated source of truth.

---

# 6. Event DAG

`public/js/core/event-dag.js` is the production reference implementation.

Each event is content-addressed from canonicalized data and its parent identifiers.

Conceptually:

```text
event
 ├── domain
 ├── type
 ├── payload
 └── parent ids
        │
        ▼
     SHA-256
        │
        ▼
      event id
```

## 6.1 Canonical encoding

Canonical encoding is part of the protocol contract.

JS recursively sorts object keys before hashing so that the same logical structured value has the same bytes for the purpose of event identity.

This is necessary because:

```text
{a:1,b:2}
```

and

```text
{b:2,a:1}
```

must not receive different event identifiers merely because a runtime chose a different insertion order.

The Rust implementation uses matching canonical semantics.

## 6.2 Merge

Merge is set union:

```text
merge(H1, H2) = H1 ∪ H2
```

Therefore:

```text
H ∪ H = H
```

and duplicate delivery is idempotent.

This does not by itself solve semantic conflicts. It solves the replicated-history problem at the event-set level.

## 6.3 Canonical materialization order

A converged set still needs one normative ordering when a reducer is order-sensitive.

AIWA specifies:

> **id-sorted depth-first topological order**

The tie-break rule is part of the protocol contract.

Two implementations cannot merely both say "we use a deterministic topological sort." They must use the same deterministic ordering.

## 6.4 Persistence

`event-dag-persistence.js` stores `H_d` in IndexedDB.

The restored DAG is replayed through pure topological replay logic, and the real cadence tip is recovered from the DAG.

This matters because a browser reload must not silently reset the economic history to a fresh local tip.

---

# 7. Materialization: `A = G(H_d, θ)`

The ledger is not the balance.

The materialized state is:

```text
A = G(H_d, θ)
```

where:

- `H_d` is the accepted event history;
- `θ` is the protocol parameter set;
- `A` is derived application state.

A reducer therefore has the general shape:

```text
H_d
 │
 ├── genesis
 ├── cadence
 ├── accrual
 ├── identity-register
 ├── claim-issue
 ├── transfer
 ├── module-register
 ├── module-update
 ├── module-audit
 ├── pool-init
 ├── pool-contribute
 ├── pot-release
 └── other causal events
        │
        ▼
     topoOrder
        │
        ▼
     fold / G
        │
        ▼
   materialized state
```

The critical rule is that derived state must be reconstructible from the history under the specified semantics.

---

# 8. Economics

The reference reward function is:

```text
r(b, q, q_total, T)
=
(b · q^α)
/
[ ln(q_total^(β(1−T)) + C) ]^γ
```

Reference constants:

```text
α = 1.1
β = 2.2
γ = 3
C = 35937
```

The reference value:

```text
r(1, 100, 100, 0)
=
0.11844290947765648
```

is verified through direct calculation, replay through the real event DAG, and JS/Rust parity.

The implementation treats the formula as protocol data rather than as a mutable local preference.

---

# 9. Cadence

Economic time is based on a protocol-recognized cadence.

A cadence transition:

```text
q' = q + 1
```

is monotonic and replay-protected.

The important distinction is:

```text
wall clock
    │
    ├── UI
    ├── diagnostics
    └── transport timeout

cadence
    │
    └── economic state
```

The deliberately broken wall-clock implementation demonstrates why deriving economic state directly from wall-clock observation is unsafe: two executions of the same event set can otherwise produce different balances merely because they were evaluated at different physical times.

---

# 10. Cadence VDF / sequential hash chain

Every cadence transition carries a sequential SHA-256 computation:

```text
h0
 │
 ▼ SHA-256
h1
 │
 ▼ SHA-256
h2
 │
 ▼
...
 │
 ▼
hN
```

The seed incorporates the domain and the previous real cadence output.

The purpose is to make rapid fabrication of large numbers of structurally valid cadence transitions expensive.

## Important limitation

This is **not a true asymmetric VDF**.

Verification recomputes the sequential chain. Therefore:

- proving and verification have comparable computational character;
- difficulty depends on hardware;
- many identities can still perform work in parallel;
- it does not create a universal physical clock;
- it does not by itself establish a fixed rate of real-world time.

The correct description is:

> **a sequential computational rate-limiting mechanism for cadence advancement under the stated protocol rules.**

The reference default is approximately 200,000 iterations, with the exact duration depending on hardware.

---

# 11. Reception cadence

The cadence VDF (§10) bounds how fast a single domain can advance its own cadence. It says nothing about what a domain claims to have received from OTHER domains — a distinct, additional mechanism, not a refinement of the same one.

At every real cadence tick, a domain signs a commitment declaring either:

```text
empty   — nothing new received from any other domain since the last tick
full    — a real, explicit list of (source domain, event id) pairs newly observed
```

This commitment is mandatory, not optional — a real signed claim at every tick, whether or not there is anything to report. Two independent properties follow from this, neither present anywhere else in the protocol:

**Recurring cost.** Because cadence advancement already costs real, physically-irreducible sequential compute time (the VDF above), and a real commitment must now be signed at every one of those ticks, maintaining a Sybil cluster stops being a one-time registration cost and becomes an ongoing one: every fabricated identity must keep signing real commitments at every real tick, for as long as the fabrication needs to look legitimate.

**Reception monotonicity.** For a given pair of domains (A, C), A's own successive commitments about C — ordered by A's own real epoch — must reference a non-decreasing position in C's own real, independently-recomputed history. A domain claiming, later in its own real history, to have received an EARLIER state of another domain than it itself already claimed to have seen is a genuine internal inconsistency, catchable by pure recomputation: no external clock, no position, no propagation-delay bound.

Verification never trusts a claimed reference — every entry in a `full` commitment's list must resolve to a real event that genuinely exists in the claimed source domain's own real cadence chain, recomputed by walking the actual DAG, not assumed correct because it was signed.

Any real, correctly-attributed event of a domain is referenceable this way — including a domain's own identity-registration event, often its very first event, before any cadence tick has occurred. This needed no special first-contact rule: a real event with no cadence-epoch ancestors is that domain's own legitimate epoch-0 state, not an absence. An earlier version of this mechanism treated "no cadence ancestors found" the same as "does not exist," which would have rejected honest references to a domain's own earliest real history — found and corrected directly, not shipped.

### What this does not do

This does not prove that two domains are distinct real-world entities — that is identity cost's job, already separate. And it cannot, by construction, prevent a genuinely collaborating pair or cluster from fabricating a mutually-consistent reception history together from the start: a purely relational check, with no external anchor, can never rule that out. It catches an isolated liar whose own claims contradict each other or contradict an honest counterparty's real history — not collusion.

---

# 12. Formula registry

Reward parameters are registered immutably.

A `formula-register` event binds an identifier permanently to:

```text
(alpha, beta, gamma, C, minQ)
```

There is no update path for the same identifier.

`genesis` is the fixed protocol default and does not require a registration event.

This prevents two reconciled domains from interpreting the same economic event through silently different mutable parameters.

The current active formula selection is separate from the permanent existence of the formula object.

---

# 13. Scarcity and autonomous issuance

Autonomous issuance has a fundamental systems constraint.

If domains can independently issue forever, while partitions can last arbitrarily long and all issued value remains valid, then total issuance can grow without a finite global bound unless some scarce resource constrains it.

AIWA therefore treats scarcity as an explicit policy question.

Supported policy families include:

1. preallocated budgets;
2. rate limits;
3. expiring issuance rights;
4. scarce physical or computational resources;
5. external authority.

The reference implementation includes:

```text
applyIssuanceAttempt()
simulateHourlyIssuance()
```

and verifies the worked simulation values:

```text
unbounded:
I(1000h)  = 2000
I(10000h) = 20000

bounded example:
5000 + 5000 preallocated
→ saturates at 10000
```

The architecture does not claim that one scarcity policy is universally correct.

---

# 14. Sybil resistance

The reward formula alone is not a complete Sybil analysis.

For fixed total capital `B`, split across `N` identities:

```text
b = B / N
```

a simplified reward model gives:

```text
R_N ∝ B^α · N^(1−α)
```

For:

```text
α > 1
```

splitting fixed capital is economically unfavorable.

For:

```text
0 < α < 1
```

splitting can be attractive unless identity cost or another scarce resource limits it.

With fixed identity creation cost `c_id`:

```text
Profit(N)
=
K · B^α · t^β · N^(1−α)
− N · c_id
```

For `0 < α < 1`, the stationary optimum is:

```text
N*
=
[
K · B^α · t^β · (1−α)
/
c_id
]^(1/α)
```

This is an economic model, not a security proof.

The implementation also studies identity churn: abandoning an aging identity and creating a fresh one can be attractive if age-dependent reward effects are strong. A slot-scaled identity cost can damp this behaviour, but it does not distinguish an attacker from a legitimate late joiner.

---

# 15. Identity

AIWA's reference identity is:

```text
domainId = SHA-256(publicKey)
```

Identity registration uses a real Solana burn.

The burn establishes:

- a transaction record;
- a real cost;
- control of a signing key capable of authorizing the transaction.

It does **not** establish:

- a human being;
- uniqueness of a person;
- honesty;
- geographic location;
- exclusive real-world ownership.

The correct security interpretation is:

> **proof of externally recorded cost plus proof of control of the associated cryptographic identity.**

## Solana implementation

`solana-wallet.js` provides:

- real keypair generation;
- AES-256-GCM encryption using Web Crypto;
- transaction construction and signing;
- local encrypted persistence;
- no plaintext secret key in storage.

`solana-rpc.js` performs real network calls when configured.

Devnet is the default and is explicitly unsuitable as a real Sybil-cost environment because faucet SOL is not economically scarce in the same sense as mainnet SOL.

## Identity churn

The optional identity-cost curve can scale with the Solana slot at registration.

This is a damping mechanism, not proof that churn is impossible.

---

# 16. Conservation

Conservation is deliberately separated from issuance.

The state machine is:

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

The load-bearing invariant is:

```text
count(Consume(p)) ≤ 1
```

A transfer moves an existing claim.

It does not create monetary value.

## Economics bridge

`conservation-bridge.js` provides:

### `claim-issue`

- checks the domain's real accrued balance;
- respects rejected event ids;
- prevents issuing more than the amount actually accrued;
- creates a spendable claim.

### `transfer`

Requires:

- real Ed25519 signature;
- signature over the claim, source, destination, nonce and timestamp fields;
- verification against the signer public key;
- `SHA-256(signerPubkey) == from`;
- nonce replay protection.

A plain check such as:

```text
claim.owner == from
```

is not sufficient because a peer could otherwise declare another domain as its own source.

The Ed25519 verification dependency (`@noble/curves/ed25519`) is loaded via a lazy, cached dynamic import inside the functions that need it, not a static top-level import. A static import graph is fetched and linked before any of a module's own top-level code runs; if the CDN this dependency resolves through were ever unreachable, a static import would fail before `main.js`'s own startup code — including its own top-level error handling — ever executed, hanging the application with no catchable error. The dynamic import makes an unreachable CDN an ordinary, catchable rejected promise instead.

## Atomic consumption

The consumption guard must be atomic from the perspective of the state transition.

The deliberately broken non-atomic variant demonstrates the double-spend race:

```text
branch A: verify → pause
branch B: verify → consume
branch A: consume
```

The invariant is therefore not merely "the verifier rejects bad proofs." It is:

> **a valid proof can cause at most one successful consumption.**

---

# 17. Transport

The transport layer is an interface.

The ledger must not care whether delivery is:

- local;
- WebRTC;
- relay-mediated;
- store-and-forward;
- delay-tolerant;
- temporarily unavailable.

The delay-tolerant implementation queues messages before attempting delivery.

Properties:

- durable queue-then-attempt;
- FIFO per peer;
- no reordering inside a peer queue;
- stop on first failure;
- successful messages leave the queue;
- different peers have independent queues.

A watchdog detects stale connections and fires the stale callback exactly once per outage episode, then resets on reconnection.

## Reconciliation

The UI's Reconcile action goes through the transport interface rather than directly calling `dag.merge()`.

When connectivity is simulated as available, the actual merge is performed.

When it is unavailable, the message is queued.

This keeps the transport boundary real even in the single-browser demonstration.

---

# 18. WebRTC

A real WebRTC mesh backend requires signaling.

AIWA therefore keeps signaling infrastructure outside the core ledger abstraction.

The absence of a complete signaling service is not hidden behind a fabricated "connected" implementation.

The architecture supports:

```text
local / same-network
        │
        ▼
     WebRTC
        │
        ├── direct
        └── relay if required

long-haul / intermittent
        │
        ▼
delay-tolerant transport
```

Both ultimately deliver events to the same history layer.

---

# 19. Modules

Modules are third-party code.

The principle is:

> **Extensibility must not imply elevated trust.**

## Content addressing

A module is identified by a SHA-256 hash of its code.

A code update changes the hash and resets its audit state.

An existing module id can only be updated by its recorded author.

## Signed submission

The submission contains:

```text
moduleId
codeHash
codeUrl
nonce
timestamp
signature
```

The host:

1. fetches the code;
2. hashes the actual fetched bytes;
3. compares the result to the submitted hash;
4. verifies the signature;
5. checks replay protection;
6. applies registration or update.

The caller therefore cannot submit one hash while silently mounting another file.

Like `conservation-bridge.js`'s own transfer signing, the same Ed25519 dependency here is a lazy, cached dynamic import rather than a static top-level one, for the identical reason: a static import of an unreachable CDN dependency would silently hang the whole application before it ever started, with no catchable error.

## Registry replication

Module registration, update and audit are DAG events.

The registry is a materialized view over `H_d`.

It is therefore replicated through the same merge mechanism rather than being an isolated local database.

---

# 20. Module ranking

The rank is derived from the author's identity cost and cadence:

```text
rank = r(burnedLamports, elapsedEpochs, θ)
```

Submission eligibility includes a ratio-must-not-decline check modeled on the reference economic eligibility rule.

Rank is displayed in the domain catalog.

It does **not** determine the user's desktop arrangement.

This is intentional: ranking a module and deciding where a user pinned it are different semantics.

---

# 21. Sandbox

The reference module runner uses:

```html
<iframe sandbox="allow-scripts">
```

without:

```text
allow-same-origin
```

Module code is hash-verified before mounting.

The sandbox is therefore an execution boundary, not merely a social rule asking module authors to behave.

The host exposes a controlled `ctx` surface through `postMessage`.

The security model still has open browser-level questions, including:

- strict source and message validation;
- instance confusion;
- replayed messages;
- oversized payloads;
- prototype-pollution paths;
- navigation;
- network exfiltration;
- resource exhaustion;
- message spam;
- modules that never yield;
- storage exhaustion.

Therefore:

> **The sandbox is a concrete containment mechanism, not a complete proof that arbitrary browser code is harmless.**

---

# 22. Module API

The reference context includes:

```text
ctx.storage.get(key)
ctx.storage.set(key, value)

ctx.toast(message)

ctx.commit(b)
ctx.claim()

ctx.postCausalEvent(type, payload)
ctx.queryCausalState(contractId)

ctx.share(key, value)

ctx.sendToPeer(domainId, message)
ctx.onPeerMessage(handler)

ctx.theme
```

The host forces the real caller domain into causal events.

The module does not receive the private identity key.

Peer messaging is real-time and is not automatically inserted into `H_d`.

A message is delivered only when the target module is currently mounted.

---

# 23. Causal verification

AIWA provides six declarative primitives:

```text
ownership
signature
count
deterministic-match
unique
causal-order
```

They can be composed with:

```text
AND
OR
NOT
```

The evaluator never executes submitted code.

This is important because a third-party contract should describe a condition rather than submit an arbitrary verifier program to the consensus boundary.

---

# 24. Generic contracts

### JavaScript smart contracts

AIWA exposes its programmable contract layer through the JavaScript application environment. This is not presented as a claim that JavaScript is a novel smart-contract language. The point is that application developers can express protocol-level contract conditions in the same broad language environment as the reference web application, while the contract boundary remains constrained by deterministic evaluation and the declarative causal-condition model.

The protocol does not treat arbitrary submitted JavaScript as an authority-bearing verifier. The existing causal evaluator operates on explicit conditions and protocol-visible state.

A contract can be minted with a verification condition.

The condition is fixed at mint time.

A later release contains only:

```text
claimId
from
to
contractId
```

The release cannot replace the condition.

This prevents a release operation from smuggling in a weaker condition.

A real example is a 2-of-2 escrow represented as a `count` condition over approval events.

The contract mechanism is independent of the pool reducer.

**Known scope difference, not a security gap:** the JS reducer validates a condition's structural shape less strictly than Rust at mint time — a malformed condition (an unknown primitive type, a missing required field) can be accepted by JS's own `generic-contract-init` handler where Rust's own parser would reject it outright. This is safe in practice because it is caught at the other end regardless: the shared evaluator (`causal-condition-evaluator.js` / `causal_condition_evaluator.rs`) rejects an unrecognized or malformed condition at evaluation time in both languages identically, so a contract minted with a malformed condition in JS can never actually release anything — it is permanently, harmlessly inert, not exploitable.

---

# 25. Pools

The pool primitive supports:

```text
pool-init
pool-contribute
pot-release
```

The pot address intentionally has no keypair.

No participant should need a private key representing the pool in order to make an authorized release.

Weighted draws are deterministic from:

```text
poolId
cycleIndex
contributions
```

JS and Rust produce matching:

- winner;
- total amount;
- full 64-character draw hash.

---

# 26. Presentation

The presentation layer is not part of consensus.

Themes:

```text
default
compact
```

Both use the same token keys.

`themeToCssVariables()` generates a real CSS variable block.

Compact mode is designed for bandwidth- or hardware-constrained nodes.

The design system uses:

- dark base;
- amber accent;
- IBM Plex typography;
- hairline borders;
- minimal decoration;
- explicit proof-status vocabulary.

---

# 27. Desktop

Desktop arrangement is pure, DOM-free logic.

Supported operations:

- reorder;
- fold into folder;
- merge into existing folder;
- eject;
- remove.

Rank is calculated and displayed but does not reorder the user's pins.

Storage migration from older flat pin structures is handled transparently.

Corrupt layout data degrades to an empty state rather than crashing the application.

---

# 28. Hyperprofile

The public profile reducer is a DAG-replicated key/value view.

```text
ctx.share(key, value)
```

publishes a value.

```text
ctx.share(key, null)
```

retracts it.

Latest-write-wins semantics apply according to the protocol's event ordering.

A Contact can therefore inspect information a domain has genuinely published rather than a profile reconstructed from local UI state.

---

# 29. AI assistance

AIWA's AI layer is intentionally non-authoritative.

The idea agent can use:

- local desktop pins;
- local module registrations;
- public profile data;
- recency-weighted network categories;
- category gaps;
- overlap across multiple distinct contacts;
- GitHub repository trends explicitly marked as external inspiration;
- local module-pattern usage.

The agent produces suggestions — text a human reads, never code. Module-pattern mining deliberately stops at frequency data (which real `ctx` primitives existing modules use, and which are never used at all) rather than producing code skeletons or templates; code generation is an explicit, repeatedly-confirmed non-goal of this project's AI layer, not an oversight.

It does not:

- write consensus state;
- validate protocol events;
- mint money;
- sign transfers;
- determine contract validity;
- publish code automatically.

This is a structural property:

```text
AI
 │
 ▼
suggestion
 │
 ▼
human/application layer

NOT:

AI → consensus
AI → economic validity
AI → identity
```

## WebLLM

`webllm-engine.js` uses WebGPU and a dedicated Worker for local streaming inference.

The browser execution path is real code but is not fully testable under the Node/Rust test environment.

---

# 30. GitHub trends

The daily trend file is generated through the official GitHub public repository search API.

The workflow:

```text
scheduled GitHub Action
        │
        ▼
repository search
        │
        ▼
github-trends.json
        │
        ▼
browser fetch
        │
        ▼
idea-agent context
```

The trend data is explicitly external to AIWA's network.

It must never be interpreted as AIWA network activity.

---

# 31. Rust and WASM

The Rust implementation mirrors the protocol logic.

`ledger-bridge.js` selects:

```text
WASM if available
      │
      └── otherwise JS
```

`wasm-ledger-adapter.js` translates the raw WASM API into the JS EventDag interface.

The production application therefore has one ledger interface and two interchangeable implementations.

The current remaining validation item is a live side-by-side browser comparison of WASM-backed and JS-backed materialization results.

---

# 32. Cross-language parity

Parity is checked for:

| Layer | Verification |
|---|---|
| Event identifiers | shared ID vectors |
| `G` | shared scenario vectors |
| Conservation | shared scenario vectors |
| Module signatures | JS → Rust and Rust → JS |
| Pool draws | cross-language draw hash |

The parity principle is:

> **Independent implementations must reproduce the protocol result, not merely implement similar algorithms.**

Numeric semantics, protocol versioning, and a formal conformance suite remain open areas.

---

# 33. Counterexamples

AIWA retains deliberately broken variants.

## Wall-clock materialization

A broken implementation derives economic time from wall-clock observation.

Expected failure:

```text
same H_d
+
different evaluation time
=
different balance
```

This violates deterministic materialization.

## Non-atomic consumption

A broken implementation separates verification and consumption.

Expected failure:

```text
two concurrent branches
→ both observe "unused"
→ both consume
→ double spend
```

## Weak identity

If an identity omits an economic variable that changes reward meaning, two distinct events can collapse into one identity class.

The general condition is:

```text
id(e1) = id(e2)
```

is safe only when:

```text
G({e1}, θ) = G({e2}, θ)
```

for all events that can be merged under that identity.

---

# 34. Threat model

The principal adversaries are:

- replay attacker;
- duplicate-merge attacker;
- history rewriter;
- event fabricator;
- Sybil attacker;
- patient-capital attacker;
- cadence / computation attacker;
- clock attacker;
- transport attacker;
- malicious module;
- malicious contract author;
- forged transfer signer;
- stale or unavailable external RPC.

Each threat must be analyzed against a specific invariant.

A test that passes does not establish a universal guarantee.

The preferred test structure is:

```text
attacker capability
        ↓
security invariant
        ↓
expected rejection / state
        ↓
JS test
        ↓
Rust test
        ↓
parity / regression test
```

---

# 35. Security boundaries

AIWA distinguishes:

### Deterministic history

Protects against inconsistent representation of the same event set.

### Signature authorization

Protects against a party claiming control of another domain.

### Conservation

Protects against multiple successful consumption of one claim.

### Contract immutability

Protects against changing a condition at release time.

### Content addressing

Protects against silently changing code behind a registered hash.

### Sandbox

Limits the execution context of third-party code.

### External identity cost

Makes identity creation economically observable.

### Reception consistency

Protects against a domain later claiming, at its own real cadence epoch, to have received an earlier state of another domain than it itself already claimed to have seen — checked by pure recomputation of successive signed commitments, with no external clock, no position, no propagation-delay bound. Does not, and cannot by construction, prove that two domains are distinct real-world entities, or prevent a genuinely collaborating pair from fabricating a mutually-consistent history together — a purely relational check with no external anchor can never rule that out.

None of these properties automatically implies the others.

---

# 36. What remains unresolved

The major open questions are:

1. **Semantic convergence under adversarial concurrency.** Deterministic ordering is not itself a Byzantine consensus proof.
2. **Economic bounds under arbitrary partition duration.** The selected scarcity policy must actually impose the desired bound.
3. **Cadence rate under heterogeneous hardware and many identities.**
4. **External-chain finality and RPC assumptions.**
5. **Browser sandbox and resource-exhaustion analysis.**
6. **Numeric / floating-point semantics across implementations.**
7. **Protocol version negotiation.**
8. **Formal conformance vectors.**
9. **Fuzzing and model checking of causal reducers.**
10. **Quantitative calibration of identity cost and Sybil economics.**
11. **Formalization of the finality / intention research vocabulary.**
12. **Live WASM-vs-JS browser equivalence.**
13. **Collusion in reception commitments.** Reception consistency (§35) catches a domain whose own claims contradict each other, or contradict a genuinely independent counterparty's real history. It does not, and structurally cannot, catch a pair or cluster that fabricates a mutually-consistent reception history together from the start — no purely relational check, with no external anchor, can rule that out.

These are not hidden defects in the documentation. They are the research boundary.

---

# 37. Adversarial test matrix

| Attack | Property sought |
|---|---|
| Concurrent double spend | ≤ 1 consumption |
| Replay | idempotence |
| Forged domain | signature + domain binding |
| Fork + reconciliation | deterministic result |
| Malicious branch | semantic safety under stated model |
| Conflicting cadence | monotonicity |
| VDF reuse | proof cannot be reused incorrectly |
| Identity churn | cost curve behaves as specified |
| Fake Solana proof | rejection |
| Stale RPC | explicit failure semantics |
| Malicious plugin | no unauthorized host access |
| Forged `postMessage` | message rejection |
| Message replay | no unintended repeated effect |
| Code swap | hash mismatch |
| Malicious contract condition | fixed mint condition |
| Release condition smuggling | supplied condition ignored |
| Numeric edge case | JS/Rust equality |
| Float/platform difference | protocol-defined semantics |
| Huge event DAG | bounded resource behaviour |

---

# 38. Running tests

```bash
npm install
node --test tests/*.test.mjs

cd rust-core
cargo test

cd ..
bash scripts/verify-parity.sh
bash scripts/verify-g-parity.sh
bash scripts/verify-conservation-parity.sh
bash scripts/verify-submission-parity.sh
bash scripts/verify-pool-parity.sh
```

Current reference counts:

```text
416 JS tests
238 Rust tests
0 compiler warnings in the reported reference run
```

Test counts are evidence about the checked implementation, not proof of complete security.

---

# 39. Building Rust → WASM

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

cd rust-core
wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core
```

CI builds the binary automatically.

---

# 40. GitHub Pages deployment

Configure GitHub Pages to use GitHub Actions.

The deployment workflow serves `public/` directly.

The application itself has no server dependency and no application build step.

---

# 41. Participation

AIWA is intentionally open to technical criticism.

The most valuable contributions are not merely new features. They are:

- counterexamples;
- invariant violations;
- adversarial tests;
- formalizations;
- parity failures;
- independent implementations;
- browser-security analysis;
- economic simulations;
- protocol-versioning proposals;
- falsification of the finality/intention hypotheses.

A useful contribution should state:

```text
claim
assumptions
attacker capabilities
invariant
experiment
result
residual limitation
```

The project is most credible when it makes it easy to demonstrate that it is wrong.

---


## Forkability beyond open source

Open source makes software copyable. AIWA uses **forkability** in a stronger protocol sense.

```text
open source
     ↓
forkable code
     ↓
independent implementation
     ↓
protocol conformance
     ↓
potential interoperability
```

A fork may change its interface, transport, modules, economics, or even protocol rules. Forkability does not require every fork to remain compatible.

The stronger research target is that the **public protocol boundary** be explicit enough for a compatible independent implementation to reproduce protocol-relevant behaviour without treating the original implementation or operator as an authority.

For AIWA, that boundary includes event identity, canonical encoding and ordering, signatures, deterministic materialization, causal verification, conservation, numeric semantics, versioning, and conformance vectors.

> **Forkability makes independent implementations possible; conformance establishes compatibility; interoperability is the property to be demonstrated.**

## From decentralization to global interoperability

Decentralization asks where control is located. AIWA explores a broader question: whether an application can remain meaningful across different locations, operators, networks, terminals, implementations, and forks.

```text
decentralization
       ↓
independent operation
       ↓
partition tolerance
       ↓
forkability
       ↓
independent implementations
       ↓
public protocol semantics
       ↓
conformance
       ↓
potential interoperability
       ↓
global application space
```

In this sense, **globalization** is not a geographic claim. It is a protocol property under investigation: the ability for an application space to extend across independently operated environments without requiring a single permanent authority or continuous global synchronization.

This remains a research direction, not a claim of automatic universal interoperability.

---

# 42. Bottom line

AIWA is best understood as:

> **a research implementation for distributed applications in which disconnection is normal, local histories remain usable during partition, synchronization is a mode of transmission rather than a permanent prerequisite, and derived state is reconstructed from an explicit causal history.**

Its strongest result is not the claim that interplanetary consensus has been solved.

Its strongest result is that a substantial portion of the problem can be made concrete:

```text
history
  ↓
canonical identity
  ↓
merge
  ↓
deterministic materialization
  ↓
economic policy
  ↓
conservation
  ↓
identity
  ↓
contracts
  ↓
modules
  ↓
transport
  ↓
presentation / AI
```

Each layer has explicit boundaries, tests, and known limitations.

The remaining questions are therefore research questions that can be attacked directly rather than assumptions hidden inside an application.
