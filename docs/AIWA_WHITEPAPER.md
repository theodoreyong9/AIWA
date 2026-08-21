# AIWA — Autonomous Interplanetary Web Application

**A Reference Architecture for Autonomous, Delay-Tolerant Web Applications Under Communication Partition**

**Author:** Jean da Cunha  
**Status:** Final technical research whitepaper

---

## Abstract

AIWA is a browser-native reference architecture for programmable applications operating under prolonged communication delay, intermittency, or partition.

Its central design decision is to treat **non-synchronization as a normal operating condition**. A domain maintains a local, content-addressed event history `H_d`. When communication becomes available, histories are exchanged and merged, and application state is deterministically materialized:

```text
A = G(H_d, θ)
```

This separates four questions that are frequently conflated: what history exists, what state follows from that history, who is authorized to cause transitions, and whether the resulting deterministic state is semantically correct under adversarial concurrency. AIWA implements concrete mechanisms for the first three classes while explicitly not claiming that deterministic materialization constitutes Byzantine consensus.

The broader research question is:

> **Can a programmable application become globally interoperable without requiring continuous global coordination?**

AIWA approaches this question through distributed event history, deterministic materialization, cryptographic authority, conservation rules, programmable contracts, delay-tolerant transport, and JS/Rust parity.

Forkability is treated as more than source-code availability. The longer-term objective is a public protocol boundary sufficiently explicit that independent implementations can reproduce protocol-relevant behaviour and establish compatibility through conformance.

This does not constitute a claim of universal interoperability, Byzantine consensus, universal Sybil resistance, proof of human identity, or complete browser security. Those limitations remain explicit research problems.

The scientific objective is therefore not to declare AIWA solved, but to make its assumptions, invariants, counterexamples, economic constraints, and unresolved questions sufficiently explicit that independent researchers can reproduce, attack, formalize, or falsify them.

---

## Table of Contents

- **PART I — RESEARCH FRAME AND MODEL**
  - [1. Research position](#1-research-position)
  - [1.1 The research question](#11-the-research-question)
  - [1.2 Position relative to existing systems](#12-position-relative-to-existing-systems)
  - [2. The physical motivation](#2-the-physical-motivation)
  - [3. Asynchrony as the default operating model](#3-asynchrony-as-the-default-operating-model)
  - [4. Synchronization is not consensus](#4-synchronization-is-not-consensus)
  - [5. Finality as a research spectrum](#5-finality-as-a-research-spectrum)
  - [6. Intention and the spectrum of economic pressure](#6-intention-and-the-spectrum-of-economic-pressure)
  - [7. Three dimensions of the model](#7-three-dimensions-of-the-model)
  - [8. Time without a global clock](#8-time-without-a-global-clock)
  - [9. System model](#9-system-model)
- **PART II — EVENT HISTORY AND DETERMINISTIC STATE**
  - [10. Event identity](#10-event-identity) · [11. Canonical encoding](#11-canonical-encoding) · [12. Event-set replication](#12-event-set-replication) · [13. Canonical materialization](#13-canonical-materialization) · [14. Persistence and replay](#14-persistence-and-replay) · [15. Materialized state](#15-materialized-state) · [16. Conservation versus accrual](#16-conservation-versus-accrual)
- **PART III — ECONOMICS, CADENCE AND SCARCITY**
  - [17. Economic accrual](#17-economic-accrual) · [18. Reward function](#18-reward-function) · [19. Formula immutability](#19-formula-immutability) · [20. Cadence](#20-cadence) · [21. Sequential cadence proof](#21-sequential-cadence-proof) · [22. What the cadence proof does not establish](#22-what-the-cadence-proof-does-not-establish) · [23. Autonomous issuance and scarcity](#23-autonomous-issuance-and-scarcity) · [24. Scarcity simulation](#24-scarcity-simulation)
- **PART IV — IDENTITY AND CONSERVATION**
  - [25. Identity](#25-identity) · [26. External-chain burn](#26-external-chain-burn) · [27. Solana assumptions](#27-solana-assumptions) · [28. Identity churn](#28-identity-churn) · [29. Weak identity lemma](#29-weak-identity-lemma) · [30. Conservation state machine](#30-conservation-state-machine) · [31. Transfer authorization](#31-transfer-authorization) · [32. Claim issuance](#32-claim-issuance) · [33. Non-atomic consumption counterexample](#33-non-atomic-consumption-counterexample)
- **PART V — TRANSPORT AND EXTENSIBILITY**
  - [34. Transport architecture](#34-transport-architecture) · [35. Delay-tolerant transport](#35-delay-tolerant-transport) · [36. Connection watchdog](#36-connection-watchdog) · [37. WebRTC](#37-webrtc) · [38. Modules and extensibility](#38-modules-and-extensibility) · [39. Module content addressing](#39-module-content-addressing) · [40. Signed submission](#40-signed-submission) · [41. Module registry](#41-module-registry) · [42. Module sandbox](#42-module-sandbox) · [43. Module context](#43-module-context)
- **PART VI — CAUSAL APPLICATION PRIMITIVES**
  - [44. Causal contracts](#44-causal-contracts) · [45. Generic contracts](#45-generic-contracts) · [46. Pools](#46-pools)
- **PART VII — APPLICATION, AI AND IMPLEMENTATION**
  - [47. Presentation and desktop](#47-presentation-and-desktop) · [48. Hyperprofile](#48-hyperprofile) · [49. Peer messaging](#49-peer-messaging) · [50. AI layer](#50-ai-layer) · [51. GitHub trends](#51-github-trends) · [52. Rust reference implementation](#52-rust-reference-implementation) · [53. Cross-language parity](#53-cross-language-parity)
- **PART VIII — SECURITY AND SYSTEM BOUNDARIES**
  - [54. Threat model](#54-threat-model) · [55. Security invariant matrix](#55-security-invariant-matrix) · [56. Consensus boundary](#56-consensus-boundary) · [57. Economic security](#57-economic-security) · [58. Patient capital](#58-patient-capital) · [59. Observability](#59-observability) · [60. Commitment versus physical truth](#60-commitment-versus-physical-truth)
- **PART IX — EXPERIMENTS, INVARIANTS AND EVIDENCE**
  - [61. Experimental methodology](#61-experimental-methodology) · [62. Experiment: post-partition convergence](#62-experiment-post-partition-convergence) · [63. Experiment: deliberately broken wall clock](#63-experiment-deliberately-broken-wall-clock) · [64. Experiment: non-atomic consume](#64-experiment-non-atomic-consume) · [65. Experiment: weak identity](#65-experiment-weak-identity) · [66. Experimental evidence](#66-experimental-evidence) · [67. Protocol invariants](#67-protocol-invariants)
- **PART X — OPEN RESEARCH AND CONCLUSION**
  - [68. Open problems](#68-open-problems) · [69. Design principles](#69-design-principles) · [70. Research participation](#70-research-participation) · [71. Conclusion](#71-conclusion) · [72. Forkability as a protocol property](#72-forkability-as-a-protocol-property) · [73. From decentralization to global interoperability](#73-from-decentralization-to-global-interoperability) · [74. Research context and related work](#74-research-context-and-related-work)
- **Appendices** — Appendix A–I
- **References**

---
# PART I — RESEARCH FRAME AND MODEL

# 1. Research position

AIWA is a research and development architecture.

It is not presented as:

- a completed interplanetary consensus protocol;
- a proof-of-human identity system;
- a true asymmetric VDF;
- a universal Sybil-resistance mechanism;
- a complete browser sandbox security proof;
- a proof that arbitrary concurrent histories have semantically correct reconciliation.

Its research objective is:

> **to construct a working, testable architecture in which partition tolerance, deterministic reconstruction, economic issuance, conservation, identity, extensibility, and AI assistance have explicit boundaries rather than being hidden inside one authority.**

The central model is:

```text
                         H_d
                  replicated history
                         │
                         ▼
                 canonical order
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

       Transport · Identity · Modules · AI
              remain separate concerns
```

## 1.1 The research question

AIWA is motivated by a distinction between **decentralization** and a broader notion of **global interoperability**.

Decentralization concerns the distribution of control. AIWA asks:

> **Can an application remain locally useful during communication partitions and later become interoperable across independently operated environments without requiring continuous global coordination?**

The hypothesis is not that coordination disappears. Rather, some coordination can be moved from continuous operation into explicit history exchange, deterministic materialization, verification, and reconciliation.

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

The word **global** is used in a protocol sense. It refers to operation across independent locations, operators, networks, terminals, implementations, and forks, rather than merely geographic scale.

This is a research direction. The current implementation does not establish universal interoperability, Byzantine consensus, or semantic correctness for arbitrary concurrent histories.

---

## 1.2 Position relative to existing systems

AIWA does not claim to invent distributed histories, CRDTs, peer-to-peer networking, content addressing, cryptographic identities, or programmable contracts individually. These mechanisms have substantial prior art.

The relevant research question is their composition around an explicit application-protocol boundary.

| System | Primary architectural emphasis |
|---|---|
| Automerge | distributed / local-first application data |
| Yjs | replicated collaborative data |
| IPFS | content-addressed distributed data |
| ActivityPub | federated communication |
| Urbit | persistent identity and autonomous network |
| Ethereum | globally coordinated programmable state |
| AIWA | distributed, deterministic, programmable application state under partition |

This table is a conceptual positioning device, not a claim of superiority or feature completeness. AIWA's proposed distinction is that history, deterministic state derivation, authority, causal constraints, conservation, and programmable application logic are treated as explicit protocol concerns that can be independently tested and, potentially, independently implemented.

---

# 2. The physical motivation

An interplanetary or otherwise delay-tolerant application cannot assume continuous communication.

Propagation delay alone can be minutes across planetary distances, and communications can be unavailable for substantially longer periods because of orbital geometry and operational constraints.

The architectural consequence is more important than any particular mission schedule:

> **communication availability must not be a hidden precondition of local correctness.**

A system that requires a global response before every economically meaningful action is not autonomous during partition.

AIWA instead asks:

```text
What can a domain safely do
with only its local history?
```

and separately:

```text
What becomes possible
when another history becomes observable?
```

---

# 3. Asynchrony as the default operating model

The normal lifecycle is:

```text
┌───────────────────────┐
│ local asynchronous    │
│ operation             │
└──────────┬────────────┘
           │
           │ events accumulate
           ▼
┌───────────────────────┐
│ local history H_d     │
└──────────┬────────────┘
           │
           │ transmission
           ▼
┌───────────────────────┐
│ reconciliation        │
└──────────┬────────────┘
           │
           │ merge
           ▼
┌───────────────────────┐
│ common observed       │
│ event set             │
└──────────┬────────────┘
           │
           │ canonical G
           ▼
┌───────────────────────┐
│ materialized state    │
└───────────────────────┘
```

This creates an important distinction:

> **Synchronization is a mode of information exchange, not the permanent state in which the application must operate.**

A synchronized state may exist temporarily. The application must then be capable of becoming partitioned again without treating that partition as an exceptional protocol failure.

---

# 4. Synchronization is not consensus

This distinction is fundamental.

Suppose two domains independently produce valid branches:

```text
          genesis
          /     \
         /       \
        A         B
```

When the domains reconnect, a deterministic algorithm can order the branches.

That gives:

```text
same event set
      ↓
same canonical order
      ↓
same G(H, θ)
```

But this does not prove that the resulting state is the semantically correct resolution of the concurrent actions.

Therefore:

```text
determinism ≠ consensus
replication ≠ consensus
synchronization ≠ consensus
```

AIWA's canonical order makes independent implementations capable of reproducing the same materialization under the specified model.

It does not, by itself, establish Byzantine agreement over the semantic legitimacy of every concurrent economic conflict.

This is one of the central unresolved research questions.

---

# 5. Finality as a research spectrum

AIWA uses the phrase **finality spectrum** to describe a conceptual property, not a physical signal.

A protocol domain has a cryptographic identity:

```text
domainId = SHA-256(publicKey)
```

It may also be useful to describe an application by the semantic purpose for which its history is authoritative.

Conceptually:

```text
semantic purpose

A                 B                    C
██████████        █████████            ███████████
        │             │
        └── boundary ─┘
```

The boundaries can be described as **silence regions**.

Here, silence means:

> a domain does not claim a particular semantic purpose as part of its own authority.

It does not mean that the corresponding information is globally absent.

The following distinctions are therefore explicit:

```text
not observed
    ≠
observed absent
    ≠
proven absent
```

The current protocol does not assign consensus meaning to semantic silence. This vocabulary is a research direction for future formalization.

---

# 6. Intention and the spectrum of economic pressure

A second research axis concerns observable intention.

The protocol cannot directly inspect a person's mental state.

It can observe actions and commitments.

A useful abstraction is therefore:

```text
lower observed pressure ───────── higher observed pressure
       patience                    impatience
```

Observable proxies may include:

- capital committed;
- identity cost accepted;
- cadence advancement effort;
- action frequency;
- time-sensitive economic choices;
- repeated attempts;
- cost accepted to reduce delay.

The distinction is:

```text
observed behaviour
       ≠
psychological intention
```

AIWA therefore treats **impatience** as a possible economic observable, not as a mind-reading capability.

The research question is whether an economically meaningful measure of action pressure can be derived without making unsupported claims about human motives.

---

# 7. Three dimensions of the model

The conceptual framework can be represented as:

```text
                     FINALITY
                        ▲
                        │
                        │
                        └──────────────► INTENTION
                       /
                      /
                     ▼
                TRANSMISSION
```

These dimensions answer different questions:

| Dimension | Meaning |
|---|---|
| Finality | What semantic purpose does the domain claim? |
| Intention | What measurable economic pressure accompanies action? |
| Transmission | When can another domain observe the history? |

Only transmission is currently implemented as a network mechanism.

Finality and intention provide a vocabulary for future formal models.

---

# 8. Time without a global clock

A distributed application can have wall clocks without making wall-clock time authoritative.

AIWA separates:

```text
wall clock
 ├── UI
 ├── diagnostics
 └── transport scheduling

protocol cadence
 └── economic progression
```

Economic state must therefore be derivable from recognized history.

The wall-clock counterexample demonstrates the failure of using evaluation time as the economic state variable:

```text
same H_d
+
different wall-clock observation
=
different balance
```

Such a system would not be a deterministic function of its replicated history.

---

# 9. System model

For each domain `d`, the reference state can be represented conceptually as:

```text
State_d =
(
  H_d,
  A_d,
  C_d,
  B_d,
  i_d,
  q_d
)
```

where:

- `H_d` = event history;
- `A_d` = materialized application state;
- `C_d` = commitment / historical evidence state;
- `B_d` = applicable issuance budget or scarcity state;
- `i_d` = identity state;
- `q_d` = cadence state.

Communication is external to the ledger state.

A local event is accepted only when it satisfies the relevant validity rules.

---

# PART II — EVENT HISTORY AND DETERMINISTIC STATE

# 10. Event identity

An event is content-addressed.

Conceptually:

```text
id(e) = SHA-256(
    canonical(
        domain,
        type,
        payload,
        parent_ids
    )
)
```

The hash is full-width.

Truncating event identifiers would reintroduce collision considerations that the economic identity-sufficiency analysis is designed to avoid.

Canonicalization is therefore part of the wire-level protocol semantics.

---

# 11. Canonical encoding

A logical object must have one canonical byte representation.

The JS implementation recursively sorts object keys.

The Rust implementation applies equivalent canonical semantics.

This is tested with vectors containing:

- flat payloads;
- nested payloads;
- arrays;
- unsorted parents;
- different key orders representing the same logical object.

The reference parity run reports six matching ID vectors.

The general requirement is:

```text
same logical event
        ↓
same canonical bytes
        ↓
same hash
        ↓
same event id
```

---

# 12. Event-set replication

The replicated state is a set of events:

```text
H_d = {e1, e2, ..., en}
```

Insertion:

```text
H' = H ∪ {e}
```

Merge:

```text
merge(H1, H2) = H1 ∪ H2
```

The merge operator therefore satisfies:

```text
idempotence
H ∪ H = H

commutativity
H1 ∪ H2 = H2 ∪ H1

associativity
(H1 ∪ H2) ∪ H3 = H1 ∪ (H2 ∪ H3)
```

These are replication properties.

They are not a complete consensus theorem.

---

# 13. Canonical materialization

A set is insufficient if reducers have order-sensitive effects.

AIWA specifies:

> **id-sorted depth-first topological order**

as the canonical materialization order.

This ordering is normative.

An implementation that chooses another deterministic tie-break can disagree with the reference implementation while remaining internally deterministic.

Therefore:

```text
canonical event identity
+
canonical topological order
+
canonical numeric semantics
=
cross-implementation materialization contract
```

Numeric semantics remain an open formalization item.

---

# 14. Persistence and replay

The browser implementation persists the event DAG in IndexedDB.

Restoration performs:

1. load stored events;
2. reconstruct the DAG;
3. topologically order events;
4. replay through the real reducers;
5. recover the actual cadence tip.

This prevents a browser reload from silently restarting economic state from a fresh local value.

---

# 15. Materialized state

The core equation is:

```text
A = G(H_d, θ)
```

`H_d` is replicated history.

`A` is derived state.

`θ` contains protocol parameters.

This distinction prevents a common class of replication errors:

```text
replicate balance
```

versus:

```text
replicate events
→ derive balance
```

The second allows duplicate network delivery to be discarded before it contributes economically.

---

# 16. Conservation versus accrual

AIWA separates:

### Accrual

Creation of new economic state according to `G`.

### Conservation

Movement or transformation of an already existing claim.

### Evidence

Commitments that make accepted history tampering detectable relative to an anchor.

### Observability

What a domain can currently know about another domain.

### Extensibility

Third-party application logic.

### Presentation

What a user sees.

These are distinct problems and should not share implicit authority.

---

# PART III — ECONOMICS, CADENCE AND SCARCITY

# 17. Economic accrual

The reference economic event types include:

```text
genesis
cadence
accrual
```

`genesis` initializes domain state.

`cadence` advances the domain's economic epoch.

`accrual` carries:

```text
domain
b
q0
```

and derives the effective cadence from the materialized state reached so far.

The reward is then passed through scarcity policy before becoming issued value.

---

# 18. Reward function

The reference Proof-of-Will formula is:

```text
r(b, q, q_total, T)
=
(b · q^α)
/
[ln(q_total^(β(1−T)) + C)]^γ
```

with reference parameters:

```text
α = 1.1
β = 2.2
γ = 3
C = 35937
```

Reference calculation:

```text
r(1, 100, 100, 0)
=
0.11844290947765648
```

The result is confirmed through:

- direct evaluation;
- replay through the actual event DAG;
- cross-language parity.

The formula is not a mutable local configuration.

---

# 19. Formula immutability

A `formula-register` event permanently binds an identifier to:

```text
(alpha, beta, gamma, C, minQ)
```

The same identifier cannot later be rebound to another parameter set.

`genesis` is the fixed protocol default.

This prevents a reconciled history from being interpreted through different local definitions of the same formula identifier.

---

# 20. Cadence

Cadence is a monotonic economic epoch:

```text
q' = q + 1
```

subject to the protocol's bounded transition rule.

A cadence event is:

- replay-protected;
- associated with the previous cadence state;
- validated before acceptance;
- independent of wall-clock evaluation time.

The current implementation does not attempt to derive a universal physical time from cadence.

---

# 21. Sequential cadence proof

Every cadence transition carries a sequential SHA-256 chain.

```text
h0 = seed(domain, previous_vdf_output)

h1 = SHA256(h0)
h2 = SHA256(h1)
...
hN = SHA256(hN-1)
```

The next cadence proof cannot simply restart from an unrelated seed.

The reference iteration count is configurable, with 200,000 as the default.

The implementation reports approximately 240 ms on typical hardware, but this is not a protocol guarantee.

---

# 22. What the cadence proof does not establish

It is not a true asymmetric VDF.

Verification recomputes the chain.

Therefore it does not provide:

- hardware-independent timing;
- asymmetric verification cost;
- proof of physical elapsed time;
- resistance to parallelism across identities;
- a global clock.

Its defensible role is:

> **sequential computational friction that makes rapid local cadence fabrication more expensive under the configured implementation.**

Quantitative attacker analysis remains necessary.

---

# 23. Autonomous issuance and scarcity

Suppose domains can issue autonomously during arbitrary partition intervals.

If:

- issuance remains possible without communication;
- domains do not need knowledge of one another;
- all issued value remains valid indefinitely;
- issuance continues indefinitely;

then a finite global supply bound cannot arise from those assumptions alone.

A scarce constraint must therefore enter somewhere.

AIWA supports the analysis of:

1. preallocated budgets;
2. rate limits;
3. expiring issuance rights;
4. scarce computational or physical resources;
5. external authority.

The reference implementation includes both bounded and unbounded simulation controls.

---

# 24. Scarcity simulation

The reference simulation reproduces:

```text
I(1000h)  = 2000
I(10000h) = 20000
```

for the unbounded control case.

For a worked budget:

```text
5000 + 5000
```

the issuance saturates at:

```text
10000
```

This demonstrates the distinction:

```text
rate bound
    ≠
finite supply bound
```

A rate can remain positive indefinitely.

A finite supply bound requires eventual exhaustion or another explicit constraint.

---

# PART IV — IDENTITY AND CONSERVATION

# 25. Identity

The reference identity is:

```text
domainId = SHA-256(publicKey)
```

The public key is therefore not merely a display label.

It is part of the authorization relation.

A transfer from domain `d` must be authorized by the key whose hash is `d`.

---

# 26. External-chain burn

Before identity registration, the reference flow can burn SOL to the Solana incinerator.

The transaction signature becomes the registration evidence.

The burn establishes:

```text
external transaction
+
real expenditure
+
control of signing key
```

It does not establish:

```text
unique human
honest actor
real-world identity
geographic identity
```

The protocol should therefore describe this as **proof of cost / proof of key control**, not proof of personhood.

---

# 27. Solana assumptions

The identity layer introduces external assumptions:

- RPC availability;
- transaction validity;
- the selected network's finality semantics;
- transaction history accessibility;
- correct interpretation of slots;
- network-specific economic conditions.

Devnet is unsuitable as a real economic Sybil boundary because free faucet SOL is not scarce in the same sense as mainnet SOL.

A second chain can be integrated by producing the same normalized burn transaction representation.

---

# 28. Identity churn

The reward function can make older identities economically more valuable.

An attacker may therefore abandon an old identity and create a new one.

AIWA can scale identity cost with the Solana slot at which the burn is confirmed.

This can damp churn.

It does not prove that churn is impossible.

It also does not distinguish:

```text
legitimate late joiner
```

from:

```text
attacker creating a fresh identity
```

This is an explicit deployment trade-off.

---

# 29. Weak identity lemma

Under a first-representative-wins identity collapse, an identifier is sufficient only if merging events under that identifier cannot change the materialized result.

Formally:

```text
id(e1) = id(e2)
```

must imply:

```text
G({e1}, θ) = G({e2}, θ)
```

for all events that can be collapsed.

If reward depends on cadence `q`, an identifier that omits `q` may be unsafe.

This is not a rule that identifiers must always contain every field.

It is a rule that identifiers must preserve every distinction on which the materialized semantics depend.

---

# 30. Conservation state machine

The transfer pipeline is:

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

The core invariant is:

```text
count(Consume(p)) ≤ 1
```

A proof that can be verified repeatedly but consumed repeatedly is not a conservation mechanism.

---

# 31. Transfer authorization

The reference transfer signature covers:

```text
claimId
from
to
nonce
timestamp
```

The signer public key is checked against the source domain:

```text
SHA-256(signerPubkey) == from
```

Nonce replay protection prevents reusing the same authorization.

This closes the distinction between:

```text
declaring ownership
```

and:

```text
proving control of the owner identity
```

The Ed25519 dependency this relies on is a lazy, cached dynamic import inside the functions that use it, not a static top-level one -- a static import graph is linked before any of a module's own top-level code runs, so an unreachable CDN would otherwise hang application startup with no catchable error rather than surfacing as an ordinary promise rejection.

---

# 32. Claim issuance

`claim-issue` bridges economic accrual and conservation.

It:

- checks the domain's materialized accrued balance;
- respects rejected events;
- prevents issuance beyond the available balance;
- creates a spendable claim.

This is important because conservation must not become an independent minting path.

---

# 33. Non-atomic consumption counterexample

Consider:

```text
Branch A:
verify(proof) → unused

Branch B:
verify(proof) → unused

Branch A:
consume(proof)

Branch B:
consume(proof)
```

If verification and consumption are not one atomic state transition, both branches can pass the precondition.

The result is:

```text
one proof
→ two successful consumptions
```

The reference implementation retains the broken variant as a permanent regression test.

---

# PART V — TRANSPORT AND EXTENSIBILITY

# 34. Transport architecture

Transport is intentionally pluggable.

The interface provides operations equivalent to:

```text
connect
send
onMessage
onPeerJoin
onPeerLeave
```

The protocol above transport must not depend on whether the concrete transport is WebRTC, relay, or delay-tolerant store-and-forward.

---

# 35. Delay-tolerant transport

A message is queued before transmission is attempted.

Per-peer ordering is:

```text
FIFO
```

If the first queued message fails, later messages to that peer are not reordered around it.

Different peer queues remain independent.

Successful delivery removes the message from the durable queue.

This models a realistic delay-tolerant contact schedule without pretending that a persistent connection exists.

---

# 36. Connection watchdog

The watchdog:

- detects stale connectivity;
- fires the stale callback once per outage episode;
- resets after actual reconnection;
- explicitly handles the boundary where activity occurs exactly at the timeout.

This is a transport reliability mechanism, not a consensus mechanism.

---

# 37. WebRTC

WebRTC is appropriate for lower-latency local or same-planet connectivity but requires signaling.

AIWA therefore treats signaling as external infrastructure.

The core protocol can simultaneously use:

```text
WebRTC / relay
```

for local peers and:

```text
delay-tolerant transport
```

for intermittent long-haul peers.

The ledger sees event delivery, not transport implementation details.

---

# 38. Modules and extensibility

Third-party code must not become an implicit protocol authority.

The module boundary is:

```text
registered bytes
       │
       ▼
SHA-256 code hash
       │
       ▼
signed submission
       │
       ▼
host verification
       │
       ▼
sandboxed execution
       │
       ▼
restricted ctx
```

---

# 39. Module content addressing

Every module registration binds the module to a code hash.

A URL is not the identity.

If the bytes behind the URL change:

```text
fetched hash ≠ registered hash
```

the host refuses to mount the module.

Updating code resets audit status.

An update to an existing module identifier requires the recorded author.

---

# 40. Signed submission

The signed submission includes:

```text
moduleId
codeHash
codeUrl
nonce
timestamp
signature
```

The submission pipeline verifies the actual fetched code.

This closes the gap between:

```text
caller claims hash X
```

and:

```text
host actually executes bytes Y
```

The host must establish that:

```text
SHA-256(fetched bytes) == registered codeHash
```

before mounting.

The same lazy, cached dynamic-import discipline noted in §31 for transfer authorization applies here too, for the identical reason: an unreachable CDN must surface as a catchable rejected promise, not a silent startup hang.

---

# 41. Module registry

Module registration is open.

Mechanical rejection conditions include:

- duplicate identifiers;
- invalid economic self-declarations;
- inconsistent author authorization;
- invalid signatures;
- hash mismatch.

Audit status is a separate property.

For issuing modules, the economic declaration is checked against the reference reward function.

---

# 42. Module sandbox

The reference runner uses:

```html
<iframe sandbox="allow-scripts">
```

without:

```text
allow-same-origin
```

The module does not receive the private identity key.

Its interaction with the host occurs through a constrained context and `postMessage`.

This provides a concrete isolation boundary.

It is not a universal proof against:

- browser vulnerabilities;
- denial of service;
- unbounded computation;
- network-side channels;
- malicious message patterns;
- resource exhaustion;
- implementation bugs.

These remain part of the browser security threat model.

---

# 43. Module context

The available surface includes:

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

The host forces the actual calling domain into causal event creation.

The module cannot forge an arbitrary domain identity through its payload.

---

# PART VI — CAUSAL APPLICATION PRIMITIVES

# 44. Causal contracts

AIWA's causal condition evaluator provides:

```text
ownership
signature
count
deterministic-match
unique
causal-order
```

These can be composed using:

```text
AND
OR
NOT
```

The evaluator operates on declarative data.

It never executes submitted verifier code.

This is the mechanism that allows permissionless composition without making arbitrary executable contract logic part of the consensus boundary.

---

# 45. Generic contracts

A generic contract is defined with a condition at mint time.

That condition is immutable.

A release operation carries:

```text
claimId
from
to
contractId
```

and the condition is looked up from the already minted contract.

A release cannot replace the condition.

This explicitly prevents condition smuggling.

A 2-of-2 escrow is demonstrated using a count condition over approval events.

A known scope difference between implementations, not a security gap: the JS reducer accepts a structurally malformed condition at mint time less strictly than Rust does. This is harmless because the shared evaluator rejects a malformed or unrecognized condition identically in both languages at evaluation time -- a contract minted this way in JS can never actually release anything.

---

# 46. Pools

The pool primitive provides:

```text
pool-init
pool-contribute
pot-release
```

The pot address has no private key.

The pool payout verifier delegates to the causal condition evaluator.

Weighted draws are deterministic from:

```text
poolId
cycleIndex
contributions
```

JS and Rust produce the same winner, total and draw hash.

---

# PART VII — APPLICATION, AI AND IMPLEMENTATION

# 47. Presentation and desktop

Presentation is outside the authoritative state transition boundary.

The reference system provides two themes:

```text
default
compact
```

with identical token key sets.

Desktop arrangement is independent of economic rank.

The layout engine is pure and DOM-free.

Supported operations:

- reorder;
- folder creation;
- merge into existing folder;
- eject;
- remove.

---

# 48. Hyperprofile

The public profile is a DAG-replicated key/value view.

```text
share(key, value)
```

publishes.

```text
share(key, null)
```

retracts.

The profile is materialized from events rather than treated as an unreplicated UI object.

---

# 49. Peer messaging

`sendToPeer()` provides real-time module messaging.

It is distinct from causal events.

A peer message:

- is routed through transport;
- is delivered only to an active target module;
- has no inbound durable queue;
- does not automatically become a DAG event;
- does not itself imply reconciliation.

This distinction prevents transient communication from silently acquiring ledger semantics.

---

# 50. AI layer

The AI component is structurally advisory.

The idea agent can inspect a context assembled from:

- local desktop pins;
- locally known published modules;
- public profile information;
- recency-weighted network categories;
- category gaps;
- multiple independent contacts;
- external GitHub trends;
- primitive usage across local verified modules.

The model returns suggestions -- text, never code. Primitive-usage mining deliberately stops at frequency data rather than producing code skeletons; code generation is an explicit, repeatedly-confirmed non-goal of this layer, not an unbuilt feature awaiting completion.

It has no authoritative write path.

Removing the AI layer changes the user experience but not the validity rules of the protocol.

---

# 51. GitHub trends

The GitHub trends feed is external inspiration.

A scheduled GitHub Action calls the public repository search API and commits the resulting JSON.

The browser fetches it lazily.

The data is explicitly labeled as:

```text
not AIWA network activity
```

and cannot be interpreted as consensus state.

---

# 52. Rust reference implementation

The Rust core mirrors the JS protocol implementation.

It includes modules for:

- DAG;
- event identity;
- economics;
- cadence;
- cadence proof;
- scarcity;
- conservation;
- identity;
- module registry;
- module submission;
- pools;
- contracts;
- causal verification;
- public profile.

The bridge selects WASM when available and falls back to JS.

---

# 53. Cross-language parity

The protocol is treated as an interoperability contract.

Parity covers:

```text
event ids
G scenarios
conservation scenarios
submission signatures
pool draws
```

Submission parity is bidirectional:

```text
JS signs → Rust verifies
Rust signs → JS verifies
```

Fresh keypairs are used in the signing parity run.

The remaining open formal concerns include:

- numeric semantics;
- floating-point behaviour;
- protocol versioning;
- formal conformance vectors.

---

# PART VIII — SECURITY AND SYSTEM BOUNDARIES

# 54. Threat model

AIWA considers:

### Replay

An attacker resends valid data.

### Duplicate reconciliation

An attacker delivers the same event or merge repeatedly.

### Fabrication

An attacker creates events claiming another domain.

### History rewriting

An attacker attempts to replace or contradict accepted history.

### Sybil

An attacker creates multiple identities.

### Patient capital

An attacker optimizes over long partition durations.

### Cadence acceleration

An attacker attempts to advance economic epochs too quickly.

### Clock manipulation

An attacker attempts to make economic state depend on an untrusted wall clock.

### Transport manipulation

An attacker delays, drops, duplicates or reorders messages.

### Malicious modules

Third-party code attempts to cross the host boundary.

### Malicious contracts

A contract author or release actor attempts to change verification semantics.

### External identity attacks

An attacker submits invalid or ambiguous external-chain evidence.

---

# 55. Security invariant matrix

| Mechanism | Invariant / property | Limitation |
|---|---|---|
| Event identity | equal logical events hash equally | hash security assumed |
| Merge | duplicate delivery is idempotent | does not solve semantic conflict |
| Canonical order | implementations materialize same order | deterministic order is not consensus |
| Cadence | monotonic bounded advancement | not physical time |
| Sequential proof | rapid advancement requires sequential work | hardware-relative |
| Scarcity | issuance follows selected bound | policy-dependent |
| Identity binding | signer controls domain key | not personhood |
| Burn | registration has external cost | external-chain assumptions |
| Conservation | one proof consumes at most once | atomicity must hold |
| Module hash | code swap is detected | browser security remains broader |
| Sandbox | restricted execution boundary | not a universal exploit proof |
| Contract immutability | release cannot replace mint condition | condition language still needs correct semantics |
| AI separation | AI cannot authorize protocol state | model quality remains outside consensus |

---

# 56. Consensus boundary

The most important unresolved question is:

> **When two individually valid concurrent histories contain mutually incompatible economic actions, does canonical ordering merely produce a deterministic answer, or does it provide a semantically legitimate resolution?**

Consider:

```text
        common history
          /       \
         /         \
   action A       action B
       │             │
       └──────┬──────┘
              ▼
        canonical order
              │
              ▼
          G(H, θ)
```

Canonical order guarantees reproducibility.

It does not guarantee that an adversary cannot exploit the ordering to obtain a result that would be rejected by a stronger consensus protocol.

This is the primary research boundary.

---

# 57. Economic security

For fixed capital `B` divided across `N` identities:

```text
b = B/N
```

a simplified model gives:

```text
R_N = K · B^α · t^β · N^(1−α)
```

With identity cost:

```text
Profit(N)
=
K · B^α · t^β · N^(1−α)
− N · c_id
```

For `α > 1`, splitting fixed capital is disfavoured.

For `0 < α < 1`, a finite identity cost can create a finite optimum.

This is not enough to characterize real attacks because:

- capital may be acquired over time;
- partition duration is variable;
- identity cost may depend on time;
- identities can operate in parallel;
- the attacker may be risk-seeking;
- external-chain costs can vary;
- honest participants have different incentives.

The correct conclusion is therefore:

> **the economic model identifies attack incentives; it does not by itself prove Sybil resistance.**

---

# 58. Patient capital

A patient attacker can optimize over partition duration.

Let:

```text
τ ~ F_τ
```

represent partition duration.

The relevant objective becomes an expected-profit problem:

```text
E[Profit(N, b, τ)]
```

rather than a single static calculation.

This is a future research target because the economically optimal identity strategy can depend on the distribution of partition duration.

---

# 59. Observability

A domain cannot infer global absence from local silence.

The distinction is:

```text
known locally
known after reconciliation
unknown
proven absent
```

These states must not be conflated.

A heartbeat can make silence observable as a protocol event, but cannot determine its cause.

No heartbeat can distinguish perfectly between:

- communication failure;
- node failure;
- intentional silence;
- power loss;
- route failure.

Observability is therefore a knowledge problem as much as a transport problem.

---

# 60. Commitment versus physical truth

A commitment can prove consistency relative to an anchor.

It cannot prove that the committed state corresponds to physical reality.

Conceptually:

```text
commitment integrity
       ≠
physical truth
```

An external oracle, sensor, chain or attestation mechanism can add evidence.

It also introduces new assumptions.

AIWA does not silently elevate a commitment into a proof of the physical world.

---

# PART IX — EXPERIMENTS, INVARIANTS AND EVIDENCE

# 61. Experimental methodology

The reference experiments are intentionally narrow.

They test concrete properties:

1. reordered and duplicated delivery converges to the same event set;
2. deliberately removing a stated invariant produces the predicted failure;
3. JS and Rust agree on shared scenarios;
4. conservation rejects duplicate consumption;
5. weak identity can fail when it omits an economically meaningful variable;
6. scarcity simulations match the reference calculations.

The experiments do not simulate a complete interplanetary economy.

A successful unit test is evidence for the tested implementation and input space, not a universal theorem.

---

# 62. Experiment: post-partition convergence

Two replicas independently construct local histories.

They then receive the other's events in different orders and with duplicate deliveries.

The target property is:

```text
H_A ∪ H_B
```

is identical regardless of delivery order.

The materialized state is then compared.

This tests:

- event identity;
- idempotent merge;
- canonical ordering;
- deterministic materialization.

It does not prove semantic consensus against Byzantine actors.

---

# 63. Experiment: deliberately broken wall clock

Control:

```text
q = cadence state
```

Broken variant:

```text
q = wall-clock-derived value
```

The same event set is evaluated at different times.

The broken implementation produces different economic results.

This demonstrates why wall-clock observation cannot be the authoritative input to deterministic materialization.

---

# 64. Experiment: non-atomic consume

The broken implementation separates:

```text
verify
```

from:

```text
consume
```

Two concurrent branches can both observe the proof as unused.

Both then consume it.

The failure is:

```text
count(Consume(p)) = 2
```

which violates the conservation invariant.

---

# 65. Experiment: weak identity

The weak identifier omits cadence.

Two events can therefore share an identifier even though their reward depends on different economic epochs.

The experiment confirms the general identity-sufficiency condition:

```text
identity may collapse events
only when the materialized semantics
are invariant under that collapse.
```

---

# 66. Experimental evidence

The reference project reports:

```text
416 JavaScript tests
238 Rust tests
shared parity vectors
cross-language signing parity
cross-language pool draw parity
```

The test suite also contains deliberately broken implementations.

This is evidence of engineering discipline.

It is not a claim of complete formal verification.

---

# 67. Protocol invariants

The principal invariants are:

### I1 — deterministic event identity

Equivalent canonical event data produces the same identifier.

### I2 — idempotent merge

Adding the same event twice does not create two economic effects.

### I3 — canonical materialization

The same converged event set is materialized in the same protocol-defined order.

### I4 — cadence monotonicity

Valid cadence transitions do not move backward or advance outside the permitted transition rule.

### I5 — conservation

A proof is consumed at most once.

### I6 — domain authorization

A transfer from domain `d` requires control of the public key whose hash is `d`.

### I7 — formula immutability

A formula identifier cannot silently change parameters.

### I8 — contract immutability

A release cannot replace the condition fixed at mint.

### I9 — module integrity

Mounted bytes must match the registered code hash.

### I10 — AI non-authority

AI-derived text cannot directly change protocol validity.

---

# PART X — OPEN RESEARCH AND CONCLUSION

# 68. Open problems

The following remain explicit research items.

## 68.1 Semantic convergence

Formalize when canonical ordering is sufficient and when stronger coordination is required.

## 68.2 Formal protocol specification

Translate the state transitions into TLA+, Isabelle/HOL or another mechanized formalism.

## 68.3 Fuzzing

Generate adversarial event DAGs, concurrent transfers, malformed conditions and transport reorderings.

## 68.4 Numeric semantics

Specify exact integer / decimal / floating-point behaviour across implementations.

## 68.5 Versioning

Define protocol version negotiation and backward-compatibility rules.

## 68.6 Conformance suite

Elevate shared vectors into a complete independent implementation conformance package.

## 68.7 Cadence economics

Quantify the maximum cadence advancement achievable under realistic heterogeneous hardware and identity counts.

## 68.8 Identity economics

Calibrate identity cost against expected deployment conditions and partition durations.

## 68.9 Browser security

Perform a dedicated security review of iframe, `postMessage`, resource limits and network-side channels.

## 68.10 Finality and intention formalization

Define observables and falsifiable mathematical hypotheses before making these concepts part of protocol semantics.

---

# 69. Design principles

1. **Treat non-synchronization as normal.**
2. **Treat synchronization as transmission and reconciliation, not automatically as consensus.**
3. **Replicate events, not derived balances.**
4. **Specify canonical identity and canonical order.**
5. **Never use wall-clock observation as an implicit economic authority.**
6. **Separate accrual from conservation.**
7. **Make scarcity explicit.**
8. **Do not call key control proof of human identity.**
9. **Do not call sequential hash work a true asymmetric VDF.**
10. **Do not call deterministic reconciliation Byzantine consensus.**
11. **Do not interpret silence as global absence.**
12. **Do not confuse economic behaviour with direct knowledge of human intention.**
13. **Do not give third-party modules elevated trust.**
14. **Fix contract conditions at mint time.**
15. **Keep AI structurally outside authoritative protocol decisions.**
16. **Use deliberately broken implementations as regression evidence.**
17. **Treat JS/Rust parity as an interoperability requirement.**
18. **State assumptions beside every security claim.**

---

# 70. Research participation

AIWA is designed to be challenged.

The most valuable external work includes:

- independent reimplementation;
- adversarial DAG generation;
- consensus counterexamples;
- economic attack simulations;
- formal verification;
- browser security analysis;
- fuzzing;
- numerical conformance testing;
- transport failure injection;
- external-chain assumption analysis;
- falsification of the finality and intention hypotheses.

A useful report should state:

```text
claim
assumptions
attacker capabilities
invariant
experiment
result
residual limitation
```

The project should become more credible by becoming easier to falsify.

---

# 71. Conclusion

AIWA proposes a specific architecture for a specific class of problem:

> **a useful distributed application should not require continuous communication merely to continue local operation.**

The architecture therefore makes local history primary:

```text
H_d
 │
 ▼
canonical materialization
 │
 ▼
A = G(H_d, θ)
```

Communication is then used to exchange histories rather than to maintain the permanent existence of a central authority.

The deeper conceptual observation is equally specific:

> **In a delay-tolerant environment, synchronization is better understood as a mode of transmission than as the default state of the system.**

From this follow several useful separations:

```text
non-observation ≠ absence
synchronization ≠ consensus
determinism ≠ semantic correctness
key control ≠ human identity
economic behaviour ≠ psychological intention
computational delay ≠ physical time
commitment ≠ physical truth
```

These distinctions are not rhetorical caveats. They define where the current architecture ends and where further research begins.

AIWA's contribution is therefore methodological as much as architectural:

> **make the system concrete enough that its invariants can be executed, its failures can be reproduced, its assumptions can be inspected, and its unresolved claims can be attacked independently.**

---








# 72. Forkability as a protocol property

Open-source availability establishes that source code can be copied. It does not by itself establish protocol independence.

AIWA uses **forkability** in a stronger sense:

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

A fork may deliberately diverge in interface, transport, modules, economics, or protocol rules. Forkability therefore does not require every fork to remain compatible.

The research target is that the public protocol boundary be explicit enough for a compatible independent implementation to reproduce protocol-relevant behaviour without treating the original implementation or operator as an authority.

For AIWA, relevant protocol-boundary material includes event identity, canonical encoding and ordering, signatures, deterministic materialization, causal verification, conservation, numeric semantics, versioning, and conformance vectors.

> **Forkability makes independent implementations possible; conformance establishes compatibility; interoperability is the property to be demonstrated.**

# 73. From decentralization to global interoperability

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
protocol conformance
       ↓
potential global interoperability
```

Here, **global** does not mean merely international. It means that the application protocol is not inherently bound to one server, one operator, one network, one terminal, or one implementation.

This remains a research direction. Interoperability must be demonstrated through independent implementations and cross-implementation conformance tests.

The broader interpretation is not that AIWA has eliminated coordination, but that some coordination may be shifted from continuous global operation into explicit history exchange, deterministic reconstruction, and protocol conformance.

# Appendix A — Notation

| Symbol | Meaning |
|---|---|
| `d` | domain |
| `H_d` | domain event history |
| `e` | event |
| `id(e)` | event identifier |
| `A` | materialized state |
| `G` | materialization function |
| `θ` | protocol parameters |
| `q` | cadence epoch |
| `b` | committed economic base |
| `T` | transition / temporal parameter used by reward |
| `B_d` | domain issuance budget |
| `c_id` | identity creation cost |
| `N` | number of identities |
| `C` | commitment / historical evidence value |

---

# Appendix B — Formal core

For each domain:

```text
State_d =
(H_d, A_d, C_d, B_d, i_d, q_d)
```

A valid event:

```text
Valid(e, H_d, θ, State_d) = true
```

is inserted as:

```text
H_d' = H_d ∪ {e}
```

The state is then:

```text
A_d' = G(H_d', θ)
```

Merge:

```text
Merge(H1, H2) = H1 ∪ H2
```

Cadence:

```text
q' = q + 1
```

subject to the deployment's bounded transition rule and proof requirements.

Conservation:

```text
count(Consume(p)) ≤ 1
```

Identity binding:

```text
domainId = SHA-256(publicKey)
```

Transfer authorization:

```text
VerifySignature(
    signerPubkey,
    signature,
    claimId,
    from,
    to,
    nonce,
    timestamp
)
```

and:

```text
SHA-256(signerPubkey) = from
```

---

# Appendix C — Scarcity policies

### C1 — Preallocated budget

```text
Issued_d ≤ B_d
```

Autonomy lasts until the allocation is exhausted.

### C2 — Rate limit

```text
ρ_d ≤ ρ_max
```

A rate limit alone does not imply finite lifetime supply.

### C3 — Expiring issuance rights

Rights carry an expiration condition.

This bounds simultaneous valid issuance but reduces indefinite autonomy.

### C4 — Scarce resources

Issuance is tied to a resource with an externally constrained acquisition cost.

### C5 — External authority

Issuance rights are periodically allocated by an authority.

This can strengthen supply control while weakening communication independence.

---

# Appendix D — Sybil model

For fixed capital `B`:

```text
b = B/N
```

and simplified reward:

```text
R_N
=
K · B^α · t^β · N^(1−α)
```

With identity cost:

```text
Profit(N)
=
R_N − N · c_id
```

For:

```text
0 < α < 1
```

the stationary point is:

```text
N*
=
[
K · B^α · t^β · (1−α)
/
c_id
]^(1/α)
```

The model is conditional on its assumptions.

---

# Appendix E — Threat-to-guarantee matrix

| Threat | Relevant mechanism | Residual question |
|---|---|---|
| Replay | event id / nonce | malformed cross-layer replay |
| Duplicate merge | set union | resource exhaustion |
| Forged transfer | Ed25519 + domain binding | key compromise |
| Double spend | atomic consumption | implementation correctness |
| Code swap | content hash | browser compromise |
| Condition smuggling | immutable contract | condition language correctness |
| Sybil | identity cost | parameter calibration |
| Cadence acceleration | sequential chain | hardware heterogeneity |
| Wall-clock manipulation | cadence state | UI/transport clock misuse |
| Malicious module | iframe sandbox | browser/resource attacks |
| Merge conflict | canonical ordering | semantic consensus |
| External burn forgery | transaction verification | chain/RPC assumptions |

---

# Appendix F — Reproducibility checklist

- [x] Event history explicitly modeled.
- [x] Canonical event identity specified.
- [x] Merge operator specified.
- [x] Canonical materialization order specified.
- [x] Persistence implemented.
- [x] Reward function implemented.
- [x] Formula registry implemented.
- [x] Scarcity simulation implemented.
- [x] Cadence proof implemented.
- [x] Conservation state machine implemented.
- [x] Transfer signature verification implemented.
- [x] Identity registration implemented.
- [x] Module content addressing implemented.
- [x] Signed module submission implemented.
- [x] Sandbox runner implemented.
- [x] Delay-tolerant transport implemented.
- [x] Generic causal conditions implemented.
- [x] Generic contracts implemented.
- [x] Pool draw parity implemented.
- [x] JS/Rust parity implemented.
- [x] Deliberately broken counterexamples retained.
- [ ] Full formal conformance suite.
- [ ] Formal consensus proof.
- [ ] Complete browser security proof.
- [ ] Protocol numeric semantics finalized.
- [ ] Protocol versioning finalized.
- [ ] Full quantitative Sybil calibration.
- [ ] Finality/intention hypotheses formally defined.

---

# Appendix G — Reference implementation map

| Concern | JS | Rust |
|---|---|---|
| Event DAG | `event-dag.js` | `dag.rs` / `event.rs` / `core.rs` |
| Economics | `economics/` | `economics/` |
| Conservation | `conservation/` | `conservation/` |
| Identity | `identity/` | `identity/` |
| Modules | `modules/` | `modules/` |
| Pools | `pool/pool-reducer.js` | `pool_reducer.rs` |
| Generic contracts | `generic-contract-reducer.js` | `generic_contract_reducer.rs` |
| Composable verification | `causal-condition-evaluator.js` | `causal_condition_evaluator.rs` |
| Public profile / hyperprofile | `profile/public-profile-reducer.js` | `public_profile_reducer.rs` |

---

# Appendix H — Evidence categories

AIWA distinguishes three evidence classes.

## H1 — Implementation evidence

A behaviour is exercised by the reference implementation and tests.

## H2 — Cross-language evidence

The same vector or scenario is evaluated by JS and Rust and compared.

## H3 — Analytical evidence

A property follows from a mathematical derivation under explicitly stated assumptions.

None of these classes should be silently upgraded into a stronger claim.

For example:

```text
tested convergence
```

does not become:

```text
Byzantine consensus proven
```

and:

```text
burn transaction verified
```

does not become:

```text
human identity proven
```

---

# Appendix I — Final status

AIWA is a credible research implementation to the extent that it makes concrete, reproducible and attackable claims.

Its strongest established properties are implementation-level:

- explicit event identity;
- idempotent history merge;
- canonical materialization;
- separated conservation;
- cryptographic transfer authorization;
- immutable formulas and contract conditions;
- content-addressed modules;
- delay-tolerant transport;
- JS/Rust parity;
- explicit counterexamples.

Its strongest unresolved question is architectural:

> **what additional mechanism, if any, is required when deterministic reconciliation is not sufficient to establish semantic agreement over concurrent adversarial actions?**

Its newer conceptual vocabulary around finality, silence, intention and impatience should remain a research programme until those quantities are given precise observables and falsifiable definitions.

That boundary is intentional.

# 74. Research context and related work

AIWA should be read as a composition and implementation experiment rather than as a claim that its individual building blocks are unprecedented.

### 70.1 Event history and replay

The idea of deriving application state by processing a durable sequence of events is established in the event-sourcing literature. Fowler describes event sourcing as capturing application-state changes as events and rebuilding state by replaying them. [1]

AIWA's contribution is not the invention of event sourcing. The project applies an explicit event-history model to a delay-tolerant, cryptographically identified, independently materialized application protocol.

### 70.2 Replication and convergence

CRDT research provides a formal body of work on replicated data whose operations or states satisfy conditions sufficient for convergence under asynchronous replication. Shapiro et al. explicitly study convergent and commutative replicated data types, including graphs and monotonic DAGs. [2,3]

AIWA should therefore avoid claiming that "DAG + deterministic merge" by itself introduces a new convergence theory. Its specific contribution is the combination of its event identity, materialization rules, economic/authorization invariants and application mechanisms.

### 70.3 Delay-Tolerant Networking

The delay-tolerant networking literature directly motivates AIWA's treatment of intermittent connectivity. RFC 4838 describes a DTN architecture for networks in which conventional Internet-like approaches may be impractical and explicitly describes store-and-forward message operation. [4]

AIWA's transport layer is an application/protocol implementation choice within that broader problem space; it is not a replacement for the DTN architecture literature.

### 70.4 Causal ordering

Lamport's work on logical clocks established the foundational distinction between physical time and the ordering induced by distributed events. [5]

This is directly relevant to AIWA's insistence that protocol ordering cannot silently depend on a node's local wall clock.

### 70.5 Content addressing and Merkle DAGs

IPFS provides a well-known example of content-addressed, versioned peer-to-peer data and describes a generalized Merkle DAG as a basis for versioned data structures. [6]

AIWA's event identity and DAG should therefore be presented as a protocol-specific use of content-addressed history, not as an invention of content addressing itself.

### 70.6 Verifiable delay functions

The literature on verifiable delay functions provides a formal cryptographic notion of publicly verifiable sequential computation. [7]

AIWA's sequential SHA-256 cadence mechanism should not be equated with a VDF unless the stronger properties required by that literature are actually implemented and demonstrated.

### 70.7 WebRTC and browser peer transport

WebRTC standardizes browser APIs and protocols for real-time peer-to-peer communication. [8]

AIWA uses browser peer transport as one transport mechanism; the transport itself is not the source of protocol truth.

### 70.8 Public protocol interoperability

The literature above establishes the ingredients and neighboring problem areas. AIWA's broader hypothesis is narrower and more architectural:

```text
explicit public semantics
        +
canonical protocol objects
        +
independent implementations
        +
conformance testing
        ↓
potential interoperability
```

That proposition should be evaluated experimentally through an independent implementation and cross-implementation conformance tests.

---

---

# References

**[1]** Martin Fowler. *Event Sourcing*. 2005. Describes the event-sourcing pattern in which application changes are captured as events and application state can be rebuilt by replaying those events. citeturn0search0

**[2]** Marc Shapiro, Nuno Preguiça, Carlos Baquero, Marek Zawirski. *A comprehensive study of Convergent and Commutative Replicated Data Types*. INRIA Research Report RR-7506, 2011. Formal treatment of asynchronous replicated data types and conditions supporting convergence. citeturn0search36turn0search9

**[3]** Marc Shapiro, Nuno Preguiça, Carlos Baquero, Marek Zawirski. *Conflict-free Replicated Data Types*. SSS 2011, LNCS 6976, pp. 386–400. DOI: 10.1007/978-3-642-24550-3_29. citeturn0search5turn0search39

**[4]** V. Cerf, S. Burleigh, A. Hooke, L. Torgerson, R. Durst, K. Scott, J. Fall, H. Weiss. *Delay-Tolerant Networking Architecture*. RFC 4838, April 2007. citeturn0search1

**[5]** Leslie Lamport. *Time, Clocks, and the Ordering of Events in a Distributed System*. Communications of the ACM, 21(7), 1978, pp. 558–565. citeturn0search38

**[6]** Juan Benet. *IPFS — Content Addressed, Versioned, P2P File System*. arXiv:1407.3561, 2014. citeturn0academia37

**[7]** Dan Boneh, Joseph Bonneau, Benedikt Bünz, Ben Fisch. *Verifiable Delay Functions*. In *Advances in Cryptology — CRYPTO 2018*, 2018. This is the relevant literature for distinguishing sequential-delay mechanisms from formal VDF constructions.

**[8]** World Wide Web Consortium (W3C). *WebRTC 1.0: Real-Time Communication Between Browsers*. W3C Recommendation. This is the standards context for browser peer-to-peer transport.

---

## How to read these references

These references are **contextual and comparative**, not evidence that AIWA implements every mechanism described in them.

In particular:

- event sourcing [1] is prior art for history-derived state;
- CRDT work [2,3] is prior art for asynchronous replication and convergence;
- DTN [4] is the broader networking context;
- Lamport [5] provides foundational distributed-ordering context;
- IPFS [6] provides related content-addressed DAG architecture;
- VDF literature [7] is a boundary condition for what AIWA's sequential SHA-256 mechanism should and should not be called;
- WebRTC [8] provides the browser transport standards context.

AIWA's novelty claims, if any, should therefore concern the **specific composition, protocol semantics, invariants, implementation and interoperability hypothesis**, rather than the invention of these underlying fields.
