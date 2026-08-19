AIWA — Autonomous Interplanetary Web Application

«A browser-native, delay-tolerant application architecture built around a content-addressed event DAG, deterministic materialized state, cryptographic identity, composable contracts, and sandboxed third-party modules.»

AIWA is a reference implementation of an architecture in which application state is derived from an event DAG:

H_d = event DAG
A   = G(H_d, θ)

The authoritative state of a domain is not stored as a mutable database row. It is materialized by replaying a deterministic set of events.

The application is designed to continue operating while disconnected, exchange events when connectivity returns, and converge on a deterministic materialized view from the same event set.

AIWA is intentionally implemented as a static web application:

- no application server;
- no build step required for production JavaScript;
- no authoritative backend database;
- local persistence through IndexedDB;
- optional Rust/WASM acceleration;
- real cryptographic signatures;
- real Solana identity-cost transactions;
- delay-tolerant transport abstraction;
- sandboxed third-party modules.

The current implementation is a reference implementation and research prototype, not a claim of production-grade consensus or formal security.

Several important properties are tested extensively. Others remain explicitly open, particularly:

- full adversarial convergence analysis;
- numeric/float consensus semantics;
- protocol versioning;
- formal conformance vectors;
- live JS/WASM result comparison in the browser;
- stronger guarantees around the cadence VDF;
- the limits of the plugin sandbox;
- the security implications of external-chain identity registration;
- an authoritative AI layer.

The project deliberately distinguishes between what is implemented, what is tested, what is conditional, and what remains open.

---

Table of Contents

- "Why AIWA exists" (#why-aiwa-exists)
- "Security position" (#security-position)
- "Core model" (#core-model)
- "Architecture" (#architecture)
- "Repository structure" (#repository-structure)
- "Ledger — Event DAG" (#ledger--event-dag)
- "Materialization — "A = G(H_d, θ)"" (#materialization--a--gh_d-θ)
- "Economics" (#economics)
- "Cadence and VDF" (#cadence-and-vdf)
- "Reward function" (#reward-function)
- "Scarcity" (#scarcity)
- "Formula registry" (#formula-registry)
- "Sybil and identity economics" (#sybil-and-identity-economics)
- "Conservation" (#conservation)
- "Identity and "c_id"" (#identity-and-c_id)
- "Solana integration" (#solana-integration)
- "Third-party modules" (#third-party-modules)
- "Module registry" (#module-registry)
- "Module signing" (#module-signing)
- "Module sandbox" (#module-sandbox)
- "Module "ctx" API" (#module-ctx-api)
- "Transport" (#transport)
- "Pools" (#pools)
- "Composable verification" (#composable-verification)
- "Generic contracts" (#generic-contracts)
- "Presentation and desktop" (#presentation-and-desktop)
- "AI idea agent" (#ai-idea-agent)
- "Hyperprofile" (#hyperprofile)
- "Cross-language parity" (#cross-language-parity)
- "Adversarial counterexamples" (#adversarial-counterexamples)
- "Threat model" (#threat-model)
- "Security invariants" (#security-invariants)
- "What is actually guaranteed" (#what-is-actually-guaranteed)
- "What is not guaranteed" (#what-is-not-guaranteed)
- "Testing" (#testing)
- "Building Rust/WASM" (#building-rustwasm)
- "Deploying" (#deploying)
- "Whitepaper" (#whitepaper)
- "Known limitations and open work" (#known-limitations-and-open-work)
- "Design principles" (#design-principles)
- "Status" (#status)

---

Why AIWA exists

AIWA explores a simple question:

«Can a useful application continue to function as a deterministic, locally materialized system while participants are disconnected for arbitrary periods, without relying on a permanently available central server?»

The design treats the application as two related layers.

1. History

The history is an event DAG:

H_d

Events are content-addressed and linked to parent events.

2. State

Application state is a materialized function of history:

A = G(H_d, θ)

where:

- "H_d" is the domain's event DAG;
- "G" is the deterministic materialization function;
- "θ" is the immutable protocol/formula parameter set.

This distinction matters.

A mutable state variable can silently diverge between replicas.

A deterministic materialized view can instead be reconstructed from the same history.

The architectural goal is therefore:

events
   ↓
content-addressed DAG
   ↓
canonical topological ordering
   ↓
deterministic reducers
   ↓
materialized state
   ↓
UI / modules / AI

The system does not assume that every peer is online simultaneously.

---

Security position

AIWA is intentionally conservative about security claims.

The project contains substantial cryptographic and adversarial testing, but:

«A deterministic event DAG is not by itself a consensus protocol.»

Canonical ordering makes the materialized result deterministic for a given converged event set.

It does not automatically prove:

- that all honest peers will receive the same events;
- that malicious peers cannot manufacture conflicting valid events;
- that every economic race has a semantically correct resolution;
- that the external identity mechanism is equivalent to proof of personhood;
- that browser sandboxing eliminates every possible resource-exhaustion or messaging attack.

Those distinctions are part of the project's specification.

AIWA therefore separates the status of properties into four categories:

Proven / tested

The implementation has an explicit test or parity check supporting the property.

Conditional

The property depends on an explicit assumption, injected verifier, deployment parameter, external chain, or environment.

Architectural

The property follows from the way the system is structured but still requires adversarial validation at larger scale.

Open

The project does not currently claim the property.

The goal is not to hide these boundaries.

The goal is to make them auditable.

---

Core model

A domain owns an event DAG:

H_d = {e_1, e_2, ..., e_n}

Every event contains:

- its canonical payload;
- parent event identifiers;
- event type;
- relevant domain information;
- signatures where required.

Event IDs are content-addressed:

eventId = SHA-256(canonical(event payload + parents))

The same logical event therefore has the same identifier across implementations.

Merging is set union:

merge(H_a, H_b) = H_a ∪ H_b

This gives the ledger an important property:

merge(merge(A, B), B) = merge(A, B)

Re-adding an event that is already known does not produce another event.

State is then derived by canonical replay:

A = G(H_d, θ)

The materialization order is part of the protocol:

«id-sorted depth-first topological ordering.»

It is not an implementation convenience.

Two implementations must use the same ordering rule or they can disagree about the result of a concurrent event set even if both are internally deterministic.

---

Architecture

AIWA is divided into several layers.

┌──────────────────────────────────────────────┐
│                  Presentation                 │
│        desktop / themes / UI / plugins        │
├──────────────────────────────────────────────┤
│                    AI layer                   │
│       idea agent / local pattern mining      │
├──────────────────────────────────────────────┤
│                  Domain state                 │
│ economics / conservation / identity / pools  │
│              contracts / profiles             │
├──────────────────────────────────────────────┤
│              Deterministic reducers           │
│                    G(H_d, θ)                  │
├──────────────────────────────────────────────┤
│                 Event DAG / Ledger             │
│        content-addressed immutable events     │
├──────────────────────────────────────────────┤
│                  Transport                    │
│       queue / delay tolerance / WebRTC        │
├──────────────────────────────────────────────┤
│             External identity layer           │
│               Solana / future chains          │
└──────────────────────────────────────────────┘

The ledger itself has two interchangeable implementations.

JavaScript reference ledger

public/js/core/event-dag.js

Pure JavaScript.

Zero runtime dependencies.

This is the currently available production implementation.

Rust/WASM ledger

rust-core/

Rust implementation compiled to WebAssembly.

The Rust implementation is intended to provide:

- performance;
- a stronger module boundary;
- a second independent implementation;
- cross-language parity verification.

Single backend entry point

public/js/core/ledger-bridge.js

This is the only backend selector.

It:

1. loads WASM when available;
2. falls back to JavaScript when WASM is unavailable;
3. exposes the same logical ledger interface.

Other application code should not care which implementation is active.

---

Repository structure

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
│   ├── examples/
│   │   ├── check_id_parity
│   │   ├── check_g_parity
│   │   ├── check_conservation_parity
│   │   ├── sign_submission_rust
│   │   └── verify_submission_from_js
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

---

Ledger — Event DAG

The ledger is a content-addressed DAG of events.

Each event ID is derived from:

SHA-256(
    canonicalized event payload
    + canonicalized parent identifiers
)

Object keys are recursively canonicalized before hashing.

This is required because:

JSON.stringify(...)

and Rust's JSON serialization do not automatically guarantee identical key ordering.

The JavaScript implementation therefore sorts object keys recursively so that the result matches the Rust implementation.

The parity suite includes:

- flat payloads;
- nested payloads;
- arrays;
- unsorted parents;
- different logical key insertion orders.

The current test vector contains six ID-parity cases.

All six match.

---

Merge semantics

"merge()" is set union.

Adding an already-known event has no effect.

This gives the event set a natural idempotence property.

"subscribe()" only fires for genuinely new events:

- "addEvent()" with a new event → notification;
- "merge()" containing new events → notification;
- re-adding known events → no notification.

---

Persistence

"event-dag-persistence.js" persists the DAG in IndexedDB.

The goal is that:

browser closes
      ↓
browser reopens
      ↓
H_d restored
      ↓
materialized state reconstructed

The persistence layer does not treat the materialized state as authoritative.

The DAG remains the source of truth.

Replay ordering is implemented separately as pure logic:

topologicalSortForReplay()

The restore path verifies that its output can be replayed through a real "EventDag" without violating unknown-parent constraints.

"restoreTipsFromDag()" then reconstructs the domain's actual cadence tip.

This matters because simply restoring a cached tip could cause a new cadence event to accidentally chain from stale local state.

---

Domain identity

A domain identifier is derived from its public key:

domainId = SHA-256(publicKey)

The resulting identifier is represented as 64 hexadecimal characters.

The full identifier is used for cryptographic verification.

Short labels are presentation-only.

A display helper such as:

shortDomainLabel()

must never replace the complete domain ID inside a signature or ownership check.

This prevents a class of bugs where a truncated visual identifier accidentally becomes a security identifier.

---

Materialization — "A = G(H_d, θ)"

The authoritative application state is produced by folding the event DAG:

A = G(H_d, θ)

The current economics implementation recognizes three primary event types:

genesis
cadence
accrual

"genesis"

Initializes a domain.

"cadence"

Advances the domain's monotonic epoch state.

"accrual"

Computes a reward using the cadence state that exists at the point where the event is folded.

The materializer therefore does not use:

- wall-clock time;
- the time at which a browser happens to replay the event;
- the current global network height.

The state must come from the event history.

---

Economics

AIWA's economics layer is derived from the reward model inherited and adapted from YourMine.

The current implementation uses:

r(b, q, q_total, T)
=
(b · q^α)
/
[ln(q_total^(β(1−T)) + C)]^γ

Reference constants:

α = 1.1
β = 2.2
γ = 3
C = 35937

A reference evaluation is:

r(1, 100, 100, 0)
=
0.11844290947765648

This value is confirmed through:

1. direct JavaScript evaluation;
2. full cadence replay through a real "EventDag";
3. cross-language JS/Rust parity.

---

Cadence

Cadence is a domain-local monotonic epoch counter.

It is intentionally not derived from a global chain height.

Every domain has its own cadence:

q_d

This prevents the economics layer from requiring every domain to remain synchronized with a shared global clock.

Cadence transitions are:

- monotonic;
- replay-protected;
- bounded to "+1";
- required to contain a cadence VDF proof.

The deployment may define a minimum number of epochs required before a claim becomes eligible.

The original minimum-slot concept is represented as:

minQ

---

Cadence and VDF

Every cadence transition must contain a sequential SHA-256 proof.

The construction is:

h_i = SHA-256(h_{i-1})

The seed incorporates:

- the domain;
- the previous epoch;
- the previous real VDF output.

Therefore epoch "N" cannot simply invent an independent proof without first knowing the result of epoch "N-1".

The implementation verifies the chain by recomputing it.

The default iteration count is:

200,000

This is approximately 240 ms on typical hardware, but the actual cost is hardware-dependent.

Important limitation

This is not a traditional asymmetric VDF.

Verification costs essentially the same sequential work as generation.

The project does not claim otherwise.

The current construction is best understood as a computational rate-limiting mechanism intended to make the production of large numbers of structurally valid cadence transitions expensive in wall-clock computation time.

It does not provide:

- hardware-independent elapsed-time measurement;
- asymmetric proof verification;
- perfect resistance to high-performance hardware;
- a proof that computation corresponds to real-world time.

The iteration count is configurable in the Parameters UI.

A more rigorous quantitative analysis of attacker throughput remains future work.

---

Reward function

The reward function is exposed in:

public/js/core/economics/reward.js

and mirrored in:

rust-core/src/economics/reward/

The implementation intentionally keeps the mathematical function separate from:

- cadence;
- scarcity;
- identity cost;
- conservation;
- UI.

This makes it possible to test the formula independently and to bind it to immutable formula identifiers.

---

Scarcity

"scarcity.js" implements a preallocated-budget policy.

The central operation is:

applyIssuanceAttempt()

which clamps an otherwise valid reward to the remaining issuance budget.

The simulation helper:

simulateHourlyIssuance()

reproduces the paper's issuance scenarios.

The current implementation has been checked against the whitepaper's worked numbers:

I(1000h)  = 2000
I(10000h) = 20000

for the unbounded control case.

Under a:

5000 + 5000

preallocated budget, issuance saturates at:

10000

Conservation and issuance remain separate:

G → creates value
Conservation → moves/converts existing value

---

Formula registry

Reward parameters cannot silently change once registered.

A:

formula-register

event permanently binds a formula ID to:

(alpha, beta, gamma, C, minQ)

There is intentionally no update operation.

Reusing the same formula ID with different parameters is rejected.

The protocol's default:

genesis

formula is fixed and does not require a registration event or identity burn.

This avoids a bootstrapping paradox in which the protocol would need a formula-registration event before it could even know how to evaluate that event.

A domain's choice of currently active formula is separate from formula existence.

This distinction is important:

formula exists
≠
domain currently uses formula

Without this separation, two domains could silently interpret the same accrual event under different parameter sets.

---

Sybil and identity economics

The current reward formula contains a linear "b" term.

Before identity cost, splitting a fixed amount of capital across multiple identities is therefore reward-neutral.

Under a positive identity cost:

c_id > 0

the current analysis finds:

N* = 1

as the optimal number of identities for capital splitting.

Identity churn is a separate attack.

An attacker might abandon an aging domain and create a new one to avoid the age-decay component of the reward function.

The implementation models this and finds that the fresh identity can be advantageous near genesis, but that the crossover occurs within a small number of simulated rounds as the deployment matures.

The identity-cost curve can therefore scale the cost of new registrations with chain slot.

This mitigation is:

- configurable;
- off by default;
- a damping mechanism rather than a proof that identity churn is impossible.

It also does not distinguish a legitimate late joiner from an attacker.

That tradeoff is intentional and documented.

---

Conservation

The conservation layer manages value that already exists.

It does not mint new value.

Its state machine is:

Deactivate
    ↓
Prove
    ↓
Verify
    ↓
Consume
    ↓
Activate

These are individually callable operations rather than a single opaque operation.

The key conservation invariant is:

count(Consume(p)) ≤ 1

This prevents one proof from being consumed twice.

A transfer is represented as a transmutation whose derivation function is:

identityDerivation

---

Conservation bridge

"conservation-bridge.js" connects conservation to economics.

"claim-issue"

A claim can only be issued from an actual balance produced by "G".

The bridge:

- checks the materialized economics state;
- checks rejected event IDs;
- prevents issuing more than has actually accrued;
- creates the spendable claim.

"transfer"

A transfer requires:

- the full conservation pipeline;
- a real Ed25519 signature;
- the claim ID;
- source domain;
- destination domain;
- nonce;
- timestamp.

The signature is verified against the supplied public key.

The system then checks:

SHA-256(signerPubkey) == from

This prevents a peer from simply declaring:

from = victimDomain

while signing with an unrelated attacker key.

A replay guard prevents reuse of the same nonce.

An explicit attacker-key test confirms that attempting to transfer another domain's claim is rejected and leaves the victim's claim unchanged.

---

Pot release

"pot-release" is different.

It does not accept an arbitrary caller signature as sufficient authorization.

Instead, the caller supplies a verifier.

The release is accepted only if the injected verifier confirms that the release corresponds to the deterministic contract condition.

The verifier is injected rather than hard-coded so that the contract layer remains composable.

---

Identity and "c_id"

AIWA uses an explicit identity cost.

The current implementation uses Solana.

Before partition, while connectivity is available, a domain can burn SOL to the Solana incinerator address.

The transaction signature becomes the domain's identity-cost proof.

The economic idea is:

identity registration
        ↓
irreversible external cost
        ↓
identity-register event
        ↓
replicated through H_d

The cost is sunk immediately.

This is deliberately different from a bonded stake model that would require enforcement during an arbitrarily long network partition.

---

Identity registration

The identity layer is implemented as:

identity-cost.js
identity-cost-reducer.js
solana-networks.js
solana-wallet.js
solana-rpc.js
identity-flow.js

The core verification layer operates on a chain-independent shape:

NormalizedBurnTx

A second blockchain can therefore be integrated by implementing:

xxx-wallet.js
xxx-rpc.js

without rewriting:

identity-cost.js

---

Identity registration is not proof of personhood

This distinction is fundamental.

A Solana burn demonstrates that:

- a key controlled the transaction;
- that key incurred the required external cost.

It does not demonstrate:

- that the key belongs to a unique human;
- that the operator is a legal person;
- that one human cannot operate multiple identities.

AIWA's current identity mechanism is therefore better described as:

«proof of control + proof of economic cost»

rather than proof of human identity.

---

Identity churn resistance

The optional cost curve uses the Solana confirmation slot.

The required burn for a new registration can increase monotonically with the slot at which the previous burn was confirmed.

This creates a deployment-relative economic pressure against repeatedly abandoning old identities.

The mechanism does not solve identity churn completely.

It is explicitly a mitigation.

---

Solana wallet security

The wallet layer uses:

- real Ed25519 keypairs;
- AES-256-GCM encryption;
- Web Crypto;
- encrypted persistence.

Plaintext secret keys are not written to persistent storage.

The implementation has been tested against the actual Solana web3 libraries.

A real signature can be generated, serialized, deserialized, and verified.

---

Solana network modes

The application exposes:

devnet
mainnet

Devnet is the default.

The UI explicitly warns that faucet SOL does not provide meaningful real-world Sybil resistance.

Mainnet operations are irreversible economic operations and therefore sit behind explicit confirmation.

The RPC integration is real code using real "fetch()" calls.

However, the current development environment has not exercised the live RPC path because it has no network access.

That limitation is intentional and documented rather than hidden behind a fake successful implementation.

---

Third-party modules

AIWA permits open module registration.

There is no allow-list.

There is no centralized approval step.

The platform mechanically rejects:

- duplicate module IDs;
- invalid economic declarations for issuing modules;
- inconsistent signed submissions;
- code whose fetched bytes do not match its registered hash;
- unauthorized updates.

Auditing is a separate future mechanism.

A module is not trusted merely because it is registered.

---

Content-addressed modules

Each module is bound to a SHA-256 code hash.

The module identity therefore refers to:

module ID
+
exact code hash

rather than merely:

mutable URL

This matters because a mutable URL could otherwise silently change the code after an audit.

If the code changes:

audit status → unaudited

The old verdict does not automatically transfer to the new bytes.

---

Module registry

The registry provides:

registerModule()
updateModuleCode()
auditModule()

For issuing modules, the economic declaration is validated against the actual reward function.

The declared identity scheme is derived from the declaration:

strong
weak
non-issuing

The UI presents this as a labeled status rather than treating the label itself as a security proof.

---

Registry replication

Module registry state is itself a materialized view over the event DAG.

Events include:

module-register
module-update
module-audit

When domains reconcile:

merge()
    ↓
H_d
    ↓
module-registry-reducer
    ↓
registry state

A module registered on one domain can therefore propagate to other reconciled domains without a centralized registry database.

---

Module rank

Module ranking uses the author's economic state.

The sort key is derived from:

r(burnedLamports, elapsedEpochs, θ)

Submission eligibility includes a ratio-must-not-decline check modeled on the reference "checkScoreEligibility" behavior.

The rank layer exposes:

rankFromIdentityAndCadence()

which composes identity and cadence materialized state.

Rank is displayed in the domain catalog.

It does not control desktop layout order.

This is intentional.

A renderer must not silently reorder user-managed desktop items whenever the computed economic rank changes.

---

Signed module submissions

Module submissions contain:

moduleId
codeHash
codeUrl
nonce
timestamp
signature

The submission path:

1. fetches the actual module code;
2. computes its hash;
3. verifies the hash against the submitted hash;
4. verifies the Ed25519 signature;
5. checks the nonce/replay guard;
6. verifies author permissions;
7. registers or updates the module.

The economic gate does not control publishing.

Signing provides:

- attribution;
- integrity;
- authorization.

It is not itself an economic ranking mechanism.

Cross-language submission parity verifies both directions:

JS signs → Rust verifies
Rust signs → JS verifies

Each parity run uses freshly generated keypairs.

---

Module sandbox

Third-party code runs inside:

<iframe sandbox="allow-scripts">

without:

allow-same-origin

The module therefore does not execute directly inside the host application's JavaScript context.

The host exposes the module API through "postMessage".

The module does not receive a direct reference to the host's internal application objects.

Before mounting:

fetch code
    ↓
SHA-256
    ↓
compare registered hash
    ↓
mount only if identical

A code/hash mismatch blocks mounting.

The close button cleanly unmounts the module.

---

Sandbox security boundary

The sandbox is an isolation mechanism, not a claim that arbitrary third-party code is harmless.

Important security surfaces include:

- "postMessage" validation;
- message origin/source validation;
- replayed messages;
- malicious payloads;
- resource exhaustion;
- network behavior;
- storage abuse;
- event spam;
- module lifecycle;
- communication between module instances.

The current implementation establishes a strong browser execution boundary, but a complete adversarial sandbox audit remains future work.

---

Module "ctx" API

Modules receive a constrained context.

Storage

ctx.storage.get(key)
ctx.storage.set(key, value)

Storage is scoped to:

(domain, moduleId)

Notifications

ctx.toast(message)

The notification is logged through the application event system.

Economics

ctx.commit(b)
ctx.claim()

Modules can interact with the economic layer through the host-controlled API.

Causal events

ctx.postCausalEvent(type, payload)

The host forces the actual caller's domain ID onto the event.

A module cannot simply declare itself to be another domain.

Causal state

ctx.queryCausalState(contractId)

Hyperprofile

ctx.share(key, value)

"null" retracts a previously published value.

Peer communication

ctx.sendToPeer(domainId, message)
ctx.onPeerMessage(handler)

Messages are routed through the transport layer.

Theme

ctx.theme

contains the active theme as parseable JSON.

The same theme values are also exposed as CSS custom properties.

---

Transport

The transport layer is deliberately independent from the ledger.

transport.js

defines the interface.

"assertImplementsTransport()" verifies that a backend actually implements the required methods and fails loudly if it does not.

---

Delay-tolerant transport

"delay-tolerant-transport.js" provides durable queue-then-attempt semantics.

Before network transmission:

message
   ↓
durable queue
   ↓
network attempt

Per-peer FIFO order is preserved.

If the first message fails:

message 1 → failure
message 2 → wait
message 3 → wait

Different peers have independent queues.

A successfully delivered message is removed from the queue.

It is not left permanently marked as queued.

---

Connection watchdog

"connection-watchdog.js" detects stale connections.

The watchdog:

- fires the stale callback once per stale episode;
- does not repeatedly fire while the connection remains stale;
- resets after reconnection;
- handles the exact timeout boundary explicitly.

An injected clock makes the behavior deterministic and testable.

---

WebRTC

The intended future transport is a WebRTC mesh.

The current repository contains an explicit stub rather than a fake implementation.

Real signaling infrastructure is not available in the development environment.

The project deliberately does not pretend that an unconnected placeholder is a functional peer-to-peer network.

---

Reconciliation

The UI's Reconcile action goes through:

transport.send()

rather than directly calling:

dag.merge()

When the simulated local link is up, the message can result in a real DAG merge.

When the link is down:

transport
    ↓
durable queue

The UI exposes:

- per-contact connectivity;
- queue depth;
- flush controls.

This makes the delay-tolerant behavior observable rather than purely theoretical.

---

Pools

The pool reducer is a general-purpose pooling primitive.

Events include:

pool-init
pool-contribute
pot-release

A pool creates a pot address without a corresponding keypair.

This is intentional.

No individual party should be able to move pooled funds merely because the application represents the pot with an address.

Pool payouts are verified using the causal-condition evaluator.

---

Weighted draws

The jackpot example uses deterministic weighted draws.

The draw is derived from:

poolId
cycleIndex
contributions

Both JavaScript and Rust produce identical:

winnerDomain
totalAmount
drawHash

The full 64-character draw hash is pinned in a regression test.

---

Composable verification

"causal-condition-evaluator.js" provides a declarative verification language.

The six primitives are:

ownership
signature
count
deterministic-match
unique
causal-order

They can be composed with:

AND
OR
NOT

The evaluator never executes submitted code.

Conditions are data.

For example, a contract can express:

COUNT(approvals) >= 2

without executing arbitrary JavaScript supplied by the contract creator.

---

Why this evaluator exists

Before introducing the evaluator, several reducers contained hand-written security checks.

The evaluator extracts these recurring causal concepts into a shared primitive layer.

The pool reducer was migrated to the evaluator.

The existing pool test suite continued to pass unchanged.

This is intended to demonstrate that the evaluator is a composable verification abstraction rather than a second independent policy engine.

---

Generic contracts

"generic-contract-reducer.js" allows third parties to define contracts without modifying platform code.

The crucial security rule is:

«A contract condition is fixed at mint time.»

The mint event chooses:

condition

That condition becomes immutable for the lifetime of the contract.

A release event contains only:

claimId
from
to
contractId

It cannot supply a new condition.

This prevents a malicious release from doing:

release(condition = true)

when the actual contract was minted with:

condition = false

The implementation explicitly tests condition smuggling.

An injected release-time condition is ignored.

The original minted condition is the one evaluated.

---

Example contract: 2-of-2 escrow

The repository includes a real example of a threshold-release escrow.

The contract is expressed using the generic condition system.

It uses:

count

over real approval events.

It does not share implementation code with the pool reducer.

This demonstrates that the generic contract layer can express application-specific rules without modifying the core protocol.

---

Jackpot example

The repository includes:

examples/jackpot-plugin/jackpot.js

The plugin demonstrates a real application built from the AIWA primitives.

The jackpot is:

- funded through AIWA;
- represented through the pool system;
- released through deterministic conditions.

The pool-address prefix:

jackpot-pot:<poolId>

is intentionally preserved.

Renaming implementation files must not silently change identifiers already present in live event history.

Historical identifiers are protocol data.

They are not refactoring details.

---

Presentation

The presentation layer provides two themes:

default
compact

The themes use the same token key set.

The compact theme is designed for:

- bandwidth-constrained nodes;
- hardware-constrained environments;
- maximum contrast;
- reduced secondary visual information.

"themeToCssVariables()" generates an actual CSS ":root {}" block.

Changing the active theme is deliberately narrow:

activeThemeId = ...

The presentation selector has one state side effect and does not modify application state elsewhere.

---

Design system

The current visual system uses:

dark base
amber accent
IBM Plex Mono
IBM Plex Sans
hairline borders
near-zero border radius
no shadows
no gradients

Semantic green/red states are reserved for proof/status semantics.

The vocabulary:

Proved
Tested
Conditional
Open

is treated as a real UI primitive.

The goal is to make the epistemic status of a mechanism visible rather than presenting every feature as equally proven.

---

Desktop

"desktop-layout.js" is deliberately DOM-free.

It implements:

- reorder;
- fold two icons into a folder;
- merge into an existing folder;
- eject;
- remove.

The desktop layout remains user-controlled.

Economic rank is computed and displayed but does not reorder desktop items.

This avoids a subtle state-loss bug where a renderer could overwrite user layout every time materialized state was refreshed.

Storage migration supports older flat pin-list formats.

Corrupt storage degrades to an empty layout instead of crashing the application.

---

AI idea agent

The AI layer is intentionally non-authoritative.

The idea agent consumes context from:

- local desktop pins;
- published module information;
- local hyperprofile data;
- recent network module categories;
- category gaps;
- multi-contact overlap;
- GitHub trends;
- module primitive usage.

It produces:

suggestions

It does not produce authoritative protocol events.

It does not write consensus state.

It does not decide economic validity.

It does not participate in ledger convergence.

---

Idea context

The agent considers the most recently registered third of the known network when computing trending categories.

This prevents stale historical activity from permanently dominating current suggestions.

Multi-contact overlap requires:

2+ distinct contacts

registering modules in a category.

Two modules from one contact do not count as multi-contact evidence.

Category gaps identify areas present in the network but missing locally.

---

GitHub trends

The repository contains:

public/data/github-trends.json

generated by:

scripts/fetch-github-trends.mjs

The GitHub Action runs daily.

It uses GitHub's public repository search API.

The data is:

- clearly labeled as external;
- used for inspiration only;
- not treated as AIWA network activity;
- not inserted into fields representing authoritative network state.

The application loads it lazily and caches it.

Rendering never blocks on the external trends request.

Freshness is represented honestly because the data can be stale.

---

Module pattern miner

"module-pattern-miner.js" examines verified local module code.

It uses the same hash-verifying loader used for mounting.

It looks for actual usage of:

storage
postCausalEvent
share
sendToPeer
...

The analysis is bounded to 20 modules.

The result is cached and non-blocking.

Unused primitives become idea-agent signals:

nobody in the current local registry appears to be using X

The agent does not receive generated code skeletons.

The rendered prompt intentionally avoids representing these observations as code templates.

---

WebLLM engine

"webllm-engine.js" uses:

- WebGPU detection;
- a dedicated Worker;
- "@mlc-ai/web-llm";
- streaming inference.

The engine is intended to run locally in the browser.

The current environment cannot execute the browser/WebGPU path, so this component is marked accordingly.

---

Hyperprofile

The public profile system is itself a DAG-replicated materialized view.

The API is:

ctx.share(key, value)

and:

ctx.share(key, null)

for retraction.

The reducer uses latest-write-wins semantics.

Profiles therefore propagate through:

H_d

rather than through a centralized profile database.

The Contacts UI can inspect what another domain's modules have genuinely published.

---

Peer messaging

Modules can communicate in real time through:

ctx.sendToPeer(domainId, message)

and:

ctx.onPeerMessage(handler)

The message is routed through the transport layer.

Delivery occurs only if the target module is currently mounted.

There is deliberately no inbound queue for module messages.

Real-time module messages do not automatically cause a DAG merge.

The host distinguishes the declared message type before deciding whether the message represents:

- ephemeral communication;
- causal ledger data.

This prevents a real-time UI message from silently becoming consensus state.

---

Cross-language parity

AIWA maintains two independent implementations of important protocol logic:

JavaScript
Rust

The goal is not merely performance.

A second implementation can expose assumptions that would remain invisible in a single implementation.

Current parity coverage includes:

Layer| Verification
Event IDs| JS/Rust test vectors
"G" materialization| JS/Rust scenario vectors
Conservation| JS/Rust scenario vectors
Module signatures| JS ↔ Rust both directions
Pool weighted draw| Rust regression parity
Formula behavior| shared expected values

---

Event ID parity

Script:

./scripts/verify-parity.sh

Vector:

test-vectors/id-parity.json

The test covers canonicalization cases where JavaScript and Rust could otherwise serialize equivalent objects differently.

---

"G" parity

Script:

./scripts/verify-g-parity.sh

Vector:

test-vectors/g-scenario.json

The same event history is materialized through both implementations.

The resulting state is compared.

---

Conservation parity

Script:

./scripts/verify-conservation-parity.sh

Vector:

test-vectors/conservation-scenario.json

This verifies that the JS and Rust conservation implementations agree on the same causal state transitions.

---

Submission parity

Script:

./scripts/verify-submission-parity.sh

Two directions are tested:

JS signs → Rust verifies
Rust signs → JS verifies

Fresh keypairs are generated during each run.

This prevents the parity test from depending on a permanently embedded test key.

---

Adversarial counterexamples

AIWA deliberately keeps broken implementations as tests.

They are not production features.

They exist to demonstrate why particular protocol rules exist.

---

Wall-clock counterexample

Files:

tests/counterexample-wallclock.test.mjs
rust-core/tests/counterexample_wallclock.rs

The broken implementation derives cadence from an injected wall clock.

The same event set can then materialize to radically different balances depending only on when it is replayed.

The test demonstrates a roughly 100× difference under the counterexample scenario.

The production materializer therefore derives economic state from cadence events rather than replay time.

---

Non-atomic consume counterexample

Files:

tests/counterexample-nonatomic-consume.test.mjs
rust-core/tests/counterexample_nonatomic_consume.rs

The broken design splits:

check

from:

consume

Two concurrent branches can both observe an unconsumed proof before either branch records its consumption.

Both can then create destination claims.

The result is a double-spend.

The production conservation design keeps the consumption invariant atomic.

---

Lemma 1 counterexample

File:

tests/lemma1.test.mjs

A weak identifier that omits cadence state can collide two events whose rewards differ under cadence-sensitive "β".

The test confirms that the collision is safe only in the special case:

β = 0

The current design therefore treats the relevant cadence information as part of the identity of the economically meaningful event.

---

Threat model

AIWA should be evaluated against several classes of adversary.

Malicious peer

A malicious peer may:

- submit invalid events;
- replay events;
- reorder received events;
- create concurrent branches;
- lie about ownership;
- attempt to forge another domain;
- submit invalid module metadata;
- submit malicious release requests.

The protocol must reject invalid cryptographic and causal claims.

---

Malicious module

A third-party module is considered untrusted.

It may attempt to:

- lie about its identity;
- submit forged domain information;
- manipulate host messages;
- abuse storage;
- spam events;
- abuse peer messaging;
- exploit the host/module messaging boundary;
- serve code different from the registered hash.

The module must therefore execute outside the host JavaScript context and communicate through the constrained API.

---

Malicious transport

The transport layer must be treated as unreliable.

Messages may:

- be delayed;
- fail;
- arrive after a partition;
- be retried;
- be absent for an arbitrary period.

The ledger cannot assume continuous connectivity.

---

External-chain failure

Solana may be:

- unreachable;
- delayed;
- unavailable to a particular peer;
- on a different network than intended;
- incorrectly configured.

The core identity-cost verifier is therefore separated from the RPC/wallet layer.

---

Browser failure

The browser may:

- close;
- reload;
- lose network access;
- lose WebGPU;
- lose WebRTC connectivity.

The ledger is persisted locally so that application state can be reconstructed after a reload.

---

Security invariants

The following are central invariants.

Ledger

Known event + same event ID
→ no second event

merge(A, B)
→ set union

same canonical event
→ same event ID

---

Materialization

same H_d
+
same θ
+
same canonical order
→ same materialized result

The remaining caveat is numeric semantics across environments, which is an open formalization item.

---

Cadence

cadence transition
→ monotonic
→ bounded +1
→ valid VDF required

---

Conservation

Consume(p) ≤ 1

One proof cannot be consumed twice.

---

Ownership

A declared domain label is insufficient.

Transfer authorization requires:

valid signature
+
SHA-256(publicKey) == source domain

---

Replay protection

Nonce/replay guards are used in:

- cadence;
- transfer;
- module submission.

---

Module integrity

fetchedCodeHash == registeredCodeHash

must hold before mounting.

---

Module update authorization

An existing module can only be updated by its recorded author.

---

Contract immutability

A release event cannot redefine the contract's condition.

The condition comes from the original mint record.

---

Host-controlled identity

The host forces the actual caller's domain ID onto module-generated causal events.

A module cannot simply put another domain ID in its own payload and expect the host to accept it.

---

What is actually guaranteed

The current implementation has strong evidence for the following properties.

Deterministic event identifiers

JS and Rust agree on canonical event IDs across the current test vectors.

Idempotent DAG merge

Duplicate event insertion does not create duplicate events.

Deterministic replay ordering

The replay order is explicitly defined and tested.

Persistence of event history

The event DAG survives browser reload through IndexedDB.

Cadence monotonicity

Cadence transitions are bounded and replay protected.

VDF enforcement

Cadence transitions without the required VDF are rejected by the economics layer.

Scarcity clamping

Issuance cannot exceed the configured materialized budget through the normal issuance path.

Cryptographic transfer authorization

A malicious key cannot sign a transfer pretending to be another domain.

Conservation single-consumption invariant

The broken non-atomic implementation is explicitly demonstrated and excluded from production.

Module code integrity

Code is hash-checked before mounting.

Module update authorization

Updates require the recorded author.

Immutable contract conditions

Release events cannot inject their own verification condition.

Cross-language agreement

Important JS/Rust layers are checked against shared vectors and parity scripts.

---

What is not guaranteed

AIWA does not currently claim:

Proof of personhood

The identity mechanism proves key control and economic cost, not uniqueness of a human.

Perfect Sybil resistance

Economic identity cost makes Sybil attacks more expensive but does not make them impossible.

Hardware-independent time

The SHA-256 cadence VDF is not a true asymmetric VDF and is hardware-relative.

Global consensus

Canonical ordering makes a converged event set deterministic. It does not itself prove that all honest participants will converge on the same event set under every adversarial network condition.

Byzantine consensus

AIWA is not currently presented as a replacement for a formally proven Byzantine consensus protocol.

Perfect browser sandbox security

The iframe boundary significantly constrains modules, but the entire host/module messaging and resource-exhaustion surface requires further adversarial auditing.

Perfect external-chain availability

Solana RPC and finality remain external dependencies for identity registration.

Cross-platform numeric equivalence

Formal numeric/float semantics remain an open protocol item.

Formal protocol versioning

The protocol currently lacks a fully specified version-negotiation/conformance system.

Complete conformance certification

Current vectors are strong regression tools but are not yet a formal, exhaustive protocol conformance suite.

Authoritative AI

The AI system intentionally has no authoritative protocol role.

---

Testing

Current repository test counts:

415 JavaScript tests
238 Rust tests
    232 library tests
    6 integration tests
0 warnings

The exact counts are expected to evolve as the project changes.

---

JavaScript tests

Install the development dependencies:

npm install

Run:

node --test tests/*.test.mjs

The application itself does not require npm at runtime.

The package dependencies are primarily used for cryptographic and Solana-related tests.

---

Rust tests

From:

rust-core/

run:

cargo test

No WASM target is required for native Rust tests.

---

Cross-language parity

Run:

./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh

These scripts are also executed in CI.

---

CI

The repository's GitHub Actions workflows include:

ci.yml
deploy-pages.yml
update-github-trends.yml

CI performs:

- Rust tests;
- JavaScript tests;
- parity checks;
- WASM build;
- binary publication;
- deployment.

The GitHub trends workflow runs independently.

The CI workflow ignores the daily generated trends commit so that the bot does not trigger an unnecessary full protocol CI run.

---

Building Rust → WASM

Install the target:

rustup target add wasm32-unknown-unknown

Install wasm-pack:

cargo install wasm-pack

Then:

cd rust-core

wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core

The resulting WASM artifacts are loaded through:

ledger-bridge.js

The CI workflow builds the binary automatically and commits it to the repository.

---

WASM status

The WASM binary has been confirmed to load in a deployed browser session without browser errors.

What remains open is a live side-by-side comparison in the browser:

JS backend result
vs
WASM backend result

for the same runtime scenarios.

Native cross-language parity exists.

Browser-level live comparison remains a separate validation target.

---

Deploying to GitHub Pages

AIWA is designed to deploy as a static application.

One-time GitHub configuration:

Repository
→ Settings
→ Pages
→ Source
→ GitHub Actions

The deployment workflow serves:

public/

directly.

There is no application build step.

The browser receives the static application and executes the JavaScript locally.

---

No-server architecture

The application does not require an application server to materialize its local state.

The core path is:

browser
 ↓
local event DAG
 ↓
IndexedDB
 ↓
deterministic reducers
 ↓
materialized application

External services are used only where the design explicitly requires them, such as:

- Solana identity registration;
- GitHub trend retrieval;
- future WebRTC signaling infrastructure.

Those dependencies are not silently promoted to authoritative application databases.

---

Whitepaper

The formal design document is:

docs/AIWA_whitepaper_v1_2_revised.md

The implementation and whitepaper are intentionally maintained together.

When implementation work exposes a genuine protocol issue, such as:

- a bug;
- a missing invariant;
- a model/implementation divergence;
- an interoperability requirement;

the finding is incorporated into the relevant section of the paper.

It is not treated merely as a changelog entry.

---

Claim–Evidence–Assumption matrix

The whitepaper maintains a §17 Claim–Evidence–Assumption Matrix.

The current status includes:

Closed

R11 — cadence integrity

Addressed through the cadence VDF mechanism.

R19 — module sandbox isolation

Addressed through the browser sandbox architecture.

Dampened

Identity churn

The slot-scaled identity cost reduces the attack incentive but does not eliminate it.

Open

WASM live-results comparison
Numeric / float consensus semantics
Protocol versioning
Formal conformance vectors
Authoritative AI layer

These should remain visible until their corresponding evidence exists.

---

Known limitations and open work

1. Consensus and convergence

The event DAG defines a deterministic result for a given converged event set.

The remaining research question is stronger:

«Under what adversarial network and event-generation assumptions do honest participants necessarily converge on a compatible event set and therefore compatible state?»

This needs a dedicated adversarial analysis.

---

2. Numeric semantics

The protocol currently uses numeric computations that are straightforward in the existing implementations.

A production consensus specification needs to formally define:

- floating-point representation;
- rounding;
- NaN handling;
- infinity handling;
- overflow;
- underflow;
- platform differences;
- WASM versus JS numeric behavior.

Until that specification exists, numeric consensus should be considered an open protocol item.

---

3. Protocol versioning

A long-lived distributed protocol needs explicit version negotiation.

Future work should define:

protocol version
event version
formula version
serialization version

and the rules for mixed-version reconciliation.

---

4. Formal conformance suite

The current test vectors are useful but limited.

The next step is a versioned conformance suite that can be consumed by:

JavaScript
Rust
WASM
future implementations

The goal is to make interoperability testable independently of implementation language.

---

5. Browser JS/WASM parity

Native parity is already tested.

A browser-level test should compare:

JS ledger
WASM ledger

against the same runtime-generated event scenarios.

---

6. VDF strength

The current cadence VDF is intentionally described as a sequential computational delay rather than a mathematically strong asymmetric VDF.

Future work should quantify:

- hardware variance;
- GPU/CPU throughput;
- parallel identity attacks;
- expected epoch-generation rates;
- attacker cost;
- verification cost;
- appropriate iteration calibration.

---

7. Identity external-chain assumptions

The Solana layer introduces external assumptions.

Future work should specify:

- confirmation/finality requirements;
- RPC failure semantics;
- stale transaction handling;
- network mismatch behavior;
- chain reorganization assumptions;
- replay behavior across networks.

---

8. Module sandbox adversarial testing

The sandbox needs continued testing against:

- malicious "postMessage";
- cross-instance message confusion;
- origin/source confusion;
- resource exhaustion;
- storage abuse;
- network abuse;
- event spam;
- module lifecycle attacks;
- navigation attacks;
- host-side parser vulnerabilities.

---

9. Transport implementation

The current delay-tolerant transport is real.

The WebRTC mesh remains an explicit stub.

A production mesh needs:

- signaling;
- peer discovery;
- authentication;
- NAT traversal;
- connection lifecycle;
- replay handling;
- backpressure;
- large-message handling.

---

10. AI authority

The current AI layer is deliberately non-authoritative.

If a future version gives AI permission to:

- generate protocol events;
- publish modules automatically;
- alter contracts;
- make economic decisions;

then it must be treated as a new security boundary rather than an incremental UI feature.

---

Design principles

AIWA follows several principles throughout the codebase.

1. History before state

If something matters to interoperability, put it in the event history.

Do not rely on an unreplicated mutable variable.

---

2. Deterministic state before UI

The UI is a presentation of materialized state.

It should not become an implicit state machine.

---

3. Immutable definitions

If changing a definition after the fact could invalidate previous verification, make the definition immutable.

Examples:

formula-register
contract mint condition
module code hash

---

4. Cryptography before labels

Never treat:

owner = "alice"

as equivalent to cryptographic authorization.

Use:

signature
+
public-key binding

where authorization matters.

---

5. Sandboxing before trust

Third-party code is not trusted because it claims to behave.

It runs behind an explicit execution boundary.

---

6. Explicit external dependencies

If a mechanism depends on:

- Solana;
- WebRTC;
- GitHub;
- WebGPU;

the dependency should be visible in the architecture.

Do not simulate success when the dependency is unavailable.

---

7. Broken implementations belong in tests

A security invariant should ideally have a test showing what breaks when the invariant is removed.

Examples:

wall-clock cadence
non-atomic consume
weak identifiers

---

8. Refactoring must not rewrite history

Protocol identifiers are data.

Renaming an implementation function or file must not change identifiers already present in event history.

---

9. AI is advisory by default

The AI layer should not silently become an authority.

Suggestions and consensus are separate layers.

---

10. State what is not proven

The architecture deliberately exposes open assumptions.

A system is easier to audit when its uncertainty is explicit.

---

Status

AIWA currently provides a working reference implementation of:

- content-addressed event DAGs;
- deterministic materialized state;
- IndexedDB event persistence;
- JS/Rust ledger parity;
- cadence and replay protection;
- sequential cadence VDF;
- reward calculation;
- scarcity limits;
- immutable formula registration;
- conservation state transitions;
- cryptographically authenticated transfers;
- Solana identity-cost registration;
- identity-cost replication;
- identity-churn damping;
- content-addressed modules;
- signed module submissions;
- author-controlled module updates;
- sandboxed module execution;
- delay-tolerant transport;
- connection watchdog;
- deterministic pools;
- composable causal conditions;
- immutable generic contracts;
- threshold-release escrow;
- replicated public profiles;
- local AI idea generation;
- local module-pattern analysis;
- WebLLM integration;
- desktop state management;
- multiple presentation themes;
- GitHub trend ingestion;
- cross-language regression testing.

The current implementation should nevertheless be considered:

«a serious reference implementation and security-oriented research prototype, not a formally verified production consensus system.»

Its strongest current properties are deterministic event identity, explicit materialization rules, cryptographic authorization, immutable verification conditions, cross-language parity, and extensive regression/counterexample testing.

Its most important remaining questions concern adversarial convergence, numeric consensus, protocol evolution, external-chain assumptions, browser sandbox hardening, VDF strength, and formal conformance.

---

Quick start

Clone the repository and install test dependencies:

npm install

Run JavaScript tests:

node --test tests/*.test.mjs

Run Rust tests:

cd rust-core
cargo test
cd ..

Run cross-language parity:

./scripts/verify-parity.sh
./scripts/verify-g-parity.sh
./scripts/verify-conservation-parity.sh
./scripts/verify-submission-parity.sh

For WASM:

rustup target add wasm32-unknown-unknown
cargo install wasm-pack

cd rust-core
wasm-pack build \
  --target web \
  --out-dir ../public/js/wasm \
  --out-name aiwa_core

Then deploy the "public/" directory through GitHub Pages.

---

One-sentence summary

AIWA is an offline-first, browser-native application architecture in which immutable, content-addressed events are reconciled through a delay-tolerant DAG and deterministically materialized into application state, with cryptographic identity, conservation, composable contracts, sandboxed modules, and an explicitly non-authoritative AI layer.

---

Final security statement

AIWA does not ask the reader to trust the implementation simply because it contains cryptography or hundreds of tests.

The intended model is:

claim
  ↓
explicit invariant
  ↓
implementation
  ↓
unit test
  ↓
counterexample
  ↓
cross-language parity
  ↓
documented assumption

Where evidence does not yet exist, the project says so.

That distinction is part of the protocol design.
