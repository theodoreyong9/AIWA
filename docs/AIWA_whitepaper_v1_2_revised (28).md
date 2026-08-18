AIWA: Autonomous Interplanetary Web Application

A Reference Architecture for Identity, Modular Applications, and Value Accrual Under Arbitrarily Long Communication Partition

Abstract

An interplanetary application platform cannot assume continuous communication between the domains it runs on. Between Earth and Mars, one-way propagation delay alone runs from roughly 3 to 22 minutes depending on orbital position, and full communication blackouts of one to several weeks occur periodically during solar conjunction — a fact of orbital mechanics, not a protocol parameter. Any system whose correctness depends on global ordering, continuous voting, or timely message delivery breaks the moment that assumption is violated, and it is violated by construction, not by failure.

AIWA (Autonomous Interplanetary Web Application) is a browser-native application platform designed around this constraint from the ground up. It is not a single algorithm; it is a layered architecture with seven components — transport, identity, ledger, economic policy, sandboxed third-party

modules, an advisory AI layer, and presentation — each with an explicit answer to the question: what does this component require to keep making progress when it cannot reach the rest of the network at all, for an unknown length of time?

The paper makes six contributions. First, a formal separation of four functions that are routinely conflated in monetary and coordination protocols: conservation (moving existing claims), accrual (creating new state), evidence (cryptographically committing to history), and observability (what a domain can infer from silence). Second, a state-based ledger construction in which replicated state is a grow-only set of uniquely identified events and all economic meaning is a deterministic materialized view over that set — never a raw mutable balance. Third, a proved impossibility result (Proposition 1) establishing that unrestricted autonomous issuance, independent per- domain operation, full retention of locally valid state, and a fixed global supply bound cannot coexist under arbitrarily long partition, together with a precise statement of where the escape hatches are. Fourth, a general identity-sufficiency lemma (Lemma 1) that tells a module author exactly how strong an event identifier needs to be, given their own reward function — no stronger, no weaker. Fifth, a cost-explicit economic-security model for Sybil and patient-capital attacks that goes beyond a bare reward-concavity argument, deriving a finite optimal split size even in the reward regime where concavity alone gives no bound at all, and connecting attacker profit directly to partition duration. Sixth, a working reference implementation of the tested ledger primitives and a specified seven-layer architecture — with executable experiments whose results are reported in full in this document. The implementation does not yet establish the complete security boundary of every layer.

AIWA does not claim to have solved interplanetary coordination completely. Sybil resistance is partial and cost- conditional, not absolute; cadence integrity, physical truth of committed claims, and machine-checked formal verification remain open and are stated as such throughout, in the same place the paper makes every other claim — not deferred to a disclaimer at the end.

Version 1.1 revision note

This revision makes one architectural refinement explicit throughout the
paper: economic time is derived from the mandatory protocol cadence rather
than from an unconstrained local wall clock. The change does not remove the
partition-issuance impossibility result and does not create a scarcity bound
by itself. It removes the unnecessary wall-clock dependency from economic
accrual and replaces it with a protocol-level cadence-integrity requirement.

Version 1.2 revision note

This revision adds one finding from the multi-language reference
implementation (§8.1): the event identifier id(e) = H(d, c, payload) is
only well-defined once "H" operates on a canonical byte encoding of its
input, not on whichever serialization a given client implementation
happens to produce. This distinction is invisible for scalar payloads and
load-bearing for structured ones. It was found, not anticipated: two
conforming client implementations (JavaScript, Rust) initially produced
different ids for the same logical event because they disagreed on
object-key ordering before hashing. The divergence is fixed in the
reference implementation and is now checked by a permanent
cross-implementation test-vector set rather than merely asserted (Appendix
J.4). The paper does not yet promote this fix to a specified part of the
wire protocol — that gap is recorded as open work (§29.9). This revision
adds no new mechanism and changes no existing result; it tightens the
identity contract of §8 to match what the reference implementation
actually requires to stay correct across languages.

Also in this revision: the reference implementation's economic layer
(§9–13) now has two additional independent implementations (JavaScript,
Rust) of the reward function and the §13.1 scarcity policy, cross-checked
directly against Appendix D.1, D.2, and H.4's reported numbers rather
than merely re-asserted — see Appendix H.6. A pre-existing citation
inconsistency is also corrected here: the main text previously cited
"Appendix J.1–J.3" for the experiments of §20–22, while only an
"Appendix H" was ever defined; all such citations now correctly read
H.1–H.3.

A second implementation-driven finding is recorded as new §9.1 and
§29.10: building the full composed G(H_d, θ) across two languages
surfaced that §9's "deterministic function of the converged event set"
condition, while correct, under-specifies what two independent
implementations need to agree on an accrual event's cadence-derived q
under concurrent (non-strictly-ordered) branches of the DAG. The two
reference implementations agree only because they share the same
canonical tie-breaking rule for topological order; nothing in the
protocol as specified requires a third implementation to choose the same
one. Evidence in Appendix H.7. Like §8.1's finding, this changes no
existing result and adds no new mechanism — it tightens what "deterministic"
in §9 must mean for cross-implementation interoperability, and records
the gap as open work rather than silently relying on implementation
coincidence.

Two further additions in this revision, both concrete mechanisms
answering questions this paper previously left open in principle only.
§24.6(v) and Appendix H.10 add a fifth identity-cost (c_id) mechanism
class, alongside the four already discussed in prose: a real,
irrecoverable burn on an external chain (implemented against Solana),
chosen over bonded staking for the same enforcement-under-partition
weakness §24.6(i) already states about itself, with the deployment
network (real value vs. free test currency) stated as the mechanism's
actual validity condition rather than a configuration footnote. §27.4
and Appendix H.11 give module sandboxing (§27.1) a concrete enforcement
mechanism — a real isolated iframe, plus content-addressed module code
closing the same "judgment applies to a fixed version, not a mutable
URL" gap §8.1 closed for ledger events — and update R19 in Appendix E's
security property registry from "unconfirmed" to "specified and
implemented, not yet adversarially tested," which is the accurate
current status, neither overclaimed nor understated.

1. Introduction

A terrestrial distributed application normally assumes some baseline of communication between its participants: requests reach a server, transactions propagate to validators, votes are collected within a bounded timeout, conflicting states can eventually be compared and reconciled. An interplanetary application violates these assumptions at the physical layer, not as an edge case but as its normal operating condition.

The problem is not merely added latency — a design can often absorb extra latency by widening timeouts or lengthening confirmation windows. The harder problem is that two domains can become mutually unreachable for an interval whose duration the protocol does not control. During that interval, an Earth-based relay cannot know what a Mars-based settlement has done locally, and vice versa. A design that requires global knowledge to make progress cannot simultaneously offer continuous local operation, communication independence, unrestricted local activity, and a globally fixed resource bound — something has to give, and a well-built system says explicitly what.

AIWA's answer is to stop treating "the interplanetary problem" as one problem and split it into components whose failure modes are genuinely independent:

Conservation ≠ Accrual ≠ Evidence ≠ Observability ≠ Extensibility ≠ Presentation.

A wallet can safely move an existing balance without solving autonomous issuance. A replicated data structure can guarantee convergence without guaranteeing economic conservation. A cryptographic commitment can guarantee tamper-evidence without proving that the committed event physically happened. A heartbeat can increase confidence about a silent domain while simultaneously reintroducing the communication dependency the whole design exists to avoid. A third-party module can extend the platform without being trusted with money, other users' data, or the network stack. AIWA's seven layers exist because collapsing these into one mechanism — "the blockchain," "the AI," "the app" — is exactly how systems quietly inherit assumptions they never checked.

This paper is organized to make that checking possible. Sections 5–17 give the formal core: system model, the four- function separation, the ledger construction, the impossibility result, the identity lemma, and the economic-security model. Sections 18–23 report executable experiments against a working reference implementation, with real output, not illustrative numbers. Sections 24–28 extend the core into a reference platform architecture: the economic-security model, module system, advisory AI layer, transport and identity layers, and the full security-property registry. Section 29 states what remains open, in the same register as everything else in the paper.

2. Research Question

What guarantees — for coordination, identity, extensibility, and value accrual — are jointly achievable in a browser- native application platform whose domains must remain autonomous during arbitrarily long communication partitions, and how should such a platform be built so that every guarantee it does not achieve is stated rather than implied?

Six properties are considered throughout: A — partition autonomy (a domain keeps working with zero remote state); B — bounded issuance (total value creation is subject to an explicit, checkable bound); E — evidence (historical claims can be committed to and later checked for tampering); S — economic identity resistance (splitting into multiple identities cannot trivially multiply reward); R — reconciliation (domains merge deterministically once contact resumes); X — extensibility without elevated trust (third-party code can extend the platform without being implicitly trusted with security- critical decisions). The goal is not to maximize all six at once — several are in direct tension — but to identify exactly where the tensions are and let a deployment choose consciously rather than by default.

3. Contributions, in Detail

3.1 Separation of replicated state from economic meaning. Every AIWA domain's ledger state is a set of uniquely identified events, H_d ; economic meaning is a deterministic materialized view A_d = G(H_d, θ) computed over that set. A scalar balance is never itself the replicated object — this

single design choice is what makes convergence provable rather than merely hoped for (§9).

3.2 A proved impossibility result for autonomous issuance. For any set of domains whose issuance rates are bounded away from zero, unrestricted autonomy, independent per- domain decisions, full retention of locally valid issuance, and a fixed global supply bound are jointly incompatible under arbitrarily long partition (Proposition 1, §12). The result is stated precisely as what kind of result it is: a short, checkable consequence of a stated set of economic assumptions, not a deep distributed-systems impossibility theorem — its value is in pinning down exactly which assumption has to give, not in its proof difficulty.

3.3 An identity-sufficiency lemma usable by any module author. Lemma 1 (§11) gives an exact, checkable condition for when a coarse (cheap) event identifier is safe for a given reward function, and when it must be replaced by a finer one. This turns "how strong should identity be" from a guess into a per-module calculation.

3.4 Executable validation, not assertion. Sections 18–22 report five experiments run against a working reference implementation of the tested ledger primitives: convergence under adversarial delivery, four deliberately broken invariants (with real counterexamples), and a direct empirical confirmation of Lemma 1 on a concrete reward function. All numbers reported are the actual output of the code in Appendix H, run at the time of writing.

3.5 A cost-explicit Sybil and patient-capital model. §24 shows that reward curvature alone — and, specifically, the mistaken assumption that a diminishing-returns reward function automatically discourages splitting into

many identities — is not sufficient once the reward exponent is chosen for distributional reasons (to avoid rewarding large depositors disproportionately). In that regime, concavity gives no bound at all, and it is identity-creation cost, made explicit and given a growth condition, that does the actual work. The model further connects attacker profit directly to partition duration, since reward accrues over the unobserved partition length while identity and capital costs are sunk near its start.

3.6 A reference seven-layer architecture. §25–28 extend the ledger core into transport, identity, sandboxed third-party modules, and an advisory AI layer, each with the same discipline: what is guaranteed, what is assumed, and what is explicitly out of scope.

4. Related Work

Distributed ordering is fundamentally constrained by causality: independently occurring events need not have a globally known total order, a fact formalized by Lamport's happens- before relation and inherited directly by any system, including AIWA, that refuses to assume a global clock. Conflict-free replicated data types provide a framework for replicated state whose merge operation is associative, commutative, and idempotent (Shapiro et al., 2011); AIWA's ledger applies this framework rather than inventing a new one, and its contribution is in what is built around it, not the merge operation itself. The CALM theorem (Hellerstein & Alvaro) establishes conditions under which coordination-free computation preserves consistency; AIWA's complementary question is what happens to a monetary supply specifically when value creation itself is decentralized, given that

coordination-free convergence of the replicated state is achievable.

Cryptographic commitment chains (Haber & Stornetta, 1991)
provide tamper-evident historical structure without
establishing that a committed event corresponds to a physical
event — AIWA's evidence layer (§16) uses exactly this
mechanism and states exactly this limitation. Delay-tolerant
networking standards (the Bundle Protocol lineage, RFC 9171
and successors) describe store-and-forward transport suitable
for intermittent, high-delay links without themselves defining
application-level validity — AIWA's pluggable transport layer
(§25) is designed to accept such a backend without any
change to the layers above it. The classical Sybil-attack
framing (Douceur, 2002) motivates AIWA's cost-explicit
economic-security treatment (§24); that literature generally
assumes a fixed identity-creation cost floor, an assumption
AIWA makes explicit and interrogates rather than leaving
implicit. Machine-checked verification of replicated data type
implementations (Gomes et al., 2017) provides a natural, and
currently unexecuted, next step beyond the executable
experiments reported here (§29.4).

5. System Model

Let D = {d₁, d₂, …} be the set of AIWA domains — a domain is any device, installation, or settlement running the AIWA runtime with its own local storage and its own keypair-derived identity. Each domain maintains local state:

State_d = (H_d, A_d, C_d, B_d, θ_d)

H_d is the domain's accepted event set (§8); A_d = G(H_d, θ_d) is the materialized economic view; C_d is the domain's latest historical commitment (§16); B_d is its local issuance constraint (§13); θ_d are its declared economic parameters (§24.1). Communication between two domains is modeled as C(t) ∈ {0,1} ; a partition is any interval with C(t) = 0 . AIWA's core structural requirement is that no layer at or below the ledger may require C(t) = 1 to make local progress:

∂State_E / ∂State_M = 0 and ∂State_M / ∂State_E = 0 during any partition.

This does not imply that State_E and State_M agree with each other during the partition — only that neither depends on the other to keep evolving locally. Full notation is tabulated in Appendix A.

6. Six Different Problems Routinely Conflated Into One

6.1 Conservation. A transfer moves ownership of an existing claim, x_A → x_B , without creating a new unit. A transmutation converts x_A → y_B subject to an authorized derivation function f . Neither creates value; both require that the same claim cannot be consumed twice.

6.2 Accrual. S_d(t+Δ) = F(S_d(t), E_d, θ) — new monetary state created from a domain's own local activity, with no existing object consumed. This is structurally different from conservation and requires a different mechanism (§8), not a variant of the same one.

6.3 Evidence. C_n = H(protocol, genesis, d, n, C_{n−1}, A_n) — a commitment that makes retroactive modification of a domain's accepted history detectable. It does not, on its own, establish that the underlying event physically occurred.

6.4 Observability. A mandatory heartbeat turns silence into a protocol-visible event, but cannot by itself determine the cause of silence (blackout, routing failure, node failure, malicious suppression, congestion, clock failure). Silence is not the same thing as any particular cause.

6.5 Extensibility. Third-party code should be able to add features — a game, a dashboard, a trading interface — without that code being trusted with money movement, other users' data, or the transport layer. This is an access-control problem, orthogonal to the four above, and AIWA treats it as its own layer (§27) rather than folding it into "security" generically.

6.6 Presentation. What a user sees and how they interact with it should be swappable independently of everything above — a design constraint that turns out to matter for interplanetary deployments specifically, since a settlement with limited bandwidth or specialized hardware may need a radically different interface to the same underlying state.

7. Conservation: Proof-Carrying Transfer

Deactivate → Prove → Verify → Consume → Activate

A transfer proof p = Proof(x, A, B, n, θ, f) binds source, destination, a unique identifier, finality evidence, protocol parameters, and the derivation function in use. The load- bearing invariant is:

count(Consume(p)) ≤ 1

Verification and consumption must be crash-safe and replay- resistant: a proof that can be verified twice but consumed twice is not a conservation mechanism, it is a double-spend waiting for the right crash window. AIWA's wallet layer implements this invariant with a persisted consumption record checked atomically before any state transition is applied (Appendix B's reference pseudocode, the "Wallet consumption guard (§7)" block — not Appendix B.7, which is a distinct mechanism, the merge-identifier replay guard; executable confirmation of this section's invariant, including a deliberately non-atomic counterexample, is in Appendix H.9). This pipeline moves an existing claim; it says nothing by itself about how a claim comes to exist from accrual (§8–10) in the first place, or how a domain's balance and its spendable claims relate — that bridge, absent through several revisions of this reference implementation despite the mechanism above being real and tested, is given a concrete answer in Appendix H.16: a domain converts part of its accrued balance into a claim, then transfers it, both as ordinary DAG events folded exactly like every other event type in this paper, not a parallel mechanism bolted on beside H_d.

A real vulnerability was found in that bridge, not a hypothetical one, by asking one precise question about what "from" in a transfer actually proves. It initially proved nothing: ownership was checked as claim.owner == from, a plain string comparison, with nothing verifying that whoever wrote the transfer event controlled the private key behind that domain id. Anyone able to add an event to H_d — which, after reconciliation, is every domain that has ever merged with the victim — could forge a transfer stealing any claim by writing the victim's domain id into the from field. This is now closed: a transfer event must carry an Ed25519 signature over (claimId, from, to, nonce, timestamp), and the fold verifies both that the signature is valid for the declared signerPubkey and that hashing that exact public key reproduces the claimed from domain id (§26's domain-id derivation) — proof of control, not a declaration of identity. A nonce-based replay guard, mirroring §7's own consumption guard, prevents the identical signed transfer from being reapplied. Executable detail, including the specific forged-transfer case reproduced and confirmed rejected, is in Appendix H.18.

8. Autonomous Accrual as a Replicated Data Type

Each accrual event is e = (d, c, b, id, θ) where id(e) = H(d, c, payload) using a full-width cryptographic hash — never truncated, since a truncated identifier reintroduces exactly the collision risk the identity-sufficiency argument in §11 is built to reason about precisely.

Replicated state is a set: H_d = {e₁, …, eₙ} . Local insertion is H_d' = H_d ∪ {e} . Merge across domains is set union: H_E ⊔ H_M = H_E ∪ H_M . Set union is idempotent ( H ∪ H = H ); a raw scalar total is not itself an idempotent replicated state — merging the same scalar contribution twice changes the result ( 100 + 100 = 200 ≠ 100 ). This is not a claim that addition is incompatible with replicated data types in general — an accumulator construction can use addition inside a materialized view while keeping the replicated state itself a per-source, monotonically-tracked structure. The requirement is narrower: addition may appear inside G (§9), provided the replicated state H retains enough per-event identity that a

duplicate delivery is recognized and discarded before contributing to the sum. This is exactly the role event identity plays in §11, and exactly what fails when it is removed (§20, variant V1).

8.1 Canonical encoding is part of the identity contract, not an implementation detail. H in id(e) = H(d, c, payload) is only well-defined once it is understood to operate on a canonical byte encoding of (d, c, payload), not on whichever serialization a given implementation happens to produce. For a scalar payload this distinction is invisible; for a structured payload — the common case once modules attach arbitrary event metadata (§27.2) — it is not: two conforming implementations that serialize the same logical value with object keys in a different order produce different hash inputs, and therefore different ids for what the protocol intends to be the same event, silently breaking the deduplication-by-identity that this section's set-union merge and Lemma 1 (§11) both depend on. This is not hypothetical. The reference implementation's two client-side encodings (JavaScript, Rust) initially diverged on exactly this case: Rust's default JSON value type canonicalizes object keys, JavaScript's JSON.stringify does not. The fix — recursive key-sorting applied identically before hashing on both sides — is verified against a fixed cross-implementation test-vector set covering nested payloads, arrays, and unsorted parent lists (Appendix H.5), not merely asserted to work. What this revision does not do is promote that fix to a specified part of the wire protocol: the paper still does not mandate a specific canonical encoding (e.g. a deterministic CBOR profile, or an explicit key-ordering rule in the event's byte representation), which means canonicalization remains a convention each implementation must independently get right rather than a checkable protocol requirement — exactly the kind of implicit, unchecked assumption §1 argues against inheriting. Recorded as open work in §29.9.

8.2 H_d must survive the process that holds it, not only the domains it survives partition from. A question asked directly named a real gap this section's own framing had not made explicit: does H_d — the replicated event set this paper spends this much rigor establishing convergence properties for — actually persist anywhere durable, or does it exist only for the lifetime of whichever process currently holds it in memory? In an earlier revision of the reference implementation, the honest answer was the second one: H_d lived in a plain in-memory structure, and unlocking a previously-created wallet reconstructed an empty ledger from scratch, same domain id, zero history, indistinguishable from a domain that had never done anything at all. Only the wallet key itself (browser localStorage) survived a closed tab; every cadence advance, every accrual, every burn's resulting identity registration, every minted formula, every registered module, every transfer sent or received, existed nowhere but a JavaScript variable. This is not merely inconvenient — for a paper whose central thesis is partition autonomy under arbitrarily long communication loss, failing to survive the mundane case of a closed browser tab on the SAME machine is a sharper version of the same failure mode §2's own G1 requirement exists to rule out, just applied to time instead of distance.

Closed with durable per-domain storage (event-dag-persistence.js), added to the reference implementation's browser client specifically, not a protocol-level requirement this paper imposes on every deployment — a domain running on infrastructure with its own durability guarantees (a server process backed by a real database, for instance) needs no equivalent. Every event a domain's own H_d ever accepts, whether through direct local insertion or through merge() pulling in another domain's history, is written durably the moment it is accepted, via a subscription mechanism (EventDag's own subscribe(), §8) that cannot miss an event by construction — persistence observes the DAG's own insertion point directly, not a separate call site every future accrual/module/formula/transfer code path would need to remember to invoke correctly. On restart, every previously-accepted event is replayed back through the same content-addressed addEvent() function that first accepted it, recomputing each event's id from its own parents and payload rather than trusting whatever was read from storage — the same recompute-don't-trust discipline this paper applies to hashes and signatures elsewhere, extended to storage as a source an implementation should not simply believe either. Recovering which event was this domain's own current tip — the parent every subsequent locally-authored event chains from — is recovered from the domain's own materialized cadence state (§10's own per-domain lastId), not reset to genesis, which would silently orphan an entire recovered history the moment the very next local action tried to extend it.

Verified directly, across two independently constructed sessions simulating a closed-and-reopened browser tab, not asserted from the persistence mechanism's own internal logic alone: a domain that accrues real value across several real cadence advances in one session is confirmed, in a wholly separate session against the same underlying storage, to recover the identical event count, the identical materialized balance, and the identical cadence epoch — and confirmed able to correctly extend that recovered history with a new event afterward, chaining from the true recovered tip rather than genesis, without ever encountering an unknown-parent rejection. Executable detail, including the specific numeric values checked, is in Appendix H.25.

9. Replicated State Is Not the Economic View

A = G(H, θ) . Convergence of H (i.e. H_E = H_M ) does not automatically imply convergence of A — that additionally requires G to be a deterministic function of the converged event set alone. If G depends on receipt order, local execution history, mutable external state, or information discarded by the event-identity scheme, the event set can converge while the materialized economic state does not. This distinction is one of AIWA's central design requirements, and §21 tests it directly by breaking it on purpose.

9.1 "A deterministic function of the set" needs a specified canonical order, not just any topological one. This is not a restatement of the paragraph above — it is a sharper condition the reference implementation exposed by construction, not by design. A cadence-derived q (§10) is read from the domain's current epoch *as folded so far* at the point an accrual event is processed. For events with no strict ancestor relationship in the DAG — an accrual event and a later cadence event that both descend from some common but non-adjacent ancestor — more than one topological order of H is valid, and different valid orders can fold that cadence event before or after the accrual event, changing which q the accrual event receives, and therefore its reward. Concretely: in the reference implementation's shared test fixture (Appendix H.7), an accrual event with q_0 = 0, whose only direct parent is a cadence event at epoch 2, is folded only after a later, unrelated epoch-3 cadence event — because that epoch-3 event was pulled earlier in the canonical order by an unrelated descendant with a lexicographically smaller id. The accrual event legitimately receives q = 3, not q = 2. This is not a bug: both orderings are valid topological sorts of the same converged H, and the result is fully deterministic *given a specific tie-breaking rule* — id-sorted depth-first traversal, in this implementation (Appendix B's reference pseudocode, and public/js/core/event-dag.js / rust-core/src/core.rs's topo_order()). The point this section adds to §9's requirement: "G is a deterministic function of the converged event set" is necessary but not sufficient for two independent implementations to agree. Each could independently satisfy it — each internally deterministic, each depending only on the set — while disagreeing with each other, because they chose different (both individually valid) canonical tie-breaking rules for turning a set of parent-linked events into one order. §8.1 made this argument for the byte encoding hashed into an event's identity; the same argument applies to the function that orders events for folding. Materialization order is therefore part of the identity/consensus contract in the same sense canonical encoding is, and is currently fixed only by matching reference-implementation behavior across two languages (Appendix H.7), not by an explicit protocol-level specification. Recorded as open work alongside §29.9.

9.2 The consensus contract, compiled and honestly scoped: what is normative today and what is not. §8.1 and §9.1 each found a real cross-implementation divergence and each closed it — but closed it as a fact about how this reference implementation's two languages happen to agree, not as a specification a third, independent implementation could read and conform to without inspecting this project's source. That distinction — two implementations agreeing is empirical evidence a workable convention exists, not proof the protocol itself specifies it — was named directly and is worth answering with a single compiled account rather than leaving the pieces scattered across §8.1, §9.1, and Appendix H, each individually honest but collectively easy to underestimate. What a complete consensus contract needs, and this paper's current status against each:

(i) Canonical event encoding. Closed as an implementation fact, open as a specification. Both reference implementations recursively sort object keys at every nesting depth before serializing (d, c, payload) for hashing, verified against a shared cross-language test-vector set (Appendix H.5). Not specified: a normative byte-encoding format (a deterministic CBOR profile per RFC 8949, or an explicit JSON canonicalization scheme such as JCS/RFC 8785) that a third implementation could conform to directly, rather than independently reverse-engineering "sort keys recursively, then JSON-serialize" from this paper's prose.

(ii) Canonical parent ordering. Closed, more completely than the other items here. Both implementations sort an event's parent-id list before it enters the hash input (public/js/core/event-dag.js and rust-core/src/core.rs's computeId()/compute_id()) — the SET of parents determines an event's id, never the order they were originally supplied in. This one component of the contract is already specified precisely enough in this paper's own reference pseudocode (Appendix B) that "sort parent ids lexicographically before hashing" is a complete, implementable instruction, not merely an observed convention.

(iii) Canonical topological ordering for materialization. Closed as an implementation fact (id-sorted depth-first traversal, §9.1), open as a specification in the same sense as (i): the tie-breaking rule is documented in prose and matched across two languages (Appendix H.7), not stated as a protocol-level requirement independent of this reference implementation's own source.

(iv) Numeric semantics. Open, and not previously named as its own item — found while compiling this section, not before. Every quantity this paper's formulas operate on (b, q, q_total, T, and θ's own parameters) is an IEEE 754 double-precision float in both reference implementations (JavaScript's native number type; Rust's f64), and reward.js/reward.rs's own test suites confirm the two agree to the last bit for the specific values tested (Appendix H.14) — but nothing in this paper specifies that a conforming implementation MUST use this representation, states how values outside safely-representable integer range should behave, or specifies rounding/formatting behavior for the JSON number literals that cross the wire when an event's payload is serialized for hashing. Two implementations both choosing IEEE 754 doubles and agreeing on the tested cases is the same category of evidence as (i) and (iii): informative, not normative.

(v) Versioning. Not specified at all. This paper has no field, event type, or convention by which a domain declares which revision of the protocol's rules — this revision's Proof-of-Will formula versus an earlier power-law one, for a concrete example already live in this codebase (§10.1) — a given event or formula was created under, and no rule for how two domains running different protocol revisions should behave on reconciliation beyond "the reducers currently in code are applied to whatever is in H_d." A deployment that changes reducer logic between releases has no protocol-level way to express that change to a domain it has not yet reconciled with.

(vi) Normative test vectors. Partially present, not yet elevated to protocol status. test-vectors/id-parity.json, g-scenario.json, and conservation-scenario.json exist, are version-controlled, and are the actual mechanism by which (i) and (iii)'s cross-language agreement is checked in CI — but this paper does not currently present them as a normative conformance suite a third implementation would be expected to pass, only as this reference implementation's own regression fixtures.

None of (i), (iii), (iv), or (v) are gaps introduced by carelessness — each is exactly the kind of decision a protocol specification is supposed to make explicitly, and this paper has so far made each one only implicitly, by what its own two reference implementations happen to agree on. "JS and Rust agree" is real, tested evidence that a workable convention exists; it is not the same claim as "the protocol specifies this," and this paper does not make the second claim on the strength of the first. Recorded as open work, alongside §29.9, as this revision's second most significant open item after §10.1/§24.1's Sybil-resistance gap — see §17's matrix for both stated at the same level of visibility as this paper's stronger results.

10. The Accrual Function, With Cadence-Derived Economic Time

AIWA's reference reward function, as of this revision, is the Proof-of-Will structure adopted directly from the reference deployment's own real mining formula (an existing implementation reviewed for this purpose, not invented for this paper):

  r(b, q, q_total, T) = (b · q^α) / [ln(q_total^(β(1−T)) + C)]^γ

where b is committed resource for the event; q is elapsed economic age measured in mandatory protocol cadence epochs (Definition 10.1 below), exactly as in the prior revision; q_total is the domain's own total cadence-epoch count, a domain-local stand-in for the original formula's global "protocol age" — see the paragraph after next; T is a caller-chosen patience rate, clamped to [0, 0.4]; and α, β, γ, C are deployment-chosen constants, with a further deployment-chosen minimum wait minQ below which q is treated as not yet claimable (q < minQ ⟹ r = 0), replacing this formula's own minimum-wait floor.

This supersedes the prior revision's simpler reference form r(b,q) = K·b^α·q^β. Two adaptations from the original mining formula are deliberate, not incidental, both because AIWA domains never share a global clock (§9) while the system the original formula comes from — a single program every participant reads slot numbers from — assumes one. First, q_total (the original's "protocol age": slots since one fixed reference block, identical for every participant) is this domain's own age here, not a cross-domain quantity; requiring every domain to agree on one shared reference epoch would reintroduce exactly the global-synchronization dependency §9 rules out. Second, the original enforces a minimum wait defined in units specific to its own host chain's slot timing; minQ generalizes this to a deployment-chosen epoch count with no assumed real-time duration.

Open work this revision creates, stated plainly rather than left implicit: §24.1's Sybil-profit analysis and Appendix C's Lemma 1 divergence experiments were both derived against the prior power-law reference function, specifically exploiting its b^α term. In the structure above, b appears linearly (exponent 1) — α now governs q, not b — so §24.1's R_N = K·B^α·N^(1−α) derivation does not carry over as written, and neither do Appendix C's measured divergence percentages, which were empirical results for that specific formula. This has since been re-derived rather than left as a conjecture — see §24.1's own updated note and Appendix H.22 for the full derivation, a numerically-verified proof, and a genuinely new complication the re-derivation surfaced that the old formula's analysis never needed to consider.

Definition 10.1 (Economic cadence epoch). Let Δ be the deployment's mandatory
cadence interval. Each domain maintains a monotonically advancing economic
epoch q_d. A domain may advance its local epoch only through a valid cadence
transition. The economic accrual function depends on the number of valid
cadence epochs since the event's acceptance epoch q_0:

  q = q_d − q_0

and, when a time unit is useful,

  t_Δ = q · Δ.

The wall clock MAY still be used for UI, scheduling, transport timeouts,
diagnostics, and other non-economic purposes. It MUST NOT directly determine
economic accrual. A separate cadence-integrity mechanism is required to bound
how quickly the economic epoch may advance.

This distinction removes an unnecessary trust dependency from the original
time-sensitive formulation. Under the v1.0 formulation, a manipulable local
clock could inflate t and therefore reward. In v1.1, changing the wall clock
does not change q and therefore does not change economic state — confirmed
by an executed counterexample, not only argued here: Appendix H.8
constructs the v1.0-style wall-clock-dependent variant directly, shows it
diverges on an identical converged event set depending solely on when a
replica happens to materialize it, and shows the actual cadence-derived G
of this reference implementation is unaffected by the same perturbation,
because it never reads a wall clock at all. The security
question becomes protocol-level cadence integrity: a domain must not be able
to skip arbitrary epochs, replay a cadence transition, or create multiple
economic epochs from one authorized transition.

The cadence counter is not a global synchronized clock. Domains remain
autonomous during partition. A domain may continue to advance its own cadence
according to the local protocol rule without contacting another domain. The
purpose of cadence-derived economic time is narrower: it defines the amount
of protocol-recognized economic time that has elapsed for an event.

The reward function remains deployment-configurable and is not claimed
optimal. The important architectural property is that the inputs used by
economic materialization are part of deterministic, replayable protocol
state. If q affects economic value, q must therefore be represented in the
event identity and/or committed history strongly enough for every replica to
reconstruct the same reward after reconciliation.

The cadence mechanism, even if made integrity-preserving, does not solve the independent issuance problem. If a domain can
continue producing economically valid cadence epochs and positive issuance
for arbitrarily long partitions, total issuance can still grow without
bound. Cadence integrity solves the clock-manipulation problem; scarcity
mechanisms in §13 solve the separate issuance-bound problem.

10.1 The formula itself must be a durable protocol object, not a mutable local setting. A question asked directly exposed a real gap in an earlier revision of this reference implementation: "can I change the formula whenever I want? [...] it should be immutable." It should be, and it wasn't — θ's reward parameters (α, β, γ, C, minQ) lived as a plain, freely-editable local variable, never a DAG event. Two domains could silently disagree about what the exact same accrual event was worth, simply because one had a different value typed into a settings field than the other — a real fork, just never named as one, since nothing about H_d's own convergence guarantee (§9) protects a value that never entered H_d to begin with.

Closed by making a formula a minted, permanent object: a 'formula-register' event binds an id to a fixed (α, β, γ, C, minQ) forever — no update path exists, by design, unlike a module's code (§27.4), which can be revised while keeping its id. The same id can never be re-minted with different parameters; a second registration attempt for an already-minted id is rejected outright, the same content-addressing discipline §8.1 already establishes for event ids, applied here to an economic object instead. §10's own reference formula — the real Proof-of-Will structure this revision adopted — is not itself minted through this mechanism: it is 'genesis', a fixed protocol default available to every domain with no event and no cost, specifically to avoid a bootstrapping paradox a strict reading would otherwise create — a domain needs some formula to accrue anything under real economic rules before it could ever afford to mint a new one. Every other formula is a genuine mint, gated by the same identity-cost requirement §24.1's splitting-incentive analysis already motivates for issuing modules, applied here at the application layer rather than inside the pure reducer — mirroring exactly how checkSubmissionEligibility (§27.4.1) is wired in, not a new pattern invented for this. Which minted formula a domain currently uses is a separate, local, non-permanent choice, distinct from whether that formula exists and what its parameters permanently are — switching which formula you use is not the same operation as changing one that exists, and this paper is careful to keep those two questions answered by two different mechanisms rather than conflating them. Executable detail, including a real near-miss bug found while verifying the switch actually took effect, is in Appendix H.21.

11. Identity and the Weak-Identity Lemma

Lemma 1 (identity sufficiency, first-representative-wins deduplication). Under
a deduplication rule that keeps a single representative per identity class
and discards the rest, an identity scheme id(·) is safe for a materialization
function G exactly when

  id(e₁) = id(e₂)  ⟹  G({e₁}, θ) = G({e₂}, θ)

for all events e₁, e₂ under consideration. The identity must not merge two
events unless G is indifferent to which representative survives.

The lemma corrects the heuristic that identity should always be as
fine-grained as possible. Identity only needs to preserve the distinctions
that the economic materialization function actually uses.

Under a time-insensitive reward r(b) = b, an identifier such as
H(domain, payload) may be sufficient when all events with the same domain
and payload have the same economic meaning.

Under cadence-sensitive reward

  r(b, q) = K · b · (1 + β · q),

the same weak identity is unsafe if two otherwise equal events can occur at
different economic epochs q. The identity or the committed event context
must preserve q. Appendix H.3 and §22 demonstrate this distinction
empirically using the corresponding counterexample construction.

In v1.1 the relevant temporal information is the cadence epoch, not an
untrusted wall-clock timestamp. This makes the lemma operational: a module
author can inspect the variables used by G and choose an identifier that
preserves exactly those distinctions.

12. The Partition Issuance Bound

Consider two or more AIWA domains under the following assumptions: (A) Autonomous issuance — each domain can issue without communication; (B) Independent issuance — a domain does not need knowledge of another's current issuance to issue its own; (C) Full retention — all issuance accepted locally remains valid after reconciliation; (D) No preallocated global constraint — no finite issuance budget allocated before partition, no equivalent scarce resource.

Proposition 1 — Finite-supply impossibility under persistent positive-rate autonomous issuance. If cumulative issuance rates satisfy ρ_d(t) ≥ ρ_d^min > 0 throughout an arbitrarily long partition, and (C) and (D) both hold, then no finite global supply bound can hold for all partition durations.

Proof. I_global(T) ≥ (Σ_d ρ_d^min) · T . For any finite budget B , choosing T > B / Σ_d ρ_d^min gives I_global(T) > B . Since this holds for every finite B , no finite bound survives for all T . ∎

What kind of result this is. Proposition 1 is an impossibility result about a joint set of economic assumptions — not a distributed-systems impossibility theorem in the CAP-theorem sense — and its proof is a short integration argument, not a deep combinatorial one. Its value is that it pins down exactly which of (A)–(D) must be relaxed and rules out the intuition that autonomy, independence, and full retention could coexist with a fixed global bound if the platform were merely engineered more cleverly.

Three distinct notions of "supply," disambiguated. It is worth separating three quantities that are easy to conflate: I(T) , cumulative issuance up to time T (monotonically non- decreasing, this is what the proof directly bounds); S(T) , currently-valid supply at time T (claims not yet expired, consumed, or invalidated — S(T) ≤ I(T) , with equality only if nothing ever expires or is spent); and R(T) , redeemable supply (claims both currently valid and confirmed consistent across domains after reconciliation — R(T) ≤ S(T) ). Proposition 1 establishes that I(T) is unbounded under (A)– (D); it does not by itself establish that S(T) or R(T) must be unbounded — §13's expiring-rights mechanism is exactly a construction where I(T) grows without bound while S(T)

stays bounded, because claims expire faster than they accrue. Appendix H.4 confirms this numerically.

Corollary. A fixed bound on I(T) requires at least one of: (i) a finite budget agreed or allocated before the partition; (ii) an issuance rate whose cumulative integral converges, ∫₀^∞ ρ_d(t) dt < ∞ — precisely the condition Proposition 1 excludes by requiring a rate bounded below by a positive constant; or (iii) another scarce constraint external to the domains (a physical resource, an expiry rule, governance). A bound on S(T) or R(T) specifically is a separate and generally weaker requirement, satisfiable by an expiry mechanism even while I(T) remains unbounded.

Scope, stated precisely. Proposition 1 covers exactly the case of a rate bounded below by a positive constant. It does not cover a rate that decays toward zero over the partition under some local policy; whether such a policy can restore a finite bound while preserving (A)–(C) is left open (§29.2).

13. Where the Scarcity Constraint Must Go

13.1 Preallocated budgets. B_d(epoch) ; autonomy holds until the local allocation is exhausted.

13.2 Rate limits. ρ_d ≤ ρ_max bounds issuance over any finite interval but not as T → ∞ . RateBound ≠ SupplyBound — confirmed numerically in Appendix H.4, Policy C, and worth stating plainly because it is a common mistake in from-scratch reward-formula design.

13.3 Expiring issuance rights. A right carrying t_exp allows autonomous operation while bounding simultaneously-valid monetary state — at the cost that autonomy no longer equals permanent validity. Confirmed numerically in Appendix H.4, Policy D: I(T) still grows unboundedly, but S(T) converges to a finite steady state, ρ · t_exp , once T exceeds the expiry window.

13.4 Scarce physical or computational resources. Issuance tied to capital, energy, storage, computation, or attested hardware — the constraint is externalized into a scarce resource whose own acquisition cost then matters (§24).

13.5 External authority. Periodic governance-allocated issuance rights — sacrifices communication independence entirely for stronger central control; AIWA supports this as a configuration option but does not recommend it as a default, since it directly contradicts partition autonomy (G_A in §2) for the domain awaiting allocation.

14. Reconciliation

A merge function M(S_E, S_M) must be deterministic. Four properties, each tested independently in §20–21: merge uniqueness ( count(M_e) ≤ 1 ); merge determinism ( M(S_E,S_M) = M(S_M,S_E) ); merge validity ( Valid(M(S_E,S_M)) = true ); merge conservation ( Supply_out ≤ Supply_authorized ). A merge may be deterministic but economically invalid; a merge may be unique but non-conservative — these are independent failure modes and AIWA's test suite treats them as such rather than assuming one implies the others.

15. Historical Commitments

C_n = H(protocol, genesis, domain, n, C_{n−1}, A_n) . If an external observer retained C_k , subsequent history inconsistent with it becomes detectable — this is CommitmentIntegrity , not PhysicalTruth , and AIWA's API names the verification function accordingly ( verifyIntegrity , never verifyTruth ) specifically to prevent the two from being conflated by a module author reading the documentation. Two adversaries are distinguished: a rewriter modifies a legitimate history after the fact (detectable if an earlier commitment was retained); a fabricator creates a false history from the beginning (the commitment chain alone cannot distinguish true history from fabricated history — external evidence is required for that, and AIWA does not claim to supply it).

16. Observability and the Evidence– Autonomy Trade-off

For a mandatory heartbeat at interval Δ : bandwidth cost is ∝ 1/Δ while detection latency is L ≈ Δ + transport delay . Smaller Δ increases both bandwidth cost and communication dependence while decreasing detection latency; larger Δ reduces bandwidth but increases both detection latency and the period during which a domain can remain unobserved without triggering any alert. Evidence↑ ⟹ CommunicationDependency↑ in any mandatory-cadence design — AIWA treats Δ as a per-deployment configuration value, documented with this trade-off attached, rather than a hardcoded constant presented as a solved default.

17. Claim–Evidence–Assumption Matrix

Before the security-property registry, AIWA distinguishes what is proved from what is
implemented, tested, conditional, or still open. This matrix is normative for how the
claims in this paper should be cited. Updated for this revision — a prior version of
this table, labeled "Status in v1.1," had not been revisited since a substantial amount
of work landed after it was written; leaving a compact status table stale is exactly the
failure mode this table exists to prevent, so it is corrected here rather than left as
a historical artifact.

| Claim | Status in v1.2 | Evidence / limitation |
|---|---|---|
| Event-set convergence under reorder + duplicate delivery | Proved by construction; experimentally confirmed for the tested fault class | 500/500 trials in §20; not a Byzantine or permanent-drop proof |
| Deterministic materialization over a converged event set | Required by construction; broken variant demonstrated | §9, §21 V3 |
| Fixed global issuance bound under arbitrary partitions and persistent positive issuance | Impossible under stated assumptions | Proposition 1, §12 |
| Bounded currently-valid supply with expiring rights | Constructively achievable | §13.3 and Appendix H.4 |
| Weak identity is sufficient when economic meaning is invariant within an identity class | Proved for first-representative-wins deduplication | Lemma 1 and §22 |
| The reward formula itself is a durable, immutable protocol object | Constructed: minting is permanent, the same id can never be re-registered with different parameters, convergent after reconciliation | §10.1, Appendix H.21; the identity-cost gate on minting is enforced at the application layer, not inside the pure reducer |
| Cross-language agreement on the reference (Proof-of-Will) reward formula | Tested exactly against the real reference implementation's own constants | Appendix H.14; both languages independently compute the identical value to the last bit for the tested case |
| Sybil resistance for α > 1 in the fixed-capital model (power-law reference form) | Splitting is locally disincentivized | Algebraic result in §24.1; this is not a general real-world Sybil proof, and applies to the power-law form, not the current Proof-of-Will reference formula (see next row) |
| Sybil resistance under the current Proof-of-Will reference formula (§10) | Capital-splitting resistance: proved unconditionally (any c_id > 0 makes N*=1 optimal, no constraint on α/β/γ/T needed — stronger than the power-law form's conditional case). Identity-churn (discard-and-re-mint to avoid age decay): a new, distinct attack shape found while re-deriving the above; a real mechanism (deployment-wide, real-slot-indexed identity cost, §24.6) now dampens it — confirmed numerically to reproduce the un-mitigated exploit near a deployment's own genesis (real elapsed time has not yet passed to escalate cost), then close it as real time passes, with a real crossover point demonstrated, not merely asserted | §10.1, §24.1's note, §24.6, Appendix H.22; the mechanism is deployment-configured and OFF by default — a genuine, unresolved policy tradeoff (a legitimate late joiner pays the same escalated cost a churn attempt would) is stated, not silently decided by this reference implementation |
| Sybil resistance for 0 < α < 1 (power-law reference form) | Conditional on identity and capital-acquisition costs | §24.1–§24.4; costs are not calibrated; same power-law caveat as above |
| Patient-capital security under random partition duration | Open | §24.3 and §29.1 |
| Wall-clock manipulation cannot directly change reward | Architectural requirement, now backed by a real mechanism | §10, §16.2; cadence integrity (R11) is closed this revision via a real sequential-hash-chain proof — see the honest, stated limits in §16.2 (not a true asymmetric VDF; hardware-relative difficulty; does not address parallel Sybil advancement across many domains) |
| Cadence cannot be accelerated arbitrarily | Established for a single domain's own rate of advancement | §10, §16.2, Appendix H.30; a domain cannot fabricate epochs faster than real sequential hashing allows, verified in both languages with byte-for-byte cross-language parity |
| Protocol-level merge replay protection | Specified, not directly tested | Appendix B.7; V4 is only an economic surrogate |
| Value transfer requires proof of control over the sender, not merely a claimed label | Proved and adversarially tested — a real forgery vulnerability was found and closed | §7's security note, Appendix H.18; the specific forged-transfer case is reproduced and confirmed rejected in both languages |
| Identity-cost registration is durable and replicated, not a local variable | Constructed and tested; converges after reconciliation | §26, Appendix H.19 |
| Conservation is wired to economic issuance, not a parallel mechanism | Constructed and tested; double-spend and non-owner-transfer cases confirmed rejected | §7, Appendix H.16 |
| checkSubmissionEligibility gates new module registrations | Wired into the mandatory pipeline as an optional, injected check; omitted entirely reproduces the prior open-by-default behavior | §27.4.1, Appendix H.20 |
| Canonical byte encoding for event hashing, and canonical materialization ordering, are protocol-normative (not merely "both reference implementations happen to agree") | Open — not specified. Two reference implementations agreeing is empirical evidence of a workable convention, not a normative specification a third implementation could conform to without reading this project's source | §8.1, §9.1, §29.9; recorded as the paper's second most significant open item, alongside Sybil resistance above |
| Physical truth of committed events | Not provided | §15, §29.3 |
| Third-party sandbox security | Specified/enforced in the reference interface; not exhaustively adversarially fuzz-tested | §27, Appendix G, Appendix H.11 |
| The compiled WASM binary loads correctly in a real browser | Confirmed directly in a real deployed session, not merely believed to work from passing native tests | Appendix H.17; a live side-by-side comparison of WASM-backed vs. JS-backed computed results has not been run |
| AI non-authority for security decisions | Structural design invariant | §28; no AI-derived input enters core validity decisions |
| Machine-checked correctness | Not established | §29.4 |
| Cross-language (JS/Rust) parity is complete, not only checked where a specific task happened to touch both | One direct, systematic function-by-function sweep performed and its real findings closed; not a continuous or automated guarantee — the pattern that motivated it (a fix or feature repeatedly made in one language and never mirrored) had already recurred multiple times before this sweep existed | Appendix H.33; a real, previously-undiscovered whole-file gap (public-profile-reducer.js) and a real small function gap (rankFromIdentityAndCadence) were found and closed by this one sweep, which is itself evidence the risk was real, not hypothetical |

This matrix deliberately prevents the phrase "AIWA is secure" from carrying more
information than the underlying evidence supports. Two claims were marked, in an
earlier revision, as its most significant open items: identity-churn's practical
exploitability (a new attack shape found while proving capital-splitting resistance,
not a previously-known gap being restated), and canonical encoding/ordering as a
normative (not merely empirical) specification. The first now has a real, tested,
deployment-configured mitigation (§24.6) rather than standing fully open — recorded
as dampened, not resolved, since the mechanism is off by default and carries its own
stated, unresolved policy tradeoff. Canonical encoding/ordering remains this
revision's single most significant open item. See the notes at §10.1, §24.1, §24.6,
and §29.9 for what
each would require to close.

17. Security Properties (Summary Table)

Property Purpose

Source binding Prevent substitution of origin

Destination binding Prevent redirection

Single-use Prevent replay consumption

Crash-safe Prevent failure-induced replay consumption

Protocol binding Prevent policy substitution

Derivation binding Preserve the issuance rule

Merge uniqueness Prevent duplicate reconciliation

Merge determinism Remove arrival-order dependence

Merge validity Enforce economic policy

Merge conservation Prevent unauthorized creation

Preserve event semantics, per Unique event identity Lemma 1

Cadence integrity Prevent artificial temporal accrual

Bound identity-splitting profit (partial, Sybil resistance §24)

Budget integrity Enforce local issuance limits

Property Purpose

Commitment Detect historical rewriting integrity

Reconciliation Produce a unique post-partition state determinism

Prevent third-party code from Module sandboxing escalating trust

Prevent advisory AI output from AI non-authority gating security decisions

The term "security property" is used loosely here and covers several genuinely different kinds of claim, which the full registry in Appendix E tags explicitly by category rather than presenting as uniformly strong: safety invariants (proved from the construction, not merely tested); convergence properties (proved as replicated-data-type consequences, confirmed experimentally); cryptographic assumptions (rely on standard hash assumptions, not proved from scratch); economic security assumptions (the weakest category — cost- conditional and unverified against real-world costs); and external-trust assumptions (not mechanisms AIWA provides, but conditions it depends on and cannot itself guarantee). Treating this table as a list of comparably strong guarantees would overstate what this paper establishes; Appendix E is the accurate version.

18. Threat Model

Replay attacker; merge attacker (duplicate reconciliation); rewriter; fabricator; Sybil attacker; patient-capital attacker (accumulates identities or capital over long periods, potentially exploiting partition duration itself, to maximize issuance — formalized in §24.3); clock attacker; transport attacker (delay, duplicate, drop, reorder); malicious module attacker (third-party code attempting to escalate sandbox privileges, exfiltrate other modules' data, or intercept core runtime functions — §27). Transport correctness does not imply economic correctness, and module sandboxing does not imply ledger correctness — these are independent guarantees tested independently.

19. Experimental Method

The experiments below are deliberately modest. They do not simulate an entire interplanetary economy, and they do not simulate the partition interval itself (§20's scope note is explicit about this). They test the specific, local claims the architecture makes: (1) does the event-set construction converge under reordered and duplicated delivery, and (2) if the stated invariants are deliberately removed one at a time, does the same test harness find real counterexamples? A simulation that only demonstrates success is weak evidence; a simulation that demonstrates success and then breaks in a specific, predicted way when its own invariants are removed provides stronger evidence that the tested invariants are causally load- bearing, not incidental to the specific inputs tried.

20. Experiment 1 — Post-Partition Convergence

Scope note. This experiment does not simulate the partition itself. It tests the narrower, necessary primitive the partition argument depends on: after independently accumulating local events, both replicas eventually receive the same complete event set through channels exhibiting reordering and duplicate delivery — with every event delivered at least once, never permanently dropped. This is a test of the convergence primitive, not of partition autonomy or of adversarial/Byzantine delivery.

Setup: 40 Earth-domain events, 40 Mars-domain events, 500 independent trials. Each event's identifier is a full SHA-256 digest over (domain, counter, payload) ; each replica receives all events through independently randomized reordering and duplication, and deduplicates explicitly by keying on event identity. Three measures are checked: set equality, canonical event-set hash equality, and materialized economic-view equality.

Result (actual run, reported in full).

Trials: 500 Set convergence rate: 1.0000 Hash convergence: True Materialized convergence: True Sample trial 0: A_E=4550.7306 A_M=4550.7306 n_delivered_E=111 n_delivered_M=98 n_unique_E=80 n_unique_M=80

100% convergence across all 500 trials on all three measures. In the sampled trial, replica E received 111 total messages (including duplicates) against 98 for replica M, yet both converged to the identical 80-element set, identical canonical hash, and identical materialized value. This does not prove the implementation is correct against every possible fault; it demonstrates that the reference implementation behaves consistently with the model under the tested fault class. Full source in Appendix H.1.

21. Experiment 2 — Deliberately Broken Invariants

Variant Broken invariant Result (actual run)

0/200 diverged V0 none (control) (0.00%)

duplicate-sensitive 200/200 diverged V1 accumulation (100.00%)

conditional — see V2 weak identity §22

deterministic 200/200 diverged V3 materialization (100.00%)

non-idempotent merge 200/200 diverged V4 application (100.00%)

V1 — duplicate-sensitive accumulation. No merge operation at all; raw delivered payloads are summed with zero identity-

based deduplication, showing what happens to a materialized total when duplicate delivery is not filtered before accumulation. Counterexample at trial 0: A_E=6506.6038, A_M=5609.3685, diff=897.2353 . This is a deliberately naive strawman — no serious implementation accumulates raw delivered messages with zero deduplication — included because it isolates the specific failure mode in its simplest possible form.

V3 — order-dependent materialization. G(H) = Σᵢ bᵢ·(0.999)ⁱ with i the receipt position: H_E = H_M while G(H_E) ≠ G(H_M) . Counterexample at trial 0: diff=0.882213 — small in magnitude, but 100% of trials diverged, and the failure occurs entirely in the economic view, a harder class of bug to notice than a replication failure, since the replicated set itself is identical on both sides.

V4 — non-idempotent merge application. Applies a no-guard merge function twice to the same domain-local contribution, producing exactly double the correct value in every trial. Counterexample at trial 0: 9101.4612 vs. correct 4550.7306 — exactly 2×. Scope: this is an economic surrogate for a missing replay-protection guard; it is not itself a test of the merge-identifier replay protocol specified in Appendix B.7. That protocol-level test remains unexecuted (Appendix H, §29.4).

Full source for all four variants: Appendix H.2.

22. Weak Identity: Confirming Lemma 1, and a Methodological Caution

Lemma 1 (§11) already tells us, without running any code, exactly when a weak identity scheme is safe. This section confirms the lemma empirically on a concrete G , and separately reports a design mistake in the first attempt at the experiment — kept here because it is a useful caution for anyone building a similar test harness, not because it is itself a scientific result.

22.1 Confirming the lemma (actual run). With id_weak(e) = H(domain, payload) and r(b) = b , Lemma 1's condition holds by construction: any two events id_weak merges have equal payload and therefore equal reward.

=== Quantization 10.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 293/300 (97.7%) === Quantization 5.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 300/300 (100.0%) === Quantization 2.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 300/300 (100.0%)

Sample counterexample (quantization=5.0): A_E_weak=2780.0000 A_M_weak=2085.0000 diff=695.0000 strong-identity same trial: A_E=19795.0000 A_M=19795.0000 match=True

Under r(b)=b the weak scheme produces 0% divergence, exactly as predicted. Under r(b,t)=K·b·(1+β·t) , id_weak 's condition fails — it can merge events with equal payload but different counter (a proxy for elapsed time), which have different reward — and divergence occurs in 97.7–100% of trials across every tested collision density, while id_strong(e) = H(domain, counter, payload) , which never merges two

distinct events, remains at 0% divergence at every setting. Both outcomes are exactly what Lemma 1 predicts; the experiment's contribution is confirmation on an executable instance, not discovery.

22.2 A methodological note, not a finding. An earlier design of this experiment used continuously distributed payloads and observed no divergence at all, because payload collisions were vanishingly unlikely by chance — the experiment was failing to generate the condition it was meant to test, not demonstrating that weak identity is safe. This is recorded as a caution: a null result from a randomized test harness must be checked against whether the harness can even produce the triggering condition, before it is read as evidence of safety.

22.3 Precise statement and its limits. The condition in §11 is stated for first-representative-wins deduplication specifically — where, for each identity class, the first event a replica receives determines the value contributed to that class. A scheme that instead merged or averaged the attributes of colliding events would need its own, separately derived safety condition; Lemma 1 does not characterize safety for every possible collision-resolution rule, only the one actually used in this implementation. Event identifiers in this experiment use the full 256-bit SHA-256 digest, so observed divergence is attributable to the identity scheme's deliberate coarseness, not to accidental collision in a truncated representation. Full source: Appendix H.3.

23. What the Experiments Establish

Result 1. The event-set construction converges under the tested reordering and duplication model (§20, 500/500 trials, all three measures). Result 2. Removing per-event deduplication before accumulation produces measurable, 100%-reproducible divergence (§21, V1). Result 3. A convergent replicated state does not guarantee a convergent economic view if G depends on non-replicated ordering (§21, V3). Result 4. Lemma 1's identity-sufficiency condition is confirmed on an executable instance, with its scope (first- representative-wins deduplication) made explicit (§22).

These results do not establish: complete Sybil resistance; secure clocks; bounded patient-capital profit; physical truth of committed claims; global monetary stability; security against arbitrary Byzantine implementations; or, for V4 specifically, correctness of the merge-identifier replay-protection protocol itself, as opposed to its economic surrogate. The experiments validate the specific primitives tested — they are not a validation of the complete platform, and should not be read as one.

24. Economic Security: A Cost-Explicit Sybil and Patient-Capital Analysis

A bare reward-curvature argument is not enough to characterize Sybil resistance. Computing R_N = K·B^α·N^(1−α) for an attacker splitting a fixed capital B among N identities shows R_N < R_1 when α > 1 — but stopping there leaves three problems unaddressed, treated in turn below: the argument says nothing about the regime α ≤ 1 , where it gives no bound at all; it assumes the attacker's capital is fixed and merely redistributed, rather than acquirable;

and it ignores time, even though AIWA's own reward function (§10) makes time economically central and the threat model (§18) explicitly names a patient-capital attacker.

24.1 Adding identity cost to the fixed-capital case. [Note on this section as of the current revision: this specific derivation, and §24.2–24.3's that build on it, are stated for the power-law reference form r(b,q)=K·b^α·q^β used prior to §10's Proof-of-Will revision, where α governs b's exponent directly, and remain valid as the derivation for a deployment that chooses that simpler power-law form, which §10 still permits as a valid configuration. §10's current reference formula applies α to q instead, with b entering linearly; that structure has since been re-derived separately — see Appendix H.22 for the full argument. Summary of that result: under the idealizing assumption this section's own N* analysis already makes ("fixed t," i.e. identical elapsed age across all N split identities), the current reference formula's linear b-term makes splitting a fixed capital B into N simultaneous, equally-aged identities produce EXACTLY the same total reward regardless of N — verified algebraically and confirmed numerically to floating-point precision — which makes any c_id > 0 strictly, unconditionally splitting-discouraging, with optimal N*=1 for every parameter choice, a stronger and simpler result than this section's own conditional (0<α<1) case below. The re-derivation also surfaced a genuinely new complication this section's original analysis never needed to consider, since the power-law form had no age-dependent decay term at all: because the current formula's reward decays with a domain's own age (§10), an attacker can sometimes profit from abandoning an aging domain and re-splitting the same capital across fresh, young identities instead — a decay-avoidance incentive distinct from simultaneous capital-splitting, confirmed numerically in Appendix H.22 to actually exceed identity cost for a realistic parameter choice. §24.6 now closes this, not by touching the reward formula's own domain-local age term at all, but by making the identity-cost burn required for a NEW registration a function of real, deployment-wide elapsed time — see that section and Appendix H.22's own updated derivation for the mechanism and its honest, stated limits.] Let an attacker hold total capital B , split evenly across N identities ( b = B/N each), and pay a fixed per-identity creation cost c_id > 0 . Profit as a function of N , for fixed B and elapsed age t :

Profit(N) = N · K·(B/N)^α·t^β − N·c_id = K·B^α·t^β·N^(1−α) − N·c_id

Setting dProfit/dN = 0 :

K·B^α·t^β·(1−α)·N^(−α) = c_id

Case α > 1. The reward is convex in committed capital, not concave. Since (1−α) < 0 , so dProfit/dN < 0 for every N > 1 : profit is strictly decreasing in N , and N* = 1 regardless of c_id . At α > 1 splitting hurts even with free identities. This is a concentration-favoring economic choice, not a concavity result.

Case α ≤ 1. (1−α) ≥ 0 , so without an identity cost ( c_id = 0 ) profit is non-decreasing in N and unbounded splitting is optimal — reward concavity alone gives no bound whatsoever in this regime. With c_id > 0 , solving for the stationary point gives a finite optimal split size:

N* = [ K·B^α·t^β·(1−α) / c_id ]^(1/α), for 0 < α < 1

(at α = 1 , Profit(N) = K·B·t^β − N·c_id is linear in N with slope −c_id . For any c_id > 0 the slope is negative regardless of K·t^β , so the profit-maximizing choice among N ≥ 1 is always N* = 1 — the only remaining decision at α=1 is

whether to participate at all, i.e. whether Profit(1) = K·B·t^β − c_id exceeds Profit(0) = 0 , not how many identities to create.)

A note on integrality. N* above is the optimum of the continuous relaxation of Profit(N) ; N is actually an integer, so the true discrete optimum is one of ⌊N*⌋ or ⌈N*⌉ , whichever gives the higher value — a one-line comparison, but worth stating explicitly.

The substantive result is narrower: for deployments choosing 0 < α < 1 for distributional reasons ( α close to 1, chosen to avoid runaway wealth concentration — see §24.2), it is identity cost, not reward concavity, that does the load-bearing work of bounding Sybil profit. A deployment that sets α ≤ 1 for distributional reasons and assumes reward concavity alone protects it against splitting is relying on a property the math does not give it — AIWA's module-registration validation (§27.2) checks for exactly this misconfiguration and rejects it.

24.2 The α trade-off, stated explicitly. α > 1 (convex reward in committed capital) bounds splitting incentives independent of identity cost, but it does so by giving disproportionately more reward to larger single deposits — the same property that suppresses splitting also rewards concentration, favoring large existing holders over small independent participants. 0 < α < 1 (concave reward) is the more distributionally defensible choice but removes any Sybil protection that could have come from α > 1 convexity entirely, shifting the entire burden onto c_id . α = 1 is the knife-edge in between. Any choice of α carries a cost on the axis it does not protect, and AIWA's configuration schema requires a deployment to declare which axis it is prioritizing.

24.3 Capital is not fixed: acquisition cost and the patient- capital connection. §24.1 assumed a fixed B merely redistributed across identities. A real attacker can instead acquire additional capital for each new identity. Let ψ(B_total) be a capital-acquisition cost. For N identities each acquiring capital b ( B_total = N·b ):

Profit(N, b, q) = N·K·b^α·q^β − N·c_id − ψ(N·b)

Convexity of ψ is not, by itself, a sufficient condition for bounded profit. A convex function can still grow slower than the reward term it is meant to check: if reward scales as B_total^α , ψ merely being convex does not rule out ψ(x) growing more slowly than x^α , in which case profit is unbounded as B_total → ∞ regardless of convexity. The condition actually needed is a growth condition relating ψ to α:

ψ(x) / x^α → ∞ as x → ∞

Under this condition the cost term eventually dominates any capital-driven reward term of order x^α , and profit is bounded above in B_total for fixed N . This should be checked explicitly for any candidate ψ (e.g. ψ(x) = x^γ requires γ > α ; ψ(x) = x·log(x) requires α < 1 ) rather than asserted from convexity alone — a reference implementation MAY perform this symbolic check where ψ is specified in closed form (Appendix B, validateEconomicConfig ).

This makes the patient-capital connection explicit: q^β multiplies the reward term but not the cost terms ( c_id and ψ are paid once, near the start of the partition, while reward accrues over the full number Q of admissible economic cadence epochs ). For

long partitions, holding N and b fixed, Profit(N,b,t) grows with t^β while cost is sunk — meaning the effective per- identity cost, amortized over the partition, falls as T grows: c_id(effective) = c_id / q^β . An attacker who can predict or wait for a long partition therefore faces a lower effective barrier to Sybil identity creation than the static, fixed- t view in §24.1 suggests.

This connection is still too easy, and the honest version of it is harder. The argument above treats partition duration T as if known or fixed at the moment cost is paid. It is not: T is realized only in hindsight. A sharper formulation treats partition duration as a random variable τ ~ F_τ , unknown to the attacker at the moment identity-creation and capital- acquisition costs are sunk, and asks about expected profit:

E[Profit(N,b,Q)] = N·K·b^α·E[Q^β] − N·c_id − ψ(N·b)

(or, if reward accrues continuously rather than only at partition end, E[∫₀^τ K·b^α·s^β ds] in place of K·b^α·E[τ^β] , depending on exact accrual mechanics — this paper does not commit to one). In v1.1, the random variable is more precisely interpreted as Q, the
number of admissible economic cadence epochs observed before reconciliation,
rather than an externally trusted physical duration. Physical partition
duration may still influence Q through the deployment's cadence policy, but
it is not itself an input to reward materialization.

The interesting question this reframing raises, and which the static version cannot ask, is: for which distributions F_τ does patient-capital exploitation become profitable — i.e. for which F_τ is sup_{N,b} E[Profit(N,b,τ)] > 0 ? A heavy-tailed F_τ (partitions are occasionally very long) can make patient capital profitable even when the expected partition duration is short, since reward scales with Q^β while cost is sunk regardless of τ . This is stated here as the shape of the right question, not answered; §29.1 poses it formally as AIWA's principal remaining open problem.

24.4 What this model still does not establish, stated without hedging. This is a model of an idealized, rational, risk-neutral attacker with known cost functions c_id and ψ ; it has not been calibrated against any real cost of identity creation (which in practice is not a clean scalar — it depends on the specific mechanism chosen, per §24.6, and on off-protocol factors such as reputation systems or legal identity requirements this model does not represent), and it does not address collusion between an attacker's Sybil identities and honest participants, interaction between multiple simultaneous attackers, opportunity cost of capital, or risk-aversion. The E[Profit(N,b,τ)] formulation is a sharper target than the fixed- T version but is not solved here — no F_τ is assumed, no closed form is derived, and the sequential case (identities created adaptively as partition duration becomes apparent, rather than all at once) is not modeled.

24.5 Numerical illustration (worked by hand, verified by direct computation). Take K=1, B=1000, t=1 (so t^β=1 ), α=0.5, c_id=5 :

N* = [K·B^α·t^β·(1−α)/c_id]^(1/α) = [1·1000^0.5·1·0.5/5]^(1/0.5) = [31.62·0.5/5]^2 = [3.162]^2 ≈ 10.0

At c_id=10 : N* = 10·(1/2)^(1/0.5) = 10·0.25 = 2.5 — doubling c_id cuts N* by 4×, not 2×, because 1/α=2 amplifies cost sensitivity at this α . This is an illustration of the formula under the simplifications of §24.1, not a claim about calibrated real-world magnitudes for any specific deployment. Full derivation and integrality check: Appendix D.

24.6 Identity-cost mechanisms an AIWA deployment can actually configure. Five mechanism classes admit the closest

thing to a measurable c_id floor available in real deployments today:

(i) Bonded-capital staking. An identity requires a minimum bonded deposit before it is eligible to issue. The relevant cost is an opportunity cost — the spread between the riskless rate and the staking yield, times the deposit, times duration — which makes c_id a flow cost rather than a fixed one-time cost: c_id(T) ≈ (riskless rate − staking APY) × deposit × T . Since reward scales as t^β while this cost scales linearly in T , whether patient-capital exploitation grows profitable with T depends critically on β relative to 1. Slashing (the penalty for detected misbehavior) requires timely detection; under partition, slashing may not propagate until after T , reducing the effective cost further — the usable floor during a partition of length T shrinks as T grows, exactly the opposite of what a designer might hope.

(ii) Local proof-of-work registration. An identity-creation event carries a PoW puzzle solution. Unlike staking, this cost is sunk when paid — spent computation cannot be recovered — which makes it a better fit for the fixed-cost assumption of §24.1. The interplanetary complication: a shared-difficulty PoW system adjusts continuously with network-wide hash rate, but a domain-local PoW oracle running during partition has no such adjustment mechanism unless it uses a verifiable-delay- function or similar non-interactive construction — an attacker who pre-mines identity tokens before a partition begins faces only pre-partition difficulty. This is an open design question with no established solution in AIWA as specified here. [Retraction, this revision: an earlier version of this section described a reference implementation (local-pow.js / local_pow.rs) built on the premise that this mechanism was the network-independent alternative required because burn-based registration (v) is "impossible" without connectivity. That premise was corrected directly by the user: a burn is never impossible at any distance, only slower to confirm — the transaction is broadcast and eventually reaches the network, with confirmation delayed by propagation time, not blocked. The implementation was removed rather than kept under a now-incorrect justification. This mechanism (local PoW) remains a legitimate option in the abstract identity-cost taxonomy below, but is not, as previously claimed, a required workaround for a limitation (v) does not actually have.]

(iii) Attested hardware. A hardware root of trust (e.g. a WebAuthn-compatible security key, or a TPM where available) binds an identity to a physical device at low marginal chip cost,

but the system cost includes manufacturer certificate chains whose root authorities are external and may be unreachable during partition — an offline attested-hardware system requires pre-distributing trusted roots before partition begins, which converts this mechanism into a form of preallocated authority (§13.5). The effective c_id is the cost of undetected spoofing, substantially higher than the hardware's purchase price and difficult to calibrate precisely.

(iv) Reputation and credential aggregation. An identity inherits a Sybil-resistance score from multiple independently verifiable, pre-existing credentials. This is the closest existing approach to an empirically measured c_id in terrestrial deployments, because it can be tied to a market-revealed forgery price rather than an assumed one — but under partition, new credentials cannot be issued or verified against a terrestrial root, so the measured forgery cost is a lower bound on c_id for pre- partition identities only, a materially weaker guarantee than the mechanism provides in a terrestrial, always-connected setting.

(v) External-chain burn (implemented in the reference implementation). An identity requires proof of an irrecoverable burn on an existing, independently valuable external network — concretely, in this paper's reference implementation, a SOL transfer to Solana's well-known incinerator address, verified via a finalized-commitment RPC lookup before an identity is admitted. This is structurally the sunk-cost family of (ii), not the enforcement-dependent family of (i): the argument for choosing it over bonded staking is exactly (i)'s own stated weakness — slashing cannot be relied upon to propagate within an arbitrarily long partition, whereas a burn's cost is realized entirely at payment time, with nothing left to enforce afterward. Unlike (ii), it does not require a local, partition-safe PoW oracle (a genuinely open problem in this paper, per (ii) above) — it borrows an existing network's difficulty and finality instead of constructing one from scratch. Its own new cost, not shared with (ii): the burn's economic reality depends entirely on which network and which commitment level is used, and this is not a detail — it is the whole mechanism's validity condition. The reference implementation makes this explicit rather than assuming it: identity registration is deployment-configurable between a real network (mainnet, where the burn is an actual, irreversible cost, satisfying this section's requirement) and a test network (devnet, where the same code path executes correctly but the "cost" is free faucet currency and provides no Sybil resistance whatsoever). A deployment that leaves this configured to a test network in production has not implemented a weaker version of (v) — it has implemented (v) in name only, with c_id = 0, which §24.1 already shows gives no bound at all for α ≤ 1. Distance from the network does not make this mechanism unusable, only slower to confirm: a broadcast burn transaction is still eventually received and finalized at whatever propagation delay separates the domain from the network, exactly the same "delayed, never blocked" property the rest of this paper already assumes for every other message in an AIWA deployment (§7). Executable detail in Appendix H.10.

Churn resistance, an extension of (v) closing §24.1's Result 2 (Appendix H.22): deployment-wide, real-slot-indexed identity cost. Formalized and built following two direct questions — first, whether a domain-local age term could itself be anchored to something real rather than freely resettable, which surfaced a genuine problem (comparing "now" against a per-domain anchor needs a live current-time oracle this paper's architecture otherwise avoids entirely for accrual); second, a reframing that the identity-cost burn itself, not the reward formula's own age term, is the natural place to anchor real elapsed time, since every domain already passes through exactly one real, externally-verified event before it can participate at all — its own burn. The mechanism: the burn required for a NEW registration is a deployment-chosen, monotonically non-decreasing function of the real Solana slot the burn lands at, measured against a single fixed deployment constant (a genesis slot, agreed once, exactly like α/β/γ/C/minQ already are). Needs no live "current time" oracle, ever — the delta between two already-known numbers (registration slot, genesis slot) is computable purely locally, forever, once both are known. The real slot is not a new datum requiring new network access: Solana's `getTransaction` RPC response, already fetched by every burn verification this mechanism already required, already includes it — the reference implementation had simply been reading every other field from that same response and discarding this one, closed by reading one more already-present field, not by adding a new RPC call. Inherits, rather than worsens, the exact trust model this section already states for burn verification generally: the domain broadcasting a burn has strong assurance (it queried Solana's RPC directly); a domain later learning of another's registration via merge() trusts the folded claim unless it separately re-verifies the embedded signature itself — the same signature already suffices for that re-verification at any future point, via the same RPC method, since it already returns the real slot for any signature it can still resolve.

Re-derived, not merely asserted: Result 2's original numeric finding (churning to fresh domains beats staying on one aged domain, quadrupling identity-cost outlay notwithstanding) is confirmed to still hold, essentially unchanged, at a registration slot near a deployment's own genesis — the mechanism does not retroactively penalize real time that has not yet elapsed. Simulated over a longer horizon of real, escalating registration slots, a genuine crossover point is confirmed to exist: cumulative profit from repeated churning falls behind cumulative profit from staying once enough real deployment-wide time has passed, at a directly reproducible parameter choice. This is dampening under real, verifiable conditions, not a renamed or relabeled version of the same unconditional exploit — recorded as such rather than claimed to be a complete, unconditional closure.

Two honest limits stated rather than glossed over. First, this mechanism does not touch the reward formula's own domain-local age term at all, and does not need to — module-rank computation (module-rank.js's rankFromIdentityAndCadence, confirmed by direct inspection to already read identity-cost state alongside cadence state) inherits the same benefit automatically, with no separate fix required, since both already share the identical materialized state this mechanism updates. Second, and left explicitly unresolved rather than decided by this reference implementation: an escalating, real-slot-indexed cost curve does not distinguish an attacker's Nth churn attempt from a legitimate newcomer's first-ever registration, arriving years into a mature deployment — both pay the same, now-higher, real cost. Whether that is an acceptable, even natural tradeoff, or an undesirable one that needs a separate mitigation, is a deployment policy question this paper does not resolve; the reference implementation defaults this mechanism OFF, requiring an explicit deployment choice (a genesis slot and a cost-curve function) rather than prescribing an answer. Executable detail, including the re-derivation's exact reproducible parameters and crossover point, is in Appendix H.22.

The partition-delay problem common to all five mechanisms. In every case, identity-creation cost as actually paid by an adversary is not the cost advertised by the mechanism in a terrestrial deployment. It is a function of the terrestrial cost floor, the probability that misbehavior is detected within partition duration T , and the delay between misbehavior and enforcement — which under partition may exceed T entirely. A complete calibration must therefore distinguish registration cost (paid once, before partition), verification latency (bounded below by one-way propagation delay, above by T ), and enforcement cost (registered cost minus what is recoverable, discounted by detection probability). §24.1's treatment of c_id as a single fixed scalar implicitly conflates

all three; a calibration methodology that does not is given in §29.4.

25. Transport (Pluggable, Partition- Tolerant by Requirement)

AIWA's transport layer is defined by an interface, not an implementation: connect(roomId, appId) , send(peerId, data) (with peerId = null meaning broadcast), onMessage(callback) , onPeerJoin(callback) , onPeerLeave(callback) . Nothing above this layer — identity, ledger, modules — is permitted to depend on which concrete transport is active. This is not a convenience; it is what makes G1 (partition autonomy, §2) achievable without redesigning every layer above it every time the transport changes.

Two concrete backends are specified: a same-planet, low- latency mesh transport (WebRTC peer connections coordinated through a relay pool, with automatic fallback to a relay-mediated store-and-forward mode if no direct peer connection succeeds within a bounded window — since some networks block the NAT-traversal machinery WebRTC needs entirely), and a delay-tolerant transport for cross-planet reachability, implementing store-and-forward semantics: messages queue locally and flush on the next available contact window, following the general shape of the Bundle Protocol lineage (RFC 9171 and successors) without requiring a specific implementation of it. A domain running the mesh transport locally and the delay-tolerant transport for its long- haul link runs both simultaneously, addressed by scope — local peers over the mesh, remote domains over the delay-tolerant

path — with the ledger layer (§8) treating both identically as sources of events to merge.

A connection watchdog is a required component of any
transport implementation: a connection can silently go stale —
for instance an ICE connection transitioning to disconnected
without a WebRTC stack attempting restart, especially after a
network change — without ever firing a peer-leave event.
AIWA's watchdog tracks the timestamp of the last inbound
peer-activity event and, if a bounded window elapses with zero
activity while at least one peer was previously known, tears
down and reinitializes the transport automatically, without
requiring a manual reload. This does not replace occasionally
reloading under genuinely degraded conditions, but removes
the need for it in the common case of a silently-dropped
session.

Reference-implementation note, this revision: the interface above (transport.js), the delay-tolerant backend, and the connection watchdog are now real, tested code, not only the specification prose above. transport.js's assertImplementsTransport() makes the "nothing above this layer may depend on which concrete transport is active" requirement checkable — a partial or malformed backend fails loudly, naming exactly which method is missing, at the point it's wired in rather than with a confusing error deep inside the ledger layer the first time it happens to call something absent. delay-tolerant-transport.js implements real queue-then-attempt store-and-forward semantics: a message is durably queued the instant send() returns, before any network attempt, so a crash between the two never loses it silently; flush() preserves FIFO order per peer and stops at the first failure for a given peer rather than letting a later message overtake one still stuck; different peers' queues are independent, so one peer's outage never blocks delivery to another. The connection watchdog fires onStale exactly once per stale episode (not repeatedly while still stale) and correctly detects a genuine second, independent stale episode after a real reconnect resets it — verified with an injected clock, not by waiting out a real timeout in a test. Following a direct question about whether any of this was actually wired into the application or only existed as a standalone, tested library — it was only the latter at first, an honest gap named as soon as it was asked about rather than left implied. Closed: the reference application's own reconciliation action no longer calls dag.merge() directly; it goes through a real per-domain transport instance, with the one deliberately-simulated piece being "did the bytes leave the machine" (there is no real network in a single browser tab), not the queueing or delivery logic built on top of that seam — the same untestable-network-primitive boundary as solana-rpc.js, not a new kind of shortcut. A simulated link can be toggled down, confirmed to queue a sync attempt rather than deliver it silently-differently, and a subsequent flush is confirmed to deliver exactly what was queued once the link returns. What remains an honest stub, not yet built: the WebRTC mesh backend itself, since verifying it requires real signaling infrastructure and real peer connections neither available in this development environment — the same category of limitation as solana-rpc.js's network calls (§24.6(v)), untestable here rather than unspecified. Executable detail for everything above is in Appendix H.24.

26. Identity

An AIWA identity is a keypair (Ed25519, derived via BIP39/SLIP-10 from a locally-generated mnemonic) plus a locally-accumulated history. Two properties are structural requirements, not conventions:

Profile writes are events. A profile edit — a name change, a bio update, a new declared contact — is itself an event in the domain's event set H_d (§8), so it inherits exactly the same convergence guarantee (Lemma A1-equivalent, following directly from §9) as any other accrual event, rather than living in a separate, ad hoc storage record with no merge semantics of its own.

Identity-cost registration is an event too — this was not true of an earlier revision of the reference implementation, found only because the question was asked directly: "where does [c_id] live? — this looks critical for interplanetary deployments." It was right to be critical of it. registerIdentityCost()'s result (§24.6) lived in a standalone local variable, never folded from H_d, meaning two domains that reconciled after an arbitrarily long partition would never actually learn that the other had a legitimately registered identity — exactly the same failure mode "profile writes are events" exists to rule out, just not yet applied to this specific fact. Closed by making a verified burn an 'identity-register' DAG event (identity-cost-reducer.js / identity_cost_reducer.rs), folded and propagated by merge() the same way every other durable fact in this paper already is, with the same replay guard (one signature backs exactly one domain) reused unmodified from the already-tested registerIdentityCost(). One honest limit stated rather than glossed over: this fold is pure, matching every other reducer's discipline — it does not re-query Solana during the fold to independently confirm a remote domain's claimed burn amount actually happened on-chain, since that would make identity a network-dependent view when no other materialized view in this paper is one. The domain that broadcasts a burn has strong assurance (it queried Solana's RPC directly before creating the event); a domain that later learns of someone else's registration via merge() is trusting the folded claim unless it separately re-verifies the embedded signature against Solana's RPC itself. Executable detail in Appendix H.19.

A profile's public commitment is evidence of non- tampering, not evidence of truth (§15). The verification API is named to make this unambiguous at the point a module author reads it, not buried in a paragraph of documentation likely to be skipped.

Key custody, stated as a limitation rather than solved. Keys are held client-side, encrypted at rest (PBKDF2, 200,000 iterations, AES-256-GCM). This is weaker than hardware- backed custody and AIWA does not claim otherwise — a browser environment has no general-purpose secure-enclave API, and a server-mediated custody model would reintroduce exactly the reachability dependency the whole platform exists to avoid. Hardware-key integration (WebAuthn-backed signing) is a stated future direction (§29), not a current guarantee.

27. Modules: Sandboxed Extensibility Without Elevated Trust

27.1 The module contract. A module is loaded code that receives a context object ctx at activation and nothing else. ctx exposes: ctx.storage (a namespaced key-value store, scoped per-module, inaccessible to other modules); ctx.sendToPeer / ctx.onPeerMessage (real-time peer-to-peer messaging, routed through the transport layer of §25 without the module ever touching it directly, not durable, not part of H_d); ctx.toast (user notifications); ctx.commit / ctx.claim (accrual, §8); ctx.transferClaim (a real, signed Conservation transfer, §7 — the module names which claim and where, the host signs with the domain's real keypair, which the sandbox never holds); ctx.postCausalEvent / ctx.queryCausalState (general-purpose write and read for any causal-contract event type beyond what this paper's own reducers already define — see §27.8). A module cannot: read or write another module's storage; intercept or

override the platform's network primitive; mutate platform globals; sign without the host's involvement; or access the private key material directly under any circumstance.

Reference-implementation note: ctx.transferClaim currently signs and posts the requested transfer directly, without an explicit user-facing confirmation dialog naming the amount and destination first — the property this section originally described (and still should hold) is not yet built. Recorded here as an honest, open gap rather than silently assumed to already be true; a module that has passed integrity verification (§27's own sandboxing) is not the same guarantee as a human having confirmed a specific transfer, and this paper does not conflate the two.

Activation must complete within a bounded timeout (8 seconds in the reference implementation); slow initialization work must be fire-and-forget rather than blocking activation, so that one slow or misbehaving module cannot stall the platform's boot sequence for the user.

27.2 Economic self-declaration. A module that emits accrual events (§8) must declare, at registration time, two things this paper's own analysis makes necessary: whether its reward function is time-sensitive (so the runtime selects a strong or weak event-identity scheme per Lemma 1, §11, automatically, rather than defaulting to the maximally strong — and maximally storage-costly — scheme everywhere), and its economic configuration — α , its declared identity-cost mechanism (§24.6), and its chosen scarcity mechanism (§13). Registration validation (Appendix B, validateEconomicConfig ) rejects a module declaring α ≤ 1 with zero identity cost, since §24.1 shows this configuration has an unbounded splitting incentive in the fixed-capital model, and rejects a module whose declared capital-acquisition cost function does not satisfy the growth condition of §24.3 where that function is given in closed form. A module that declares neither runs in a read-only, non-issuing mode — it can read the ledger but cannot add to it. Reference-implementation note following §10's revision: the deployed validateEconomicConfig (module-registry.js) still enforces exactly this α ≤ 1 check, whose justification is §24.1's power-law-specific derivation — under §10's current Proof-of-Will reference formula, where α governs q rather than b, that specific justification has not been re-examined. The check itself was not removed or altered; whether it is still the correct check for the current formula is open work, tracked alongside §24.1's own note, not silently assumed resolved.

The gap closed in this revision was larger than "not displayed," found only by checking the actual application code rather than the module registry's own already-tested logic: main.js's submission form hardcoded isIssuing:false unconditionally, meaning the entire issuing-module pathway — selectIdentityScheme(), validateEconomicConfig(), the α≤1 rejection above — was unreachable from the real application, not merely absent from its display. Every module submitted through the deployed app was, in practice, forced into read-only mode regardless of author intent. Closed by adding the declaration itself to the submission form (an issuing checkbox, a time-sensitivity checkbox, and the economicConfig fields α and scarcityPolicy — identityCostMechanism is derived from the submitting domain's own actual registered identity, §26, rather than typed, so a module cannot simply declare a mechanism it does not have) and by displaying each registered module's resulting identityScheme in the Domain screen's catalog, with Lemma 1's own reasoning attached as the explanation rather than a bare label. Verified end to end, not only at the level of the already-tested pure functions: an issuing module declaring α≤1 with no registered identity on the submitting domain is confirmed rejected with §24.1's exact stated reason; the same declaration with a real registered identity is confirmed accepted; a time-sensitive declaration is confirmed to compute 'strong', a time-insensitive one 'weak'. Executable detail in Appendix H.23.

27.4 Concrete mechanism, reference implementation (module-registry.js, module-hash.js, module-sandbox.js, module-submission.js). §27.1 states the sandbox contract declaratively — what a module cannot do — without tying it to a specific enforcement mechanism; the security property registry (Appendix E) accordingly lists module sandboxing as a hard runtime constraint whose status is "unconfirmed." This subsection records what closes that gap in the reference implementation, and what still does not. Two things, kept deliberately separate because they answer different questions. First: publishing stays maximally open by design, exactly as intended for the target community-governance model ("open, audited, judged; unaudited-by-choice is red-listed by default — a social-security-style model, not a permissioned gate") — registerModule() has no author allow-list and no approval step, only mechanical rejections (a duplicate id). But a judgment made under this model — an audit pass, a red-listing — is only durable if it is a judgment about a fixed byte sequence, not about "whatever currently lives at this URL": every module registration binds an id to a codeHash (§8.1's content-addressing technique, applied here to module code instead of ledger events), and re-fetching a module re-verifies the fetched bytes against that hash before ever mounting it — a silent content swap behind an unchanged URL is refused outright, not mounted with a warning. Second, and answering §27.1's enforcement question directly: module code executes inside a real sandboxed iframe (sandbox="allow-scripts", deliberately without allow-same-origin), never in the host page's own JavaScript context — this is what makes "cannot read another module's storage," "cannot mutate platform globals," and "cannot intercept the network primitive" hold as a property of where the code runs, not a convention the code is asked to respect. A minimal ctx is bridged into the iframe over postMessage, invisibly to the module author: from inside the sandbox, ctx.storage/ctx.toast/ctx.commit/ctx.claim look and behave exactly like calling the real functions directly. What this does not establish: the message-passing bridge's own correctness has not been exercised against a real browser DOM in this development environment — untestable here, not unimplemented, and unlike the WASM build (§24.6(v)'s network calls remain in the same untested category; the WASM build itself does not, as of Appendix H.17) this specific gap remains genuinely open, not resolved by that finding. This is one concrete mechanism satisfying §27.1's contract, not a claim that it is the only one or that it has been adversarially tested against escape attempts. Executable detail in Appendix H.11.

A real, previously-undiscovered vulnerability in the update path itself was found by one direct question — given content-addressing makes registration safe, how does updating an existing module id actually work, and is it gated to the original author? It was not, in either language: updateModuleCode() (and its Rust mirror) applied a new codeHash/codeUrl to an already-registered id without ever checking whether the signer submitting the update matched the module's own recorded author field. Confirmed directly, not assumed: a second, unrelated signer's validly-signed submission for the identical module id was accepted outright, silently replacing the original author's code and codeUrl with the attacker's own — while the registry's displayed author field stayed the original author's, making the takeover invisible to anyone reading it. Closed in both languages: submitModule() / submit_module() now reject an update whose signer does not match the module's existing author, before any other check runs; a genuinely new module id remains exactly as open to any author as §27.4's own design requires — the fix applies only once an id already exists. 3 new tests in each language, including direct confirmation that the legitimate original author can still update their own module normally, and that registering an unrelated, brand-new id remains unrestricted.

27.4.1 The submission pipeline. A registered codeHash is only as trustworthy as the process that bound it to the actual code in the first place — module-submission.js closes this specific step, modeled on a real fork-hosted-code-plus-signed-event-plus-CI-validation pattern (an existing implementation reviewed directly for this purpose) and correcting the one precise gap that pattern had: a content hash verified once, at merge time, then never persisted, leaving nothing for a later fetch to be re-checked against. Here, a submission is a signed event (moduleId, codeHash, codeUrl, nonce, timestamp, an Ed25519 signature) that must, before registration or update, pass three independent checks: the nonce has not been seen before (replay protection), the signature verifies against the claimed signer, and — the check the reference pattern's own gap was in — the code actually fetched from codeUrl hashes to exactly the value the event claims, not merely the value some earlier check happened to confirm. Registration itself then stores that hash permanently (§27.4), so this check is available to be repeated on every future load, not only once. Signing here establishes attribution and integrity only; publishing itself carries no author allow-list, matching this implementation's explicit design choice to keep submission maximally open — a deliberate departure from the reviewed reference pattern, which requires a rising reputation score to add a genuinely new file at all. What this revision adds is narrower than that: an optional ratio-based eligibility check (§27.4.2, checkSubmissionEligibility) is now actually wired into the pipeline (submitModule() / submit_module(), via an injected function rather than a hard dependency), gating only a genuinely NEW module id — never an update to one the author already owns — and only when the caller supplies the check at all. A deployment that omits it gets exactly the earlier, fully open behavior; one that supplies it gets the spam-deterrent property §27.4.2 describes, without this file needing to import identity-cost or cadence state directly. Found in the course of wiring this in, not by inspection: an earlier revision's recordNonce() (JS) returned a fresh object containing only usedNonces, silently discarding every other author's tracked rank on each call — masked until a test exercised two different authors in sequence rather than one repeatedly. Fixed to preserve the rest of the state; Rust's &mut-based state never had the equivalent bug, by construction of the language's own aliasing rules, not by having been separately checked for it.

27.4.2 The registry is a materialized view, not a standalone object. A gap found only by a direct question — does the module registry actually reach every domain, or only the one that registered a module? — and the honest answer, before this revision, was the latter: ModuleRegistryState was an isolated in-memory object with no propagation mechanism of any kind, unconnected to H_d. Under continuous connectivity this is invisible; under partition, this project's actual premise, a domain would never learn what another domain registered, for any duration, under any condition — precisely the failure mode §9 and §14's replicated-state requirements exist to rule out for every other piece of durable state in this architecture. Closed by treating module registration the same way accrual and cadence already are: registerModule / updateModuleCode / setAuditStatus are now DAG event types, and the module list is registry(H_d), a materialized view folded deterministically over topoOrder() exactly like G (§9) and Conservation, propagated for free by the same merge() already proved correct for those. Executable detail, including the specific before/after case (a module registered on one domain is genuinely absent from another's own materialized registry before reconciliation, and both converge to an identical registry after merging, independent of merge order), is in Appendix H.12.

The same appendix documents the list's sort key, kept deliberately separate from submission eligibility (§27.4.1) because the two answer different questions: rank is computed by reusing r(b,q) (§10) directly — an author's identity-cost burn (§24.6) and cadence epochs elapsed since it — rather than a second formula introduced for this purpose alone; eligibility for a genuinely new module id (not an update to an existing one) is a ratio test modeled on the reviewed reference pattern's own score-improvement requirement, using this project's cadence epochs as the single elapsed-time measure both concepts need, rather than maintaining two. Neither mechanism carries a minimum burn requirement (§24.6(v) already establishes that any positive, irrecoverable burn constitutes a real cost; a fixed floor was considered and deliberately rejected, not merely never added).

27.5 Presentation independence. The interface layer (theming, layout) is fully decoupled from module logic: a module's functional contract ( activate , deactivate , its rendering entry point) does not change based on which theme or presentation layer is active, and a presentation layer cannot

alter module behavior — only how a module's output is displayed. This matters specifically for interplanetary deployments, since a bandwidth- or hardware-constrained settlement may need a radically different presentation of identical underlying state, without every module needing to be rewritten to support it.

Reference-implementation note, this revision: no presentation layer existed at all before now — every module manipulated its own DOM and CSS directly, with nothing shared or switchable, which meant this section's claim was not yet backed by anything checkable. Closed with theme-tokens.js: plain design-token data (colors, font, spacing), not a rendering framework, with two presets — a default and a compact, high-contrast, large-text preset matching this section's own stated interplanetary case (bandwidth- or hardware-constrained hardware) — injected into a module's sandboxed iframe (§27, module-sandbox.js) two ways: as CSS custom properties a module's own stylesheet can read, and as ctx.theme, the identical token values as plain data for a module that renders via JavaScript instead. Neither is mandatory — presentation independence is opt-in per module, not enforceable on code this project doesn't control, the same honest limit this paper already states elsewhere about third-party code (§27.1). Switching the active presentation is a local, non-durable choice — it is never written to H_d, and touches nothing about which modules are registered, their computed rank, or any economic state, matching this section's own "cannot alter module behavior" claim precisely rather than merely asserting it. Executable detail, including confirmation that a module's own code is byte-identical across both presets — only the surrounding injected theme differs — is in Appendix H.26.

27.6 Hyperprofile: centralized views and interaction across modules. ctx (§27.1, module-sandbox.js) began as a private bridge — storage.get/set scoped to (this domain, this module), never visible to any other domain, and toast/commit/claim, none of which cross a domain boundary at all. A hyperprofile — described directly as "une centralisation des vues et interactions" — needs two things ctx never had: a way for a module to declare part of its data genuinely public, and a way for two domains' running modules to interact in real time. Both are additions to ctx, not a parallel mechanism built beside it, and both preserve the sandbox's own isolation guarantee (§27.1) exactly: a module still never touches window, document, or anything the host did not explicitly hand it.

ctx.share(key, value) is durable and DAG-replicated — a 'module-data-published' event, folded by public-profile-reducer.js into a materialized view keyed by (domain, moduleId, key), tracking the latest value per key rather than treating it as immutable once set (unlike a module's own code hash, §27.4, or a minted formula, §10.1, which are permanent by design; published data is meant to change). value = null retracts a key — a real, explicit unpublish, not merely leaving stale data with no way to remove it. This is deliberately distinct from ctx.storage, which stays exactly as private as it always was: a module author chooses, per key, whether something is a private setting or a public fact about that domain, and nothing else in this project's architecture makes that choice for them.

ctx.sendToPeer(peerId, data) and ctx.onPeerMessage(callback) are the interaction half, deliberately NOT durable and NOT part of H_d — this is real-time exchange between two domains' modules, routed through the real transport (§25), not a ledger fact meant to survive forever. A message is delivered only if the target module happens to be the one currently mounted on the receiving domain at the moment it arrives; there is no inbound queue on the receiving side, and a message to a module that is not open, or is a different module than the one open, is simply not seen — matching real-time interaction semantics rather than durable delivery, which §25's transport already provides for the events that actually need it (accrual, transfers, module registration, published profile data itself).

Visiting a profile — the "views" half of the same framing — is: given a domain id, materialize public-profile-reducer.js over H_d and read what that domain's modules have published, exactly the same way any other materialized view in this project (§9) is read, not a separate profile-fetching protocol. A domain that has never been reconciled with shows nothing, honestly, not an error; a domain reconciled with in the past but never revisited shows whatever was published as of the last reconciliation, which may be stale — the same partition-tolerant staleness every other materialized view in this paper already has, applied here to social information instead of economic state. Verified directly, including that a domain's published data is genuinely invisible to a peer before reconciliation and genuinely visible after, that latest-write-wins and explicit retraction both hold, and that a real-time peer message reaches the correct module and is correctly ignored by an unrelated one, is in Appendix H.27.

27.7 Desktop arrangement: user-controlled, not rank-sorted. An earlier revision's Desktop screen re-sorted pinned modules by their computed rank on every render — a real behavior, not merely stated in prose (Appendix H.12's own note said so directly). Adding real drag-and-drop arrangement, including folders — a bare icon dropped onto another creates one, dropped onto an existing folder joins it, and either gesture is undone by an explicit eject rather than a drag back out, a deliberate scope reduction from the pattern this was adapted from (see below) — exposed a direct conflict: an arrangement the user just dragged into place would be silently overwritten the next time anything else on the screen changed and triggered a re-render, since rank was still recomputed and applied as sort order on every pass. Resolved by removing rank as the desktop's sort criterion entirely, once a real arrangement mechanism exists to conflict with it — matching ordinary expectation everywhere else this pattern already exists (a phone's home screen does not re-sort itself by an app's own usage statistics). Rank remains computed and shown, as a tile's tooltip, informative rather than authoritative over layout; nothing about rank's role elsewhere in this paper (§27.4.1's submission eligibility, catalog sorting in the Domain browsing screen) changes — only the Desktop's own pinned-icon order, which was never a claim this paper's economic reasoning depended on, stops being auto-sorted.

The underlying arrangement logic (desktop-layout.js) is deliberately pure and fully tested — every rule about where a drag lands (reorder, fold two icons together, merge into an existing folder, eject one out, remove a module from wherever it currently sits) is a plain function over a small, explicit desktop-item data structure, verified directly rather than only through the pointer-event code built on top of it. The pointer-event wiring itself (drag threshold, a ghost element following the cursor, hit-testing the real DOM grid) is real code, adapted from a reference implementation's own real drag mechanism, but untestable here for the same reason module-sandbox.js's DOM code already is. Storage migrates transparently: a domain's existing pinned-icon list (a flat array of ids, the only format that existed before this revision) is read and converted to the new folder-capable structure on first load, under the identical storage key, with no data loss and no action required from an existing user — confirmed directly, along with the equally important negative case (an already-migrated layout is read as-is, not re-converted or corrupted by a second pass). Executable detail is in Appendix H.28.

27.8 A general causal-contract primitive, and the first real one built on it. [Naming note, added the same revision this section was first written: the underlying reducer described below was first built and named jackpot-reducer.js, before a direct follow-up question — since it has nothing jackpot-specific in it, does every application of it need its own name too? — made clear the file itself was misnamed for what it actually is. Renamed to pool-reducer.js (public/js/core/pool/), with initialJackpotState/applyJackpotEvent/materializeJackpot/computeDraw/verifyJackpotPayout becoming initialPoolState/applyPoolEvent/materializePool/computeWeightedDraw/verifyPoolPayout, and the DAG event types themselves — permanent, durable vocabulary once any real pool has minted under them — becoming pool-init/pool-contribute rather than jackpot-init/jackpot-donate. The jackpot example below keeps its own name deliberately: it genuinely is a jackpot, one specific game built as an ordinary plugin on top of the general primitive underneath it — a raffle, a lottery, or any other winner-take-all random distribution funded by real, pooled AIWA needs only a new plugin exactly like it, never a change to pool-reducer.js itself. The literal pool-address string prefix (jackpot-pot:<poolId>) was left exactly as-is rather than renamed alongside everything else, specifically for backward compatibility with any pool already minted under it — a real illustration of §8.1's content-addressing discipline extended to a human-chosen string: once something is live in H_d, renaming the code around it does not, and must not, retroactively change what is already there.] A direct question exposed a scaling problem in how this paper's own module bridge (§27.1) had been growing: the jackpot contract below was first built with five bespoke ctx methods — issueClaim, transferClaim, jackpotInit, jackpotDonate, jackpotRelease — one per operation a specific contract needed. Asked plainly whether every future contract idea would need its own new ctx methods, the honest answer was that this did not scale, and would mean touching module-sandbox.js — the actual security boundary — for every new kind of causal contract ever devised.

The resolution follows directly from a property this paper's own architecture already has, once stated precisely: security in this system has never come from which ctx method was called. It comes from each event type's own reducer independently verifying legitimacy at fold time, regardless of who posted the event or how — conservation-bridge.js requires a real signature for 'transfer' no matter its origin; jackpot-reducer.js (below) cross-references real Conservation state for 'jackpot-donate' no matter its origin. Given this, four primitives now cover every causal contract this paper anticipates, present or future: ctx.postCausalEvent(type, payload) posts any event type to the caller's own domain's H_d, with the host forcibly overwriting the domain/postedBy fields with the caller's real, actual id before the event is ever posted — the one rule that makes an otherwise-unrestricted event type safe to expose generically, since a module can request anything but can never claim to BE a different domain while doing it. ctx.queryCausalState(viewName, params) is its read-side counterpart, a named registry of materialized views the host maintains and extends — a main.js-only change for a new view, never touching the sandbox bridge. ctx.transferClaim and ctx.myDomainId remain the two genuine exceptions: a real signed transfer requires key material the sandbox structurally cannot hold, and a module's own real identity is needed by nearly any contract to reference itself, so both are irreducible to the generic pair. A brand-new kind of causal contract — an auction, an escrow, a vote, anything not yet imagined — now needs only a new reducer file and a new entry in the host's view registry; it has never again needed to touch this paper's actual security boundary.

The jackpot contract itself, built to prove the generalization actually works and not merely to motivate it, is this paper's first real causal contract beyond a plain transfer: a jackpot funded and paid entirely in AIWA, with no server, no cron, and no privileged executor, adapted from a real reference implementation (a real donation-and-weighted-draw jackpot funded through a neobank) with two deliberate, honestly-stated simplifications — the winner takes the entire cycle's pot rather than a 50/50 carry-forward split, which would require extending conservation.js's own derivation mechanism to support one-to-many claim splitting, a separate, larger change this version does not attempt; and there is no diversity bonus, since the reference implementation's version relied on a trusted server independently tracking real recipients, which a self-declared field inside a DAG event cannot replicate without inviting exactly the kind of inflatable, unverifiable bonus this paper's own discipline exists to rule out.

The engineering problem genuinely worth naming precisely: how does a leaderless system pay a jackpot winner without any party ever moving money on anyone else's behalf? A pot address (jackpot-pot:<potId>) has no keypair, by design — nobody can ever sign a release from it, which is the reason this is safe, not a limitation worked around. conservation-bridge.js's 'pot-release' event type accepts a claim leaving a pot address without a signature, but only when an injected verifier — supplied by the caller, never hardcoded, the same pattern §27.4.1's checkSubmissionEligibility already established — confirms the release is exactly what recomputing jackpot-reducer.js's own deterministic contract, from the real, causally-ordered donation history, says it should be. Omitted entirely, every pot-release is rejected outright — the safe default this paper's other injected-verifier primitives already guarantee. Cycle boundaries are event-count-based, not wall-clock — a cycle closes once a configured number of real donations have been recorded, computed purely from the causal fold itself, never self-declared by any single event — removing the synchronized-clock dependency §10's own cadence mechanism was already careful never to introduce for accrual, extended here to a second, independent mechanism.

A real, separate vulnerability was found while wiring this, not caused by it, and is worth recording with the same weight as the contract it was found alongside: conservation-bridge.js's 'claim-issue' handler never actually checked whether the issuing domain had real, sufficient balance — g.js correctly rejects an over-issuance, but conservation-bridge.js, folding the identical event independently, created the claim anyway, since it never consulted G's verdict at all. Confirmed directly: a domain that had accrued nothing could still end up holding a real, spendable Conservation claim for any amount whatsoever. Closed without duplicating G's own reward-formula-dependent balance logic inside Conservation — which would recreate exactly the kind of two-independent-copies drift this paper has already named as a real risk once (domain-id.js's near-miss, Appendix H.18) — by instead threading through the specific set of event ids G's own fold already rejected, and simply deferring to that verdict for claim-issue events, treating G as the one authoritative source for "was there really enough balance," which was already its job.

Verified end to end using the real DomainReplica-shaped flow the application actually wires together, not only each reducer in isolation: two independently-funded donors' real transfers into the pot are confirmed to each genuinely leave their own control; the deterministic winner is confirmed recomputed identically regardless of which donation the fold happens to process first; every donation claim releasing to the real, recomputed winner is confirmed, and an impostor's attempt to claim a payout for themselves is confirmed rejected while the real winner's holdings are left untouched; a domain's G balance is confirmed completely unaffected by jackpot participation beyond the deliberate claim-issue debit it requested itself. Executable detail for the reducer, the vulnerability found and fixed, and the full end-to-end flow is in Appendix H.29.

27.9 Composable verification primitives: the other half of §27.8's own scaling problem. ctx.postCausalEvent/ctx.queryCausalState closed permissionless composition of EVENT TYPES — any module can post or read any event, safely, because legitimacy has never come from which ctx method was called, only from whichever reducer independently verifies a given event type. What remained, stated honestly rather than glossed over at the time: composing existing platform-level VERIFICATION LOGIC in a genuinely new way still needed a new reducer file shipped as part of the platform itself — pool-reducer.js's own verifyPoolPayout is real, tested, working JS, but bespoke to pooled-value-with-weighted-draw contracts specifically; an auction, a time-locked escrow, or a threshold multisig release still needed someone to write, test, and ship a new file.

Two directions were weighed before building either. A general-purpose interpreter for real, submitted JS — a metered, sandboxed subset with instruction-budget accounting, executed as part of every domain's own deterministic fold — was named directly and set aside deliberately, not for lack of merit: it is a substantial, separate undertaking, its own audit surface, closer in scope to a small EVM than to anything else in this project, and remains the larger alternative if the smaller design below proves insufficient. What was built instead: a small, fixed vocabulary of six verification primitives — ownership, signature, count, deterministic-match, unique, causal-order — composed as plain declarative data (AND/OR/NOT), evaluated by one generic, fixed evaluator that never executes submitted code at all. Every primitive generalizes a check some already-shipped reducer already performed by hand, extracted rather than invented: ownership generalizes verifyPoolPayout's and prove_transfer's claim-ownership checks; signature generalizes verifyTransferAuthorization and verifySubmissionSignature, two independently hand-written implementations before this evaluator existed; count generalizes pool-reducer.js's own cycle-closing check; deterministic-match generalizes computeWeightedDraw's role inside verifyPoolPayout — the recompute-don't-trust discipline this whole paper already applies to event ids (§8.1), module hashes (§27.4), and formula parity (Appendix H.5), made reusable across contracts instead of re-implemented per file; unique generalizes pool-init's and formula-registry's mint-once-forever discipline; causal-order generalizes cadence.js's own last-accepted-event chaining logic.

This trades expressiveness for a dramatically smaller, more auditable surface, honestly: only combinations of the six pre-built primitives are reachable this way, not genuinely novel logic nobody anticipated — a real limitation, not hidden. A contract needing something outside this vocabulary still needs a new reducer, or is the concrete signal that the larger interpreter direction is worth revisiting, not a case this design pretends to cover.

Validated against a real, already-shipped, already-audited contract, not only demonstrated standalone: pool-reducer.js's own verifyPoolPayout was rewritten to construct a declarative condition — real claim ownership, and a deterministic-match against the recomputed weighted draw — and delegate final evaluation to the shared evaluator, keeping only the pool-specific structural lookups (does this pool and cycle exist, is the cycle actually closed, does this claim belong to it) as pool-specific glue, since those concepts are inherent to what a pool is, not generalizable. The existing pool-reducer test file — 25 tests, entirely unmodified — was re-run against this rewritten implementation and passed unchanged, confirming the evaluator is a genuine drop-in replacement for this real contract's own security-critical logic, not a parallel system that merely resembles it. Executable detail, including a real end-to-end run of the full donate-through-payout flow against the generic-evaluator-based implementation, is in Appendix H.31.

Update, this revision: pool-reducer.js's Rust mirror (pool_reducer.rs) now exists — the gap named above stood for exactly one revision. Building it surfaced two real, previously-undiscovered gaps in conservation_bridge.rs itself, unrelated to composability as such but only found because pool_reducer.rs needed 'pot-release' to exist: the JS side's own over-issuance cross-check (Appendix H.29's g_rejected_event_ids fix) and 'pot-release' itself had never been mirrored from JS to Rust at all, closed alongside this file rather than left for later. verify_pool_payout was written directly in its final, generic-evaluator-based form — constructing a declarative Condition and delegating to causal_condition_evaluator.rs — the same validation §27.9's own prose describes for JS: 25 tests, mirroring the JS suite's own 25 exactly, including every SECURITY-labeled case, all passing on the first run against real Conservation fixtures (real issue_claim/transfer calls, not hand-built claim objects). Cross-language parity was confirmed as a specific, measured numeric claim, not assumed from the algorithm's shape alone: the identical (poolId, cycleIndex, contributions) input was run through both languages directly, side by side, and winnerDomain, totalAmount, and the full 64-character drawHash all matched exactly, byte for byte, on the first attempt — pinned as a permanent regression test rather than left as a one-off terminal comparison. Executable detail is in Appendix H.32.

27.10 The actual last mile: permissionless contract minting, not just a validated engine. Asked directly, after §27.9's own validation shipped, whether the composability promise was actually delivered yet — it was not, and the honest answer mattered more than the validated engine's own real success: causal-condition-evaluator.js/.rs proved the evaluator works, against a real, already-shipped contract (pool), but every real use of it was still hand-wired PLATFORM code (pool-reducer.js's own verifyPoolPayout). A third party had no way to define a genuinely new contract this way at all — using the evaluator for anything new still meant touching platform code, exactly the problem §27.8 originally set out to close.

The missing piece, and the one thing that must never be gotten wrong building it: a release event cannot be allowed to supply its own verification condition. If it could, any attacker could attach a trivially-true condition (e.g. {type:'unique', key:'never-used-before'}) to a release attempt against any contract's real, deposited funds. Safety comes from separating WHEN a condition can be supplied — only once, at contract-mint time, immutable forever afterward, the same mint-once-forever discipline pool-init and formula-register already use — from WHEN it is merely referenced: a release event supplies only claimId/from/to and a contractId, which get substituted into the ALREADY-FIXED template's placeholders ($claimId, $from, $to), never used to construct new verification logic. generic-contract-reducer.js/.rs implement exactly this: a 'generic-contract-init' event mints a contractId with a permanent condition template; verifyGenericRelease looks up the real, minted condition, substitutes the real release values into its placeholders, and evaluates it against real, materialized state — composed via conservation-bridge.js's own 'pot-release' verifier alongside pool's, tried in order (a releaseProof's own shape — {poolId, cycleIndex} versus {contractId} — makes the two structurally distinguishable, so trying both is safe; a mismatched or malformed proof simply fails both, the same tolerant-fold discipline every other reducer in this project already follows).

Demonstrated, not merely claimed, with a genuinely new contract type built with zero pool-style bespoke code: a real 2-of-2 threshold-release escrow, expressed entirely as a single count condition ({type:'count', eventType:'approval', filter:{contractId}, min:2}) over real approval events, funded by a real signed transfer, confirmed to correctly withhold release with only one real approval present and correctly release once both are — using the exact same real, two-phase materialization the deployed application already performs for pool, not a simulated shortcut. No new reducer file was written for this specific contract; the generic mechanism handled it entirely.

Two honest limits, stated precisely rather than glossed over. First, the scope boundary already named in §27.9 still holds and is now demonstrated concretely rather than only argued abstractly: this closes contracts expressible as "release once a declarative condition over already-existing events/state holds" — threshold releases, time-locked escrows (via causal-order), signature-gated releases — but NOT contracts needing stateful accumulation before a condition can even be evaluated, like pool's own weighted draw, which requires tracking which contributions belong to which cycle over time; that shape of logic still needs its own dedicated reducer, honestly, not force-fit into a stateless condition check. Second, a real, load-bearing constraint on the `unique` primitive specifically: this generic mechanism does not itself accumulate a used-keys history across the fold the way pool-reducer.js's own usedContributionClaimIds does, so a `unique` condition referenced inside a generic contract will always evaluate as "unique" within this specific mechanism — contracts genuinely needing mint-once-style uniqueness tracking across many events still need their own reducer. Recorded here as a real, load-bearing gap in what §27.10 delivers, not smoothed over in the prose describing it.

The Rust mirror (generic_contract_reducer.rs) was built directly, in its final form, alongside the JS version rather than after it — 8 tests mirroring the JS suite's own cases, including the identical end-to-end threshold-escrow demonstration, all passing on the first run. One real, stated divergence between the two mirrors, not hidden: the Rust side requires a condition template to already parse into the real Condition enum via an explicit, hand-written deserializer (parse_condition) — a genuinely stricter requirement than JS's permissive object literal, since Rust's own Condition type has no direct serde derive covering its exact field-per-variant shape without a larger refactor of causal_condition_evaluator.rs this revision does not attempt. Executable detail for both languages, including the real end-to-end verification run against the actual application's own materialization logic (not a standalone unit-test shortcut), is in Appendix H.34.

28. AI Assistance: Advisory, Structurally Non-Authoritative

This section originally described a broader planned scope — module-code generation from natural language, and risk triage of transactions before presenting them to the user. Confirmed directly, this revision narrows AIWA's actual AI layer to a single function: a brainstorming assistant suggesting new module ideas, grounded in a domain's own real registered modules and real contacts (§9), running entirely on-device via WebGPU (idea-agent.js, webllm-engine.js). Code generation and risk triage are not built; this section is corrected to describe what exists rather than retain a broader description the reference implementation no longer targets. The structural rule below is unchanged and, if anything, easier to state precisely now that the scope is narrower: no function in §8–§24 — merge validity, conservation, consumption-uniqueness, or the economic-configuration validation of §27.2 — takes AI-derived input of any kind, and the idea agent has no path into any of them; it produces text a human reads, nothing else. This is what G5 (§3) means concretely: removing the AI layer entirely changes the user experience and removes a convenience, and changes nothing about what the platform will or will not accept as valid.

Deliberately separated, matching this project's established discipline of isolating an untestable browser/GPU primitive from the real logic built on top of it: idea-agent.js — collecting a real context snapshot from this domain's own materialized module registry and real contacts, building the system prompt, and sanitizing the model's reply against a known local-model failure mode (reproducing nearby instruction text verbatim) — is pure, fully tested logic with no WebGPU dependency at all. webllm-engine.js, the piece that actually loads and runs an on-device model in a dedicated Worker, is real code following the same untestable-but-real discipline as solana-rpc.js's network calls: unverifiable under this project's own test runner, since WebGPU and real Worker execution do not exist in that environment, but not a stub standing in for real logic either. Executable detail for the tested half is in Appendix H.27.

Update, this revision: the context snapshot deepened, at the user's own direct request after noticing the earlier version was shallower than a YourMine-inspired brainstorming assistant should be — a flat list of registered modules and an all-time category count, treating what a domain has REGISTERED as equivalent to what it actually USES, and treating one prolific contact's own repeated category choice as indistinguishable from three separate contacts independently converging on the same idea. Three real signals were added, all pulled from data that already exists, is either already public by design (the module registry) or the caller's own private local state (desktop pins, own published profile data) — never another domain's private state, never anything financial, and never a new write path into anything: (i) the caller's own real desktop arrangement (which modules are actually pinned, not merely registered) and own published module data, a genuine usage signal rather than an authorship one; (ii) trending categories, computed from only the most recently registered third of the network's modules rather than an all-time count, so a category three people just started matters more than one from months of accumulated, possibly-stale entries; (iii) category gaps and multi-contact overlap — real set operations distinguishing "a category my contacts have that I don't" and "a category 2+ DISTINCT contacts independently chose" from a flat count that cannot tell the difference between genuine pattern and one person's repeated preference. The structural guarantee stated above is unchanged by this and was checked directly, not merely assumed to still hold: every added signal is read-only, derived entirely from already-materialized state or the caller's own already-real local data, and the enriched snapshot still only ever produces a text suggestion a human reads — no new field reaches any function in §8–§24, and no new write path was added anywhere. Executable detail, including the real tests confirming the multi-contact-versus-one-prolific-contact distinction specifically, is in Appendix H.35.

Update, same revision: a fourth signal, external to AIWA's own network entirely — real, currently-trending software topics from GitHub's own real, official, public search API (a legal, documented, ToS-compliant source; an earlier, informally-described request for a scraping-based source was corrected to this once its own legal exposure was named directly). A small, real, scheduled GitHub Action (update-github-trends.yml, running scripts/fetch-github-trends.mjs once daily) queries GET /search/repositories for recently-created, currently-starred repositories, and commits the shaped result to public/data/github-trends.json — a real, versioned, git-history-auditable file, not a live dependency the deployed app's own availability depends on. The deployed application only ever performs a same-origin static fetch of this already-committed file, matching §7's own "delayed, never blocked" discipline exactly: during a long partition, or before the bot's first scheduled run, or if the fetch simply fails, the idea agent falls back to no external data at all rather than blocking or erroring, confirmed directly by a dedicated test. The committed placeholder file itself, before the bot's first real run, is deliberately empty (fetchedAt: null, an empty repositories array) rather than seeded with fabricated example data — the same "never invent a trend" discipline this section already applies to the model's own prompt, applied here to the file the prompt now reads from. This external signal is kept in its own, separately-labeled prompt section, explicitly told apart from AIWA's own real network data (the prompt states outright that it is "NOT this AIWA network, for inspiration only"), and confirmed by a dedicated test to never be merged into the network-only sharedCategories/trendingCategories fields — an external repository's real programming language must never silently masquerade as evidence of a category trend among this domain's own actual contacts. Freshness is stated honestly in the prompt itself (fetched today vs. fetched N days ago — may be stale) rather than presented as always-current. A real, found-and-fixed deployment bug, not merely a design choice: the file was initially placed at a repository-root data/ directory, which deploy-pages.yml's own real configuration (uploading only the public/ directory as the Pages artifact) would never actually serve — caught by reading that workflow's real configuration directly rather than assuming the path would work, and corrected to public/data/ before this shipped. ci.yml's own paths-ignore list, already excluding the WASM-rebuild bot's automated commits from re-triggering the full suite, was extended to exclude this bot's own daily commit for the identical reason. Executable detail is in Appendix H.36.

Update, same revision: the user then shared the actual real source of the earlier YourMine-inspired exploration §28 had described only in summary — mine-patterns.js and its own generated ym-spec.json — asking directly whether it "inspired" further work, and specifically whether it could help the idea agent. It did, but only after a real architectural correction: the YourMine original mines a single, centralized files.json manifest from one GitHub repository and produces skeleton_by_intent code templates meant to feed a code-GENERATING model — both properties AIWA genuinely lacks or has already deliberately excluded. AIWA's module registry is permissionless and DAG-replicated (module-registry.js); no centralized, crawlable manifest of "every module that exists" is even meaningful, since different domains have reconciled different subsets of the real network — so unlike the GitHub-trends bot above, this could not be a scheduled external bot at all. And §28 has already confirmed, more than once this revision, that code generation stays outside this project's actual AI scope — so the mined output stops at frequency data a human (or the idea agent's own prompt) reads as inspiration, never a code skeleton fed back in for generation, a boundary stated explicitly in module-pattern-miner.js's own header rather than left implicit.

What was built instead, adapted rather than ported: module-pattern-miner.js mines whatever real modules THIS domain already has in its own materialized registry (its own plus its real contacts' — the identical population collectContextSnapshot already draws from), using already-hash-verified source (module-loader.js's own loadVerifiedModuleCode — a real integrity guarantee the YourMine original's raw, unverified fetch never had), and reports which of AIWA's own real ctx primitives (confirmed directly against module-sandbox.js's actual ctx construction before this was written, not carried over from the YourMine original's different ctx surface) real modules actually reach for, and — a genuinely new, useful signal the earlier three additions didn't have — which real ctx primitives no mined module has ever used at all, a concrete "nobody has tried this mechanism yet" hook distinct from a mere category gap. Bounded to a small sample (20 modules) and never awaited inside a render function, the same "delayed, never blocked" discipline as the trends fetch, and for the same reason: mining works identically whether it has finished, is still running, or never started. Rendered in its own, separately-labeled prompt section, confirmed by a dedicated test to never contain a code skeleton or the word "skeleton" at all — only descriptive frequency text. Executable detail is in Appendix H.37.

Safety triage is non-blocking by explicit design. A risk assessment surfaces as a warning to the human operator; it does not gate activation or signing on its own. This is a deliberate choice, not an oversight: an unverified, locally-run model — degraded by a stale spec, an unavailable GPU context, or a corrupted local cache, all local failures with no relationship to the actual risk of the action — is exactly the kind of unstated trust dependency the rest of this paper's methodology (separating what is proved, what is tested, and what is merely assumed) exists to catch. Presenting it as a hard gate would quietly promote a UX aid into a security boundary it was never built to be. Recorded here as the design principle it remains, even though the specific risk-triage feature it was originally written to justify is not, as of this revision, built.

29. Future Work

29.1 Patient-capital optimization under random partition duration. Solve E[Profit(N,b,τ)] from §24.3, where τ ~ F_τ is the unknown, random partition duration and identity/capital acquisition costs are sunk before τ is realized. Characterize the set of distributions F_τ for which patient-capital exploitation is profitable, sup_{N,b} E[Profit(N,b,τ)] > 0 — a heavy-tailed F_τ can make patient capital attractive even at low expected partition duration, purely because reward scales with Q^β while cost does not scale with τ at all. A further extension is the sequential case, where an attacker revises N and b as partition duration becomes observable in real time, rather than committing to both at τ=0 . This is the single most important open problem in this line of work.

29.2 Decaying-rate extension of Proposition 1. Extend §12's argument to issuance rates ρ_d(t) not bounded below by a positive constant — determine whether ∫₀^∞ ρ_d(t) dt < ∞ is achievable under a realistic local policy, or whether the contradiction persists under weaker assumptions.

29.3 Physical-truth experiment. Separate CommitmentIntegrity from PhysicalTruth (§15) empirically, and evaluate which external evidence mechanisms can bridge the gap, at what cost.

29.4 Mechanized verification. Translate the state-transition model of Appendix B into a proof assistant (Isabelle/HOL or TLA+), following the general methodology of Gomes et al. (2017), extending beyond the executable-but-not-machine- checked experiments of §20–22.

29.5 Protocol-level replay-protection test. Directly implement and test the merge-identifier replay-protection mechanism of Appendix B.7, as distinct from and stronger than the economic surrogate currently provided by V4 (§21).

29.6 Calibrating c_id and ψ against real deployment parameters. §24 treats identity-creation cost and capital- acquisition cost as given functions satisfying a stated growth condition, not measured ones. A calibration protocol, not yet executed:

1. Select one or more candidate mechanisms from §24.6's taxonomy.

2. For each, measure or bound registration cost at the relevant scale (identities per domain, issuance rate, expected partition duration from mission-design parameters).

3. Model detection probability as a function of T using realistic interplanetary communication schedules, including periodic conjunction blackouts.

4. Compute effective c_id(T) as (registration cost) × (detection probability | T) — a function of T , not a scalar.

5. Check whether c_id(T) · N* > (expected Sybil profit) for the regime and T of interest, using N* from §24.1's formula for the corresponding α and reward parameters.

6. Report the result as a joint constraint on (mechanism, α, reward-function parameters) , not a single "safe" c_id value.

Until this protocol is executed against mission-design parameters for a specific deployment, §24's model should be cited as a conditional bound with named, unmeasured parameters — not as a calibrated security guarantee.

29.7 Hardware-backed key custody. WebAuthn / secure- enclave integration as an alternative to mnemonic-plus- passphrase custody in the browser (§26).

29.8 Cadence-integrity mechanism. Update, this revision: closed for the
specific property named — bounded advancement — via a real sequential-
hash-chain proof (§16.2, cadence-vdf.js/cadence_vdf.rs), mandatory on
every cadence transition in both languages, with byte-for-byte cross-
language parity confirmed directly (Appendix H.30). Skipped epochs and
duplicated cadence events were already rejected by cadence.js's own
pre-existing structural checks (monotonic +1, causal chaining) before
this revision; what R11 specifically added is that an active, honest-
looking domain can no longer advance through valid epochs faster than
real, physically-irreducible sequential compute time allows. What
remains genuinely open, stated precisely rather than left as a vague
residual: formal (machine-checked) verification of the full transition
rule, per §29.4's own broader open item; crash recovery and long
offline operation, which this mechanism does not change (a domain that
crashes or stays offline simply resumes its own real cadence chain
where it left off, no different from before); and the two honest
limits §16.2 itself already states — this is not a true asymmetric
VDF (verification costs what computation costs), and it does not
address parallel Sybil advancement across many domains, a distinct
concern tracked under §24. Wall-clock integrity remains relevant for
transport and presentation, but was already not a foundational
dependency of economic accrual before this revision either.

29.9 Canonical encoding as a specified part of the wire protocol. §8.1
documents a real cross-implementation id divergence found and fixed in
the reference implementation (JavaScript, Rust), verified by a permanent
test-vector set (Appendix H.5). The fix is a convention followed by two
implementations, not a protocol requirement any third implementation is
forced to discover independently before it can interoperate. The open
work is to specify a canonical byte encoding for event hashing as part of
the protocol itself — a candidate direction is a deterministic
serialization profile (e.g. RFC 8949 CBOR's deterministic encoding, or an
explicit sorted-key JSON canonicalization scheme such as JCS, RFC 8785)
— and to state the corresponding conformance requirement alongside the
other identity rules of §11, so that H(d, c, payload) has one answer
regardless of which language computes it.

29.10 Canonical materialization order as a specified part of the
protocol. §9.1 documents a second, related gap found the same way §8.1's
was: by building two independent implementations and checking they
actually agree, rather than assuming §9's "deterministic function of the
converged event set" is self-enforcing. It is enforced in the reference
implementation only because both languages happen to implement the same
id-sorted depth-first tie-breaking rule for topological order (Appendix
H.7). The open work is the same shape as §29.9's: specify the
tie-breaking rule for topological order as a conformance requirement
alongside the identity rules of §11 and the canonical-encoding
requirement of §29.9, rather than leaving "some deterministic order"
under-specified and hoping every implementation converges on the same
one by coincidence.

30. Design Principles

1. Separate conservation from accrual — moving an existing claim and creating a new claim are different operations

with different failure modes.

2. Replicate events, not derived balances — H = {events} as replicated state, A = G(H,θ) as a deterministic view over it, always.

3. Do not hide scarcity — if autonomous issuance must remain bounded, name the scarce resource enforcing the bound, and its acquisition cost.

4. Do not confuse commitment with truth — a commitment establishes historical consistency relative to an anchor, never physical reality.

5. Make security requirements depend on economic semantics — identity, timestamps, and commitments must preserve exactly the information the economic function actually uses, no more (Lemma 1).

6. Do not let a reward function's distributional design ( α , β ) be chosen independently of its Sybil-resistance consequences — §24.2's trade-off is one design decision with two effects, not two separate decisions.

7. Extensibility must not imply elevated trust — a module can extend the platform's surface area without ever being trusted with money movement, other users' data, or the network stack by default.

8. Advisory components must be structurally non- authoritative — if removing a component silently changes what the platform will accept as valid, that component was never advisory to begin with.

31. Discussion

Interplanetary communication does not make coordinated applications impossible; it changes where coordination and scarcity must reside, and forces an honest accounting of what depends on what. A conventional platform places coordination in a server, a single chain's validator set, or a centrally issued session — all reachability-dependent by construction. AIWA distributes operation across domains instead, but distribution does not remove scarcity or trust dependencies; it forces the architecture to say explicitly where each one lives. Local autonomy plus a preallocated budget is feasible. Local autonomy plus a rate limit is feasible over bounded horizons only. Local autonomy plus expiring rights is a third, distinct construction with its own trade-off. What cannot be obtained simultaneously — not as an implementation shortfall but as a property of the model, per Proposition 1 — is unrestricted autonomous issuance, arbitrarily long partition, and a fixed global supply, without an additional named constraint.

The same discipline applies outside the economic layer. A module system that sandboxes third-party code well still cannot make an advisory AI component load-bearing for security without contradicting its own advisory status. A transport layer that is genuinely pluggable still requires every layer above it to actually respect that boundary, or the pluggability is cosmetic. AIWA's contribution across all seven layers is the same move applied consistently: name the dependency, state what it does and does not guarantee, and test what can be tested rather than asserting it.

32. What This Architecture Does Not Claim

Globally instantaneous settlement; arbitrary autonomous issuance with a fixed global supply; perfect physical-time synchronization; perfect Sybil resistance (§24 gives a partial, cost-conditional bound, not a proof of resistance); proof that committed events physically occurred; automatic Byzantine security from replicated-data-type convergence alone; unlimited operation without a scarce resource; machine- checked correctness of any layer; any security guarantee whatsoever from the AI layer; hardware-grade key custody in a browser environment. The architecture identifies the assumptions required for each guarantee it does offer, rather than claiming to provide all of them.

33. Conclusion

This paper set out to answer what remains achievable when an application platform must keep operating while some of its domains cannot communicate at all, for an unknown length of time. The answer is not that this is impossible — it is that the guarantees involved must be separated, named individually, and given honest boundaries. Existing value can be conserved through proof-carrying state transitions with a replay-resistant consumption guard. New value can be represented as a replicated event set, provided event identity is exactly as strong as the economic function requires (Lemma 1) and that function is deterministic over the replicated state alone. Historical integrity is available through cryptographic commitments, but commitments cannot establish physical truth. Third-party extensibility is available without granting elevated trust, provided the sandbox boundary is a hard runtime constraint rather than a convention. An AI layer can

meaningfully assist without ever being allowed to gate a security decision, provided that boundary is enforced structurally rather than by policy.

Autonomous issuance has a fundamental boundary, proved rather than asserted: for arbitrarily long partitions with issuance bounded below by a positive rate, unrestricted autonomy, independent issuance, full retention, and a fixed global supply cannot coexist without an additional, named scarce constraint. The platform cannot eliminate scarcity or trust dependencies; it can only choose where each is enforced — and, per §24, at what cost that enforcement resists a rational, capital-acquiring, patient adversary. That cost model is deliberately incomplete: it identifies identity-creation cost, not reward concavity, as the load-bearing anti-Sybil mechanism whenever the reward function is chosen to avoid wealth concentration, and it connects patient-capital exploitation directly to the reward function's own time-dependence — but the dynamic, random-partition-duration version of that question (§29.1) remains the field's most important open problem, restated here as AIWA's own.

The experiments in §20–22 reinforce the convergence-level conclusions with real, reproducible numbers rather than illustrative ones: correct event-set replication converges under every tested delivery fault (500/500 trials); deliberately removing per-event deduplication, deterministic materialization, or replay protection produces counterexamples in 100% of trials, with the acknowledged caveat that the replay-protection counterexample is an economic surrogate rather than a test of the protocol-level guard itself. The weak-identity experiment confirms, on executable code, a condition that follows directly from the

platform's own definitions — its value is confirmation and scope-clarification, not discovery.

AIWA provides a formal and experimentally tested foundation for separating conservation, autonomous accrual, evidence, observability, extensibility, and presentation under interplanetary partition; establishes a fundamental, proved constraint on autonomous issuance (Proposition 1); gives a cost-explicit, still partial, account of what bounds Sybil and patient-capital profit once identity and capital acquisition are not free (§24); and specifies a seven-layer reference architecture — transport, identity, ledger, economics, modules, AI, presentation — whose tested guarantees and remaining dependencies are made explicit rather than implied.

Editorial status of v1.1 revised

This revision intentionally narrows claims rather than presenting unresolved mechanisms as
completed security properties. In particular, cadence integrity is treated as a load-bearing
dependency: replacing a wall clock with a logical cadence counter removes direct clock
manipulation from the reward input, but a logical counter is not itself proof that economic
epochs advance at a physically bounded rate. Likewise, the protocol-level merge replay guard
is specified but not directly exercised by the executable experiments. The economic-security
model remains conditional and uncalibrated, and the patient-capital problem under random or
adaptive partition duration remains open. These are architectural boundaries, not deferred
disclaimers.

Appendix A — Notation

Symbol Meaning

D Set of AIWA domains

H_d Accepted local event set for domain d

A_d Materialized accrual state, A_d = G(H_d, θ)

G Materialization (economic-policy) function

C_d Latest commitment for domain d

B_d Local issuance budget or constraint

Symbol Meaning

I(T) Cumulative issuance over interval T

Currently valid (unexpired, unconsumed) supply S(T) at time T ; S(T) ≤ I(T)

Reconciled/redeemable supply at time T ; R(T) R(T) ≤ S(T)

ρ_d Issuance rate for domain d

Reward function of committed resource b and elapsed economic age t (§10)

N Number of identities (Sybil analysis)

K, α, Reward-function constants and exponents β

c_id Fixed cost to create one Sybil identity (§24.1)

Capital-acquisition cost function; safety requires ψ(·) ψ(x)/x^α → ∞ (§24.3)

Profit-maximizing number of identities, N* continuous relaxation

Partition duration, random variable τ ~ F_τ τ (§24.3, §29.1)

M_e Merge operation for epoch e

ID_M Unique merge identifier

Δ Heartbeat/cadence interval

Appendix B — Formal Specification and Reference Pseudocode

B.1 State. For each domain d : State_d = (H_d, A_d, C_d, B_d, i_d, q_d) . Global state: State = (State_E, State_M, Communication, MergeSet) .

B.2 Local event. e = (id, d, payload, θ, q) , where q is the economic
cadence epoch at which the event is accepted. For cadence-sensitive economic
functions, q MUST be included in the identity whenever omitting it could
merge events with different economic meaning. Two distinct accepted events
must never share an identifier.

B.3 Local update. Precondition: Valid(e) = true . Transition: H_d' = H_d ∪ {e} . Then: A_d' = G(H_d', θ) .

B.4 Merge. MergeHistory(H₁, H₂) = H₁ ∪ H₂ , required to satisfy idempotence, commutativity, and associativity (§8, §14).

B.5 Economic validation. An event is accepted only if Valid(e, H, θ, B_d) = true . For a budgeted domain: Issued(H_d) ≤ B_d .

B.6 Commitment. C_{d,i} = H(v, g, d, i, q_d, C_{d,i−1}, A_{d,i}) .
Commitment index must increase monotonically: i_new > i_old. The economic
cadence epoch q_d must also satisfy the configured cadence-transition rule.

B.6.1 Cadence transition. A valid economic cadence transition is an
event bound to the preceding commitment and protocol version. Its transition
rule is:

  q_d' = q_d + 1

unless a deployment specifies another bounded-advancement rule. Acceptance
requires the transition to be valid, non-replayed, and consistent with the
domain's committed history. Wall-clock time MUST NOT be used to increase q_d
by more than the protocol rule permits.

B.7 Merge identifier (replay guard). ID_M = H(v, g, e, C_E, C_M) . Acceptance requires ID_M ∉ MergeSet . After acceptance: MergeSet' = MergeSet ∪ {ID_M} . (Specified here; not yet exercised by an executable test at the protocol level — V4 in §21 tests only the economic surrogate. See §29.4.)

B.8 Merge state. H' = H_E ∪ H_M , then A' = G(H', θ) . Accepted only if Valid(H', θ) = true .

Lemma B.1 — Order-independent convergence. If all replicas eventually observe the same set of updates and merge using a join-semilattice operation, merge order does not affect the final state. Proof sketch: associativity eliminates grouping dependence; commutativity eliminates order dependence; idempotence eliminates duplicate-update dependence. Empirically confirmed for the event-set instance in §20.

Lemma B.2 — Local envelope implies aggregate envelope. If I_d(T) ≤ B_d(T) for every domain d , then Σ_d I_d(T) ≤ Σ_d B_d(T) . This establishes an aggregate bound but does not by itself establish the desired global economic policy — see §12–13.

Reference pseudocode (ready to port to a concrete implementation):

// --- Event structure --- Event = { id: hash(domain, counter, payload), // full-width hash, never truncated domain: string, counter: integer, payload: number, theta: PolicyParams }

// --- Local acceptance (§B.3) --- function acceptEvent(H_d, e, theta_d, B_d): assert Valid(e, H_d, theta_d, B_d) // well-formed, within budget, module invariants hold H_d' = H_d ∪ {e} A_d' = G(H_d', theta_d) // G deterministic over H_d' alone — no order dependence return (H_d', A_d')

// --- Merge (§B.4) --- function merge(H1, H2): return H1 ∪ H2 // idempotent, commutative, associative by construction

// --- Materialization, first-representative-wins
dedup (§9, §11) ---
function G(H, theta):
total = 0
for e in dedupe_by_id(H):
total += reward(e, theta)
return total

// --- Event identity selection at module registration (Lemma 1, §11) --- function selectIdentityScheme(module): if module.declaresTimeSensitiveReward: return e -> hash(e.domain, e.counter, e.payload) // strong identity else: return e -> hash(e.domain, e.payload) // weak identity — safe per Lemma 1

// --- Commitment chain (§15, §B.6) --- function commit(C_prev, d, n, A_n): assert n > C_prev.index return hash(PROTOCOL, GENESIS, d, n, C_prev, A_n)

// --- Merge replay guard (§B.7) --- function acceptMerge(e, C_E, C_M, MergeSet): id_m = hash(VERSION, GENESIS, e, C_E, C_M) assert id_m not in MergeSet MergeSet' = MergeSet ∪ {id_m} return MergeSet'

// --- Economic configuration validation at module registration (§24, §27.2) --- function validateEconomicConfig(alpha, c_id, psi): if alpha <= 1 and c_id == 0: reject("alpha<=1 with zero identity cost: unbounded splitting incentive") if psi is given in closed form: if not growthConditionHolds(psi, alpha): // psi(x)/x^alpha -> infinity reject("capital-acquisition cost does not dominate reward growth") return accept

// --- Wallet consumption guard (§7) --- function consume(proof, ConsumedSet): assert proof.id not in ConsumedSet // count(Consume(p)) <= 1 ConsumedSet' = ConsumedSet ∪ {proof.id} return ConsumedSet'

Appendix C — Counterexamples

C.1 Non-idempotent scalar merge. If Merge(A_E, A_M) = A_E + A_M , then Merge(100,100) = 200 ≠ 100 . Reproduced in §21's V1 (100% divergence, 200/200 trials).

C.2 Duplicate issuance event. With list semantics, delivering e = (id=42, reward=10) twice gives G([e,e]) = 20 ; with set semantics keyed on id , {e,e} = {e} gives G({e}) = 10 . Confirmed in §20's baseline mechanism and its inverse failure mode in §21's V1.

C.3 Non-idempotent merge application. Without a merge identifier and consumption guard, applying a merge function twice to the same contribution may produce two economically

active reconciliations; with ID_M and the acceptance check of Appendix B.7, a resubmitted merge is rejected as a replay. §21's V4 experiment empirically confirms the economic consequence of the missing guard (100% divergence, exactly 2× the correct value); it is an economic surrogate for this failure mode, not a test of the ID_M / MergeSet mechanism itself (§29.4).

C.4 Weak identity, per Lemma 1. The identical weak-identity scheme ( id = H(domain, payload) ) produces 0% divergence under r(b)=b and 97.7–100% divergence under r(b,t)=K·b·(1+β·t) , under first-representative-wins deduplication — exactly as Lemma 1 (§11) predicts. Full derivation: §22.

C.5 Sybil profit at α ≤ 1 without identity cost. Under r(b)=K·b^α with α<1 and c_id=0 , Profit(N) = K·B^α·N^{1-α} is strictly increasing in N without bound — reward concavity, which addresses only α>1 , gives no counterexample-resistance claim for this regime. §24.1 derives the finite N* that a positive c_id restores.

Appendix D — Worked Sybil-Cost and Issuance Examples

D.1 Partition issuance, worked by hand. With ρ_E = ρ_M = 1 unit/hour: after T=1000h , I_global=2000 ; after T=10000h , I_global=20000 . No finite supply bound survives indefinitely under unrestricted autonomous issuance, matching §12's argument directly. With B_E = B_M = 5000 , I_global ≤ 10000 — but once one domain exhausts its allocation, autonomous issuance from that domain stops, illustrating

§13.1's trade-off. Superseded by the executed simulation in Appendix H.4, which reproduces these exact numbers as one of four tested policies.

D.2 Numerical illustration of N* (continuous relaxation, fixed t, α ≠ 1). [Uses the power-law reference form pre-dating §10's Proof-of-Will revision — see §24.1's note. Retained as a worked example for that configuration, not updated for the current reference formula, whose Sybil-profit shape has not yet been re-derived.] K=1, B=1000, t=1, α=0.5, c_id=5 :

N* = [K·B^α·t^β·(1−α)/c_id]^(1/α) = [1·1000^0.5·1·0.5/5]^(1/0.5) = [3.162]^2 ≈ 10.0

N=10 is already integer, so no rounding comparison is needed
for this parameter choice (a different c_id would generally
require checking ⌊N*⌋ vs ⌈N*⌉ explicitly, per §24.1's integrality
note). Doubling c_id to 10: N* = 10·(1/2)^2 = 2.5 —
identity cost has a large effect on the optimal split at low α ,
because 1/α=2 amplifies cost sensitivity. Verified by direct
computation: 1000^0.5·0.5/5 = 10.0 exactly at c_id=5 ;
2.5 at c_id=10 .

Appendix E — Security Property Registry (Full)

Following the five-category discipline stated in §17, tagging each property by the strength of claim it actually represents rather than presenting a flat, uniformly-strong list.

# Property Category Status

Proved from Single-use proof R1 Safety invariant §7's consumption construction

# Property Category Status

Proved; atomic Crash-safe check-then- R2 Safety invariant consumption record required by construction

Proved from Source/destination R3 Safety invariant §7's proof binding structure

Proved; the derivation R4 Derivation binding Safety invariant function is bound into the proof

Specified (Appendix B.7); not yet tested Merge uniqueness at the protocol R5 Safety invariant ( ID_M / MergeSet ) level — economic surrogate only (V4, §21)

Proved as a join-semilattice consequence Convergence (Lemma B.1); R6 Merge determinism property confirmed empirically (§20, §21 V3- control)

# Property Category Status

Enforced by construction; Safety/economic R7 Merge validity not (spans both) exhaustively fuzz-tested

Enforced by construction; Safety/economic R8 Merge conservation not (spans both) exhaustively fuzz-tested

Proved from definitions (§11); Unique event Cryptographic / confirmed R9 identity, per Lemma design empirically 1 assumption (§22); scope limited to first- representative- wins dedup

Standard hash assumption; Commitment-chain Cryptographic does not R10 integrity assumption establish physical truth (§15)

R11 Cadence integrity Sequential-hash-chain Closed, this revision (§16.2). Bounds the rate of advancement, not a true asymmetric VDF (verification costs what computation costs); does not address parallel Sybil advancement across many domains (§24).

# Property Category Status

Proved Economic Sybil resistance, unconditionally R12 security α>1 regime for this regime assumption (§24.1)

Weakest category. Conditional on Economic positive c_id , Sybil resistance, R13 security uncalibrated, α≤1 regime assumption fixed-duration simplification only (§24.1– 24.4)

Conditional on stated growth Economic Capital-acquisition condition, not R14 security cost sufficiency mere convexity assumption (§24.3); uncalibrated

Not established. Economic Random- Patient-capital R15 security duration case bound assumption posed, not solved (§24.3, §29.1)

# Property Category Status

Proved algebraically; Budget / rate-limit / Economic policy confirmed R16 expiry-window enforcement numerically integrity (§21, Appendix H.4)

Proved algebraically (§13.2); RateBound ≠ Economic R17 confirmed SupplyBound design fact numerically (Appendix H.4, Policy C)

Proved (Lemma B.1); Reconciliation Convergence R18 confirmed determinism property empirically (§20)

Module sandboxing (storage isolation, no fetch interception, no signing) Enforced as hard runtime constraints (§27.1), concrete mechanism given in §27.4 R19 Safety invariant specified and implemented (real sandboxed iframe, content-addressed code); not adversarially tested against escape attempts, and not exercised against a real browser DOM in this development environment

# Property Category Status

Enforced structurally — AI non-authority validation R20 over security Design invariant functions take decisions no AI-derived input (§28)

Enforced by interface Transport design (§25); pluggability without not yet fuzz- leakage of R21 Design invariant tested against transport-specific a malicious assumptions custom upward transport implementation

Implemented (§25); reduces but does not Connection- Reliability eliminate the R22 watchdog self- property (not need for healing strictly security) manual reconnection under degraded conditions

Weaker than hardware- Browser-based key External-trust backed R23 custody assumption custody; stated confidentiality limitation (§26, §29.7)

The economic security category (R12–R15) is, by construction of this paper's own analysis, the weakest set of claims in this registry, and is exactly the set §29.1 and §29.4 identify as needing further work before any AIWA deployment should be described as "Sybil-resistant" without qualification attached.

Appendix F — Threat-to-Guarantee Matrix

Primary Threat Residual limitation defense

Implementation Proof replay R1/R2 failure still possible

Fabrication from genesis remains History rewrite R10 possible without external evidence

External evidence (not Physical truth not Fabricated history supplied by guaranteed AIWA)

Dynamic/multi- R12/R13, period case Sybil splitting cost- unsolved (§29.1); conditional cost parameters uncalibrated (§29.4)

Primary Threat Residual limitation defense

Effective cost falls R13 + time- with partition Patient capital dependence duration; not yet of r(b,t) bounded (§24.3)

Requires a trusted reference AIWA Clock acceleration R11 does not currently provide

Economic surrogate tested (V4); Merge replay R5 protocol-level guard not yet tested

Depends on economic-policy Merge R6–R8 correctness, not manipulation exhaustively fuzz- tested

Event identity Does not prove Transport + merge message content replay/reorder/drop semantics truth

Does not protect Malicious/buggy R19 against user error in module sandboxing confirming a signature

R19 + R20 Same residual risk Malicious AI- (no elevated as any third-party generated code trust) code

Primary Threat Residual limitation defense

Schedule/cadence §16 correctness Blackout confusion observability required, trade-off deployment-specific

Autonomy may be Proposition reduced by Supply inflation 1's corollary, whichever scarcity §13 mechanism is chosen

Only if G is R9, time/order- Weak-identity value conditional independent, under collapse (Lemma 1) first-representative- wins dedup

Appendix G — Reproducibility and Verification Checklist

State model. Replicated state defined? Yes (B.1). Materialized state distinguished from replicated state? Yes (§9, B.1). Merge operator specified? Yes (B.4).

Convergence. State partially ordered? Yes. Merge associative/commutative/idempotent? Yes, by construction. Local updates monotonic? Yes. Eventual convergence tested? Yes — §20, 500/500 trials, actual output reported.

Issuance. Issuance defined? Yes (§8). Budget explicit? Yes (§13); simulated across four policies (Appendix H.4, actual output reported). Partition duration modeled? Simulated at hourly resolution to T=100,000h (Appendix H.4). Global supply bounded? Only under an explicit additional constraint (§12– 13); the I(T) / S(T) distinction and the expiring-rights case are confirmed by simulation, not only argued algebraically.

Merge. Uniqueness tested? Not at protocol level — economic surrogate only (V4). Determinism tested? Yes (§21, V3-control and V3-broken). Validity/conservation tested directly by fuzzing? Not yet — flagged for future work.

Sybil/economic. Reward-concavity claim alone treated as sufficient? No — §24.1 shows this fails for α≤1 . Identity- creation cost modeled explicitly? Yes, algebraically (§24.1); not calibrated (§29.4). Capital-acquisition cost modeled? Yes, algebraically (§24.3); not calibrated. Patient-capital threat connected to reward's time-dependence? Yes (§24.3). Partition-delay problem for identity verification addressed? Yes, §24.6 gives the three-way decomposition of c_id ; not solved. Dynamic multi-period case solved? No — §29.1, explicitly open. Any of §24 backed by executed code? No — algebraic and numerical-illustration only (Appendix D.2); a disclosed limitation, not an oversight.

Evidence. Commitments externally retained? Specified (B.6); not simulated. Rewrite detection tested? Not yet executed. Fabrication tested separately? Not yet executed (§29.3).

Cadence. Bandwidth/detection latency measured? Algebraically (§16); not simulated.

Extensibility. Sandboxing constraints enforced as hard runtime checks? Yes (§27.1). Fuzz-tested against adversarial module

code? Not yet.

AI layer. Structural non-authority enforced? Yes, by construction (§28) — validation functions accept no AI-derived input. Verified by code review that no exception exists? Stated as a design invariant; not yet audited against the full module registry for accidental exceptions.

Formal verification. Model checker executed? No — the pseudocode of Appendix B has not been mechanized; this remains future work (§29.4). Has every claimed invariant been tested? Partially — convergence and weak-identity claims tested directly; merge-replay guard tested only via economic surrogate; Sybil claims algebraic only. Has at least one deliberate invariant violation produced a counterexample? Yes — four of five tested variants in §20–22, plus the algebraic Sybil counterexample in Appendix C.5.

Appendix H — Full Experimental Source Code

The scripts below correspond exactly to the results reported in §20–22 (H.1–H.3) and §21/§13's simulation (H.4). All four require only the Python 3 standard library, use random.Random(seed) with explicitly stated seeds, and were executed to produce every number quoted in the main text — nothing in §20–22 is asserted without a corresponding run recorded here.

H.1 — Convergence Primitive

"""
AIWA Experiment 1 -- post-partition convergence
primitive.
Tests whether two AIWA domains (e.g. an Earth
relay and a Mars settlement),
after independently accumulating local ledger
events and then both
receiving the same complete event set through a
channel that reorders
and duplicates but never permanently drops
messages, converge to the
same replicated state and the same materialized
value.
"""
import hashlib, json, random
from dataclasses import dataclass

@dataclass(frozen=True)
class Event:
domain: str
counter: int
payload: float
@property
def id(self):
return hashlib.sha256(f"{self.domain}:
{self.counter}:
{self.payload}".encode()).hexdigest()
def reward(self):
return self.payload

def canonical_hash(H):
return
hashlib.sha256(json.dumps(sorted(H.keys())).encode
()).hexdigest()

def materialize(H):
return sum(e.reward() for e in H.values())

def deliver_with_faults(events, *,
duplicate_prob=0.3, max_dupes=3, seed=None):
rng = random.Random(seed)
stream = []
for e in events:
stream.append(e)
if rng.random() < duplicate_prob:
for _ in range(rng.randint(1,
max_dupes)):
stream.append(e)
rng.shuffle(stream)
return stream

def run_trial(n_earth=40, n_mars=40, seed=None):
rng = random.Random(seed)
earth = [Event("earth", i,
round(rng.uniform(1,100),4)) for i in
range(n_earth)]
mars = [Event("mars", i,
round(rng.uniform(1,100),4)) for i in
range(n_mars)]
all_events = earth + mars
s_e = deliver_with_faults(all_events, seed=
(seed or 0)*2+1)
s_m = deliver_with_faults(all_events, seed=
(seed or 0)*2+2)
H_E, H_M = {}, {}
for e in s_e: H_E[e.id] = e
for e in s_m: H_M[e.id] = e
return {
"sets_equal":
set(H_E.keys())==set(H_M.keys()),
"hash_equal":
canonical_hash(H_E)==canonical_hash(H_M),
"materialized_equal":
materialize(H_E)==materialize(H_M),
"A_E": materialize(H_E), "A_M":
materialize(H_M),

"n_delivered_E": len(s_e), "n_delivered_M": len(s_m), "n_unique_E": len(H_E), "n_unique_M": len(H_M), }

def main():
N=500
results=[run_trial(seed=t) for t in range(N)]
print(f"Trials: {N}")
print(f"Set convergence rate:
{sum(r['sets_equal'] for r in results)/N:.4f}")
print(f"Hash convergence: {all(r['hash_equal']
for r in results)}")
print(f"Materialized convergence:
{all(r['materialized_equal'] for r in results)}")
s=results[0]
print("Sample trial 0:", {k:s[k] for k in
['A_E','A_M','n_delivered_E','n_delivered_M','n_un
ique_E','n_unique_M']})

if __name__=="__main__":
main()

Actual output (Python 3.12, run for this paper):

Trials: 500 Set convergence rate: 1.0000 Hash convergence: True Materialized convergence: True Sample trial 0: {'A_E': 4550.7306, 'A_M': 4550.7306, 'n_delivered_E': 111, 'n_delivered_M': 98, 'n_unique_E': 80, 'n_unique_M': 80}

H.2 — Broken-Invariant Counterexamples (V0/V1/V3/V4)

import hashlib, random
from dataclasses import dataclass

@dataclass(frozen=True)
class Event:
domain: str; counter: int; payload: float
@property
def id(self):
return hashlib.sha256(f"{self.domain}:
{self.counter}:
{self.payload}".encode()).hexdigest()

def deliver_with_faults(events, *,
duplicate_prob=0.3, max_dupes=3, seed=None):
rng = random.Random(seed)
stream=[]
for e in events:
stream.append(e)
if rng.random() < duplicate_prob:
for _ in
range(rng.randint(1,max_dupes)):
stream.append(e)
rng.shuffle(stream)
return stream

def gen_events(n_earth=40, n_mars=40, seed=0):
rng = random.Random(seed)
earth=
[Event("earth",i,round(rng.uniform(1,100),4)) for
i in range(n_earth)]
mars=
[Event("mars",i,round(rng.uniform(1,100),4)) for i
in range(n_mars)]
return earth+mars

def v0_control(seed):
events=gen_events(seed=seed)
s_e=deliver_with_faults(events,

seed=seed*2+1); s_m=deliver_with_faults(events,
seed=seed*2+2)
H_E,H_M={},{}
for e in s_e: H_E[e.id]=e
for e in s_m: H_M[e.id]=e
A_E=sum(e.payload for e in H_E.values());
A_M=sum(e.payload for e in H_M.values())
return abs(A_E-A_M)<1e-9, A_E, A_M

def v1_dup_sensitive(seed):
events=gen_events(seed=seed)
s_e=deliver_with_faults(events,
seed=seed*2+1); s_m=deliver_with_faults(events,
seed=seed*2+2)
A_E=sum(e.payload for e in s_e);
A_M=sum(e.payload for e in s_m)
return abs(A_E-A_M)<1e-9, A_E, A_M

def v3_order_sensitive(seed):
events=gen_events(seed=seed)
s_e=deliver_with_faults(events,
seed=seed*2+1); s_m=deliver_with_faults(events,
seed=seed*2+2)
H_E,order_E={},[]; H_M,order_M={},[]
for e in s_e:
if e.id not in H_E: H_E[e.id]=e;
order_E.append(e)
for e in s_m:
if e.id not in H_M: H_M[e.id]=e;
order_M.append(e)
A_E=sum(e.payload*(0.999**i) for i,e in
enumerate(order_E))
A_M=sum(e.payload*(0.999**i) for i,e in
enumerate(order_M))
return abs(A_E-A_M)<1e-9, A_E, A_M

def v4_double_merge(seed):
events=gen_events(seed=seed)

s_e=deliver_with_faults(events,
seed=seed*2+1); s_m=deliver_with_faults(events,
seed=seed*2+2)
H_E,H_M={},{}
for e in s_e: H_E[e.id]=e
for e in s_m: H_M[e.id]=e
A_E_local=sum(e.payload for e in H_E.values()
if e.domain=="earth")
A_M_local=sum(e.payload for e in H_M.values()
if e.domain=="mars")
def merge_no_guard(state, contrib): return
state+contrib
g=0.0
g=merge_no_guard(g, A_E_local+A_M_local)
g=merge_no_guard(g, A_E_local+A_M_local)
correct=A_E_local+A_M_local
return abs(g-correct)<1e-9, g, correct

def run_suite(fn, name, n=200):
diverged=0; example=None
for t in range(n):
ok,a,b=fn(t)
if not ok:
diverged+=1
if example is None: example=(t,a,b)
rate=diverged/n
print(f"{name:38s} divergence_rate={rate:6.2%}
({diverged}/{n})")
if example:
t,a,b=example
print(f" counterexample @ trial {t}:
A_E={a!r} A_M={b!r} diff={abs(a-b):.6f}")
return rate

if __name__=="__main__":
run_suite(v0_control, "V0 control")
run_suite(v1_dup_sensitive, "V1 duplicate-
sensitive accumulation")

run_suite(v3_order_sensitive, "V3 order- sensitive materialization") run_suite(v4_double_merge, "V4 no merge-id guard (double merge)")

Actual output:

V0 control divergence_rate= 0.00% (0/200) V1 duplicate-sensitive accumulation divergence_rate=100.00% (200/200) counterexample @ trial 0: A_E=6506.6038 A_M=5609.3685 diff=897.235300 V3 order-sensitive materialization divergence_rate=100.00% (200/200) counterexample @ trial 0: A_E=4379.789371332641 A_M=4378.907158376117 diff=0.882213 V4 no merge-id guard (double merge) divergence_rate=100.00% (200/200) counterexample @ trial 0: A_E=9101.4612 A_M=4550.7306 diff=4550.730600

H.3 — Weak Identity Under Time-Dependent Reward

import hashlib, random
from dataclasses import dataclass
K=1.0; BETA=1.0

@dataclass(frozen=True)
class Event:
domain:str; counter:int; payload:float
@property
def id_strong(self): return hashlib.sha256(f"
{self.domain}:{self.counter}:
{self.payload}".encode()).hexdigest()

@property
def id_weak(self): return hashlib.sha256(f"
{self.domain}:
{self.payload}".encode()).hexdigest()
def reward(self): return K*self.payload*
(1+BETA*self.counter)

def
deliver_with_faults(events,*,duplicate_prob=0.3,ma
x_dupes=3,seed=None):
rng=random.Random(seed); stream=[]
for e in events:
stream.append(e)
if rng.random()<duplicate_prob:
for _ in
range(rng.randint(1,max_dupes)): stream.append(e)
rng.shuffle(stream); return stream

def gen_events_collision(n_earth=40,n_mars=40,seed=0,q uantize=5.0): rng=random.Random(seed) earth= [Event("earth",i,round(round(rng.uniform(1,20)/qua ntize)*quantize,4)) for i in range(n_earth)] mars= [Event("mars",i,round(round(rng.uniform(1,20)/quan tize)*quantize,4)) for i in range(n_mars)] return earth+mars

def materialize(stream, attr):
seen=set(); H=[]
for e in stream:
k=getattr(e,attr)
if k not in seen: seen.add(k); H.append(e)
return sum(e.reward() for e in H), len(H)

def run_trial(seed, quantize):

events=gen_events_collision(seed=seed, quantize=quantize) s_e=deliver_with_faults(events, seed=seed*2+1); s_m=deliver_with_faults(events, seed=seed*2+2) A_E_s,_=materialize(s_e,"id_strong"); A_M_s,_=materialize(s_m,"id_strong") A_E_w,_=materialize(s_e,"id_weak"); A_M_w,_=materialize(s_m,"id_weak") return {"strong_converges":abs(A_E_s-A_M_s) <1e-9, "weak_converges":abs(A_E_w-A_M_w)<1e-9,

"A_E_s":A_E_s,"A_M_s":A_M_s,"A_E_w":A_E_w,"A_M_w": A_M_w}

if __name__=="__main__":
for q in [10.0,5.0,2.0]:
print(f"=== Quantization {q} ===")
n=300
results=[run_trial(t,q) for t in range(n)]
sd=sum(not r["strong_converges"] for r in
results)
wd=sum(not r["weak_converges"] for r in
results)
print(f" strong-id divergence: {sd}/{n}
({sd/n:.1%})")
print(f" weak-id divergence: {wd}/{n}
({wd/n:.1%})")
if wd>0:
ex=next(r for r in results if not
r["weak_converges"])
print(f" counterexample: A_E_w=
{ex['A_E_w']:.4f} A_M_w={ex['A_M_w']:.4f} diff=
{abs(ex['A_E_w']-ex['A_M_w']):.4f}")
print(f" strong same trial: A_E=
{ex['A_E_s']:.4f} A_M={ex['A_M_s']:.4f} match=
{abs(ex['A_E_s']-ex['A_M_s'])<1e-9}")

Actual output:

=== Quantization 10.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 293/300 (97.7%) counterexample: A_E_w=1730.0000 A_M_w=1270.0000 diff=460.0000 strong same trial: A_E=19810.0000 A_M=19810.0000 match=True === Quantization 5.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 300/300 (100.0%) counterexample: A_E_w=2780.0000 A_M_w=2085.0000 diff=695.0000 strong same trial: A_E=19795.0000 A_M=19795.0000 match=True === Quantization 2.0 === strong-id divergence: 0/300 (0.0%) weak-id divergence: 300/300 (100.0%) counterexample: A_E_w=4534.0000 A_M_w=4456.0000 diff=78.0000 strong same trial: A_E=19648.0000 A_M=19648.0000 match=True

H.4 — Issuance-Bound Simulation Under Four Scarcity Policies

# AIWA issuance-bound simulation across 4 scarcity
policies, hourly resolution.
def simulate(T_max=100000, rho_e=1.0, rho_m=1.0,
policy="A", budget_e=5000, budget_m=5000,
rho_max=1.0, t_exp=500):
I=0.0; used_e=0.0; used_m=0.0
active=[] # (issue_time, amount) for
expiring-rights policy S(T)
snapshot_times=[1000,10000,50000,100000]

snaps={}
for T in range(1, T_max+1):
if policy=="A":
I += rho_e+rho_m
elif policy=="B":
add_e = min(rho_e, budget_e-used_e) if
used_e < budget_e else 0.0
add_m = min(rho_m, budget_m-used_m) if
used_m < budget_m else 0.0
used_e+=add_e; used_m+=add_m; I +=
add_e+add_m
elif policy=="C":
I += min(rho_e, rho_max)+min(rho_m,
rho_max)
elif policy=="D":
active.append((T, rho_e+rho_m))
I += rho_e+rho_m
active = [(t0,a) for (t0,a) in active
if T - t0 < t_exp]
if T in snapshot_times:
S = sum(a for (_,a) in active) if
policy=="D" else None
snaps[T] = (I, S)
return snaps

if __name__=="__main__":
for policy,label in [("A","Unbounded"),
("B","Preallocated budget (5000+5000)"),
("C","Rate limit only
(rho_max=1)"),("D","Expiring rights
(t_exp=500h)")]:
snaps = simulate(policy=policy)
print(f"\nPolicy {policy} -- {label}")
for T,(I,S) in snaps.items():
if S is None:
print(f" T={T:>7}h I(T)=
{I:>10.1f}")
else:

print(f" T={T:>7}h I(T)= {I:>10.1f} S(T)={S:>10.1f}")

Actual output:

Policy A -- Unbounded T= 1000h I(T)= 2000.0 T= 10000h I(T)= 20000.0 T= 50000h I(T)= 100000.0 T= 100000h I(T)= 200000.0

Policy B -- Preallocated budget (5000+5000) T= 1000h I(T)= 2000.0 T= 10000h I(T)= 10000.0 T= 50000h I(T)= 10000.0 T= 100000h I(T)= 10000.0

Policy C -- Rate limit only (rho_max=1) T= 1000h I(T)= 2000.0 T= 10000h I(T)= 20000.0 T= 50000h I(T)= 100000.0 T= 100000h I(T)= 200000.0

Policy D -- Expiring rights (t_exp=500h) T= 1000h I(T)= 2000.0 S(T)= 1000.0 T= 10000h I(T)= 20000.0 S(T)= 1000.0 T= 50000h I(T)= 100000.0 S(T)= 1000.0 T= 100000h I(T)= 200000.0 S(T)= 1000.0

These four results confirm numerically what §12–13 establish algebraically: (a) unrestricted autonomous issuance grows I(T) exactly linearly and without bound, matching Proposition 1's own lower bound; (b) a preallocated budget makes I(T) plateau exactly at the budget total, as §13.1 claims; (c) a rate limit alone does not bound I(T) as T grows — it is numerically identical to the unbounded policy at

every checkpoint, confirming RateBound ≠ SupplyBound (§13.2) as an empirical fact, not an assumption; and (d) expiring issuance rights produce the sharpest result: I(T) keeps growing without bound while S(T) converges to a finite steady state — here, 2·ρ·t_exp = 2·1·500 = 1000 , matching the simulation exactly — once T exceeds the expiry window

16.1 Cadence as the economic time base

The mandatory cadence has two distinct roles that must not be conflated.

First, it is an observability mechanism. A missing heartbeat can make a
domain's silence observable, with detection latency approximately bounded by
the cadence interval plus transport delay. It does not, by itself, identify
the physical cause of the silence.

Second, in v1.1 the same cadence defines protocol-recognized economic time.
A valid cadence transition advances the domain's economic epoch by one. The
reward function consumes that epoch counter rather than a wall-clock
timestamp. Thus:

  physical time T  ≠  economic epoch q

and no claim is made that q is a globally synchronized physical clock.

For economic purposes, a valid transition must satisfy:

  q_new = q_old + 1

or an explicitly specified equivalent bounded-advancement rule. An
implementation MUST reject arbitrary epoch jumps, duplicate cadence
transitions, and replayed cadence events. The cadence transition itself
therefore becomes part of the committed history and subject to the same
identity, validity, and evidence rules as other protocol events.

This preserves partition autonomy. An isolated domain can continue to
advance its own cadence without remote state, while reconciliation later
merges the committed event history deterministically. What it cannot do is
retroactively claim an arbitrary amount of economic time merely by changing
its wall clock.

The observability trade-off remains unchanged:

  bandwidth cost ∝ 1/Δ
  detection latency L ≈ Δ + transport delay.

The economic interpretation adds a second deployment constraint: Δ also
determines the granularity of protocol-recognized economic time. Smaller Δ
provides finer economic resolution at higher communication/processing cost;
larger Δ reduces overhead but coarsens accrual resolution. The deployment
must therefore document Δ as both an observability and an economic-policy
parameter.

16.2 Cadence integrity: bounding the rate of advancement (closes R11).
§16.1's own separation of roles states plainly what the mandatory heartbeat
does and does not provide: observability of silence, nothing about the RATE
at which an active, apparently-honest domain advances through valid,
correctly-chained epochs. Confirmed directly, not merely reasoned about: a
domain could construct a thousand structurally-valid cadence transitions —
each satisfying epoch+1 and correct causal chaining perfectly — within
milliseconds of real time, since nothing before this checked anything about
elapsed real time between them. R11 named this gap explicitly rather than
leaving it implicit, and it stood open through several revisions until one
direct question, followed by one direct pushback on an initially-incomplete
answer, led to it being closed in this revision.

The mechanism: a sequential hash chain. h_0 = SHA-256(seed), h_i =
SHA-256(h_{i-1}), computed for a deployment-configured iteration count. Each
step depends on the output of the one before it — there is no way to compute
step 1000 without having genuinely computed steps 1 through 999 first, in
order, regardless of how much parallel hardware is available. Producing the
chain therefore costs real, physically-irreducible sequential time on
whatever hardware actually computes it. The seed itself binds a chain to
exactly one domain and exactly one position in that domain's own cadence
history — vdf_seed(domain, previous_epoch_output), with a fixed marker for
epoch 1 — so epoch N's chain cannot even begin, let alone be precomputed,
until epoch N-1's real output exists. Verification means recomputing the
identical chain and comparing the final output: the same recompute-rather-
than-trust discipline this paper applies to event ids (§8.1), module hashes
(§27.4), and formula parity (Appendix H.5), applied here for the first time
to elapsed real time. Every cadence transition in cadence.js/cadence.rs now
requires a valid proof of this form; a transition without one, or with a
proof that does not verify, is rejected exactly like any other structurally
invalid transition (Appendix H.1).

Three limitations are stated honestly here, not discovered later and
patched in as an afterthought:

First, this is not an asymmetric verifiable delay function in the strict
cryptographic sense — a real construction (Wesolowski's or Pietrzak's,
built on groups of unknown order) provides verification that is
asymptotically cheaper than production. This mechanism does not: verifying
a chain costs exactly what producing it cost, since verification IS
recomputation. Building a true asymmetric VDF is a substantial, separate
cryptographic undertaking — real academic constructions, real
implementations with their own independent audit history — that this
project does not attempt. What this mechanism does provide, which is the
property actually load-bearing here, is that production cannot be
parallelized or shortcut: an attacker cannot fabricate epochs faster than
real sequential hashing allows on the hardware actually available, with
unlimited parallel hardware providing no advantage at all.

Second, difficulty (the iteration count) is calibrated against whatever
hardware computes the chain, not a market-revealed price — the same honest
caveat this paper already stated for local proof-of-work before that
specific, unrelated mechanism was retracted (§24.6(ii)'s retraction note:
a burn is never truly network-blocked, only slow to confirm, so "wait for
reconnection" was an available alternative there). That retraction's
reasoning does not transfer to cadence: cadence must keep advancing DURING
a partition itself, so waiting for reconnection is not an available
alternative for this mechanism the way it was for identity cost. A domain
with meaningfully faster single-core hardware than the deployment's
assumed baseline can still advance somewhat faster than intended — bounded,
not eliminated, and the difficulty parameter is deployment-configured
(never a hardcoded constant) for exactly this reason, mirroring Δ's own
documented status above.

Third, and most important not to overstate: this addresses ONE domain's
own single timeline being fast-forwarded. It does not, by itself, address
many domains (many identities) each independently advancing their own
cadence in parallel across separate real hardware — that is a Sybil-shaped
concern (§24), orthogonal to what this mechanism closes. R11 is closed for
what it specifically named; it was never a claim about Sybil resistance,
and this section does not retroactively become one.

Executable detail — real, measured production cost scaling with iteration
count; deterministic, reproducible output; rejection of a fabricated
output, a real chain computed for fewer iterations than claimed, and a
chain computed under the wrong seed; confirmation that a later epoch's
proof genuinely depends on the earlier epoch's real output rather than
merely its existence; and byte-for-byte cross-language parity between the
JavaScript and Rust implementations on the identical (seed, iterations)
pair — is in Appendix H.30. A genuine, previously-dormant bug in
cadence.rs, unrelated to the VDF mechanism itself but only surfaced by
testing it, is also recorded there rather than passed over.


.
H.5 — Cross-Implementation Id Parity

This check corresponds to §8.1 and §29.9. Unlike H.1–H.4, this is not a
Python simulation of the protocol; it directly runs the two client-side
reference implementations of the ledger (JavaScript, Rust) against a
shared fixture and diffs their output, because the property being tested
— that id(e) = H(d, c, payload) means the same thing in both languages —
cannot be checked by simulating either language in the other.

Fixture (6 cases: flat payloads, nested payloads with differing key
order, an array-valued field, and an unsorted parent list):
test-vectors/id-parity.json

JavaScript side: scripts/check-id-parity.mjs, calling the same
computeId() defined in public/js/core/event-dag.js and used by the
running application — not a reimplementation for test purposes.

Rust side: rust-core/examples/check_id_parity.rs, calling the same
Event::compute_id() defined in rust-core/src/event.rs and used by the
wasm-bindgen-wrapped EventDag shipped to the client — likewise not a
test-only reimplementation.

Orchestration and pass/fail: scripts/verify-parity.sh runs both and
performs a line-by-line diff of their output.

Actual output at time of writing:

Computing ids (JavaScript)...
Computing ids (Rust)...
OK: JS and Rust produce identical ids for all 6 test vectors.

Before the fix described in §8.1 (JavaScript hashing payloads without
recursively sorting object keys), the two "nested, key order A/B" cases
produced different ids from each other on the JavaScript side alone
(85bf87c0... vs. 9ea641a6... for the flat-payload variant used during
debugging), which by construction cannot match the single id Rust
produces for the same logical value. This is recorded as the actual
counterexample found, not a hypothetical one.

This check runs in CI on every push (id-parity job,
.github/workflows/ci.yml) alongside the native Rust unit tests
(rust-core/src/core.rs) and a full WASM build (wasm-build job). It
establishes id agreement for the specific 6 vectors in the fixture; it
does not establish agreement for every possible payload shape, and the
fixture should grow as new event types are added to the module registry
(§27.2).

H.6 — Cross-Language Confirmation of the Reward Function and Scarcity Policies

This is a companion to H.4 and D.1/D.2, not a replacement. H.4 reports one
executed Python simulation. This entry reports the same numbers,
recomputed independently by two additional, separately-written
implementations of the reward function (§10) and the preallocated-budget
scarcity policy (§13.1) — one in JavaScript, one in Rust — neither of
which was derived from, or shares code with, the Python simulation or
each other. Agreement across three independent implementations in three
languages is stronger evidence than one implementation being internally
consistent with its own appendix.

Reward function, r(b,q) = K·b^α·q^β: public/js/core/economics/reward.js
and rust-core/src/economics/reward.rs. Both reduce Appendix D.2's
sub-expression (K=1, B=1000, t=1, α=0.5) to 1000^0.5 ≈ 31.6227766,
checked directly in each language's test suite rather than by inspection.

Scarcity policy, §13.1: public/js/core/economics/scarcity.js and
rust-core/src/economics/scarcity.rs, both implementing
simulate_hourly_issuance() as a direct generalization of H.4's Python
loop (arbitrary domain count, not hardcoded to two). Both reproduce, to
the exact unit, Appendix D.1's reported values: unbounded policy,
ρ=1/hour per domain, I(1000h)=2000 and I(10000h)=20000; preallocated
budget policy, B=5000 per domain, I saturates at 10000 by hour 10000 and
remains there through hour 100000 — the steady state §13.1 describes in
prose, now reproduced as a number, twice, independently.

H.6.1 — Lemma 1, a minimal deterministic companion to §22. §22.1–22.3
report a randomized experiment with an explicit methodological caution
about randomized harnesses failing to generate their own triggering
condition (§22.2). tests/lemma1.test.mjs is a smaller, deliberately
non-randomized companion: it hand-constructs the two colliding events
directly — id_weak(e) = H(domain, payload-without-q) applied to two
events with equal (domain, b) and different q — rather than sampling for
a collision. This sidesteps §22.2's failure mode by construction rather
than by seed selection, at the cost of testing exactly one collision
pair rather than a distribution of them. It also verifies the mirror
case explicitly: the same weak identifier is safe (rewards agree) once β
= 0, i.e. once the reward function is genuinely time-insensitive. This
is a targeted unit-level check of the lemma's boundary condition, not a
substitute for §22's broader randomized confirmation.

H.7 — Canonical Materialization Order Under Concurrent Branches

This corresponds to §9.1 and §29.10. Fixture: test-vectors/g-scenario.json
— ten events: a genesis, two independent domain branches (d1, d2), a
deliberate epoch-skip on d1 (rejected by the cadence reducer, §10), and a
deliberate negative-b accrual on d1 (rejected by the reward function,
§10). Computed independently by
scripts/check-g-parity.mjs (JavaScript) and
rust-core/examples/check_g_parity.rs (Rust), diffed by
scripts/verify-g-parity.sh, and pinned as a regression test in both
languages (tests/g-scenario.test.mjs, rust-core/tests/g_scenario.rs).

Actual output, identical in both languages:

  cadenceDomains: { d1: 3, d2: 1 }
  cadenceRejectionCount: 1
  scarcityDomains: { d1: 40, d2: 20 }
  balances: { d1: 40, d2: 20 }
  accrualRejectionCount: 1

The d1 = 40 figure is the concrete instance §9.1 describes: an accrual
event committing b=10 at q_0=0, whose only direct parent is d1's
epoch-2 cadence event, is folded after d1's (causally unrelated to it)
epoch-3 cadence event — because that later event is pulled earlier in
the canonical id-sorted order by an unrelated descendant. It receives
q=3, not q=2, and contributes reward 10·3=30 rather than 10·2=20; the
domain's second accrual event (b=5, q_0=1, q=2) contributes a further 10,
for the reported total of 40. This was not constructed to demonstrate
the point — it is what the fixture's causal structure produces under the
implementation's actual (id-sorted depth-first) canonical order, found
while building this appendix, not before it.

This establishes that the two reference implementations agree with each
other on a converged event set under concurrent branches, deliberate
rejections, and the case §9.1 describes. It does not establish that
id-sorted depth-first traversal is the *only* valid choice, or the
correct one to standardize — only that a choice must be made and stated,
which is exactly §29.10's open item.

H.8 — Wall-Clock Reward: Confirming the v1.1 Argument by Deliberate Counterexample

This turns a prose claim (§10, the paragraph beginning "The wall clock
MAY still be used...") into an executed one, in the methodology of
§20–22: construct the broken variant deliberately, run it, and show the
harness catches the violation — rather than only ever exercising the
correct path and trusting the argument for why an alternative would fail.

The broken variant: tests/counterexample-wallclock.test.mjs (JavaScript)
and rust-core/tests/counterexample_wallclock.rs (Rust) each implement a
materializeBrokenWallClockG() / materialize_broken_wallclock_g() that
computes q from an externally-injected wall-clock reading instead of
from cadence state, and does not consult cadence events at all —
structurally the v1.0 formulation this paper moved away from. This code
exists only in the test suites; it is deliberately absent from
public/js/core/economics/ and rust-core/src/economics/, so it cannot be
mistaken for usable production code.

Two tests per language:

1. Control. The real, cadence-derived G (g.js / g.rs) materializes the
   same converged event set twice; the two results are identical, as
   expected — this establishes the harness is capable of passing, not
   only of failing, so the counterexample below is informative.
2. Counterexample. The broken wall-clock variant materializes the
   identical converged event set (same H_d, no cadence events at all)
   at two different injected wall-clock readings, 10 and 1000. Actual
   output: balance 100 (= 10·10) at reading 10, balance 10000 (=
   10·1000) at reading 1000 — a 100x difference in economic outcome for
   the same H_d, depending only on when a replica happens to compute it.
   This is precisely the failure mode §9 defines G's determinism
   requirement to rule out, and precisely the vulnerability the v1.1
   revision closed by deriving q from cadence rather than wall-clock
   time.

This does not demonstrate that no other wall-clock-shaped attack exists
against the current design (§29.8's cadence-integrity mechanism remains
open work); it demonstrates specifically that the exact failure mode the
v1.1 argument describes in prose reproduces exactly as described when
constructed, and that the current design is not vulnerable to that
specific, constructed instance of it.

H.9 — Conservation: Consumption-Guard Counterexample and Cross-Language Parity

This corresponds to §7. Two independent reference implementations of
the Deactivate→Prove→Verify→Consume→Activate pipeline —
public/js/core/conservation/conservation.js (JavaScript) and
rust-core/src/conservation/mod.rs (Rust) — including a transmutation
(x_A -> y_B via an authorized derivation function f, e.g. "burn kind X,
mint kind Y at a fixed rate"), not only a same-kind transfer.

H.9.1 — Deliberate counterexample: non-atomic consume(). §7 states in
prose that a non-atomically-guarded proof "is a double-spend waiting for
the right crash window." tests/counterexample-nonatomic-consume.test.mjs
and rust-core/tests/counterexample_nonatomic_consume.rs construct that
window directly, in the same methodology as H.8: a control (the real,
atomic consume() correctly rejects a second attempt on the same proof;
only one destination claim ever exists) and a counterexample (splitting
the real guard's single atomic check-then-insert into two separate
steps — exactly what a persisted-but-non-atomically-checked consumption
record would do — lets two independent branches both pass the check
before either commits, and both successfully activate). Actual result:
two destination claims, each for the full proven amount, both minted
from the same single proof — the mechanical double-spend §7 warns
against, reproduced rather than only asserted. This code is deliberately
absent from the production conservation/ modules in both languages.

H.9.2 — Cross-language parity. test-vectors/conservation-scenario.json
(two claims, a same-kind transfer, and a transmutation) is run through
both languages independently
(scripts/check-conservation-parity.mjs,
rust-core/examples/check_conservation_parity.rs), diffed by
scripts/verify-conservation-parity.sh, and pinned as a regression test
in both (tests/conservation-scenario.test.mjs,
rust-core/tests/conservation_scenario.rs). Actual output, identical in
both languages: a 10-unit kind-X claim transferred intact to its new
owner, and a 5-unit kind-X claim transmuted into a 10-unit kind-Y claim
under the fixture's 2x burn rate; both source claims correctly finalized
to Consumed; two entries in the consumed-proof set. This establishes
agreement on the specific fixture exercised, including one transmutation
case; it does not establish agreement across every possible derivation
function or claim shape, and — as with H.6 and H.7 — the fixture should
grow as new derivation functions are added.

H.10 — External-Chain Burn as c_id: What Is and Isn't Verified

This corresponds to §24.6(v). Split across four files, each verified to
the extent this development environment allows — same discipline as the
WASM build (§29.9's context) and the id-parity work (§8.1): state
plainly what is real code versus what is an unverified boundary, rather
than letting the two blur together.

Fully tested, real code, no network required: identity-cost.js (pure
verification of a normalized burn-transaction record — commitment
level, error status, and destination-balance delta — plus a
replay-guarded registration function ensuring one signature backs
exactly one identity; 10 tests) and its Rust mirror (9 tests).
solana-wallet.js (real Ed25519 keypair generation, password-based
AES-256-GCM encryption via the Web Crypto API, and construction/signing
of a real Solana transaction — a SystemProgram transfer to the
network's documented incinerator address) is tested against the actual
@solana/web3.js library, not a hand-written substitute: a real signature
is produced and independently re-verified by round-tripping the signed
bytes through the library's own transaction deserializer, which fails
if the signature is invalid (6 tests).

Not exercised in this environment, and explicitly documented as such
rather than left implicit: solana-rpc.js (the JSON-RPC call that fetches
a finalized transaction from a live Solana network) and identity-flow.js
(the orchestrator that broadcasts, waits for finality, and registers).
Outbound network access from this development environment does not
reach Solana RPC endpoints. Their correctness depends on matching
Solana's documented RPC response shape, implemented carefully but
unconfirmed against a live response.

The devnet/mainnet split (§24.6(v)'s central point, solana-networks.js)
is itself load-bearing, not a configuration convenience: the identical
code path executes correctly on either network, and only the network
choice determines whether c_id is a real cost or zero. The application's
UI states this explicitly, with a persistent, non-dismissable warning
when devnet is selected, rather than treating "the burn succeeded" as
self-evidently meaningful regardless of which network it succeeded on.

H.11 — Module Registry, Content Integrity, and the Sandbox Mechanism

This corresponds to §27.1, §27.2, and §27.4, and to R19 in Appendix E's
security property registry (previously "unconfirmed").

Fully tested, real code, no browser DOM required: module-hash.js and its
Rust mirror (content-addressing for module code — 4 + 4 tests) and
module-registry.js and its Rust mirror (open registration with exactly
two mechanical gates: a duplicate id, and — for issuing modules only —
an internally-inconsistent economic declaration; identity-scheme
selection per Lemma 1; audit status as a hook for a future audit layer,
reset to "unaudited" on every code update so a stale verdict cannot
silently carry over — 14 + 11 tests). validateEconomicConfig() matches
the paper's own reference pseudocode (Appendix B) for the mandatory
check (α ≤ 1 with zero identity cost is rejected, §24.1); the pseudocode
also specifies an optional check ("MAY perform this symbolic check",
§24.3's ψ growth condition) that this pass deliberately does not
implement — a scoped omission, recorded here rather than silently
skipped, not an oversight.

Not exercised in this environment, and explicitly documented as such:
module-sandbox.js, which requires a real browser DOM (a real iframe, a
real postMessage channel) that does not exist under this project's test
runner. Its design is stated precisely so the omission is checkable: a
sandboxed iframe (sandbox="allow-scripts", explicitly without
allow-same-origin — the absence of that attribute is what makes the
iframe's storage and origin genuinely inaccessible to and from the host,
not merely inconvenient to reach), with a minimal ctx (storage.get/set,
toast, commit, claim) bridged over postMessage. A module whose fetched
code fails verify_module_integrity() against its registered hash is
never mounted, not mounted with a warning.

What this closes, precisely: R19 previously read "unconfirmed" because
the module contract of §27.1 was stated declaratively, with no committed
enforcement mechanism to check it against. A concrete mechanism now
exists and is specified precisely enough to be judged. What it does not
close: this is one implementation of the contract, not a proof that the
contract is unbreakable, and the specific implementation has not been
run against a real browser or a real adversarial escape attempt in this
development environment.

H.11.1 — The submission pipeline. module-submission.js and its Rust
mirror (module_submission.rs) implement §27.4.1, tested against real
Ed25519 signing — @noble/curves in JavaScript, ed25519-dalek in Rust,
neither a stand-in — not merely shape-checked. Test coverage includes: a
correctly-signed submission whose fetched code matches its claimed hash
is accepted; a tampered field (e.g. a swapped codeUrl) invalidates the
signature; a forged submission (signing with one key while claiming
another's public key) is rejected; a replayed nonce is rejected; code
that does not hash to the value claimed is rejected regardless of a
valid signature — this last case is the literal reproduction of the gap
found in the reference pattern this was modeled on, confirmed to be
caught rather than assumed to be. 9 JS tests, 8 Rust tests.

One assumption previously recorded, now closed rather than left open:
unlike id-parity.json for ledger events (§8.1, Appendix H.5), there was
no automated cross-language parity script proving a submission signed
by the JavaScript implementation verifies correctly under the Rust
implementation, or vice versa — the two canonical message-construction
functions were written to match by careful, manual field-order
matching, not mechanically checked. scripts/check-submission-parity-sign-js.mjs,
rust-core/examples/verify_submission_from_js.rs,
rust-core/examples/sign_submission_rust.rs, and
scripts/verify-submission-from-rust.mjs (orchestrated by
scripts/verify-submission-parity.sh) now demonstrate both directions for
real, with real keypairs generated fresh each run, not fixed fixtures: a
JS-signed event verifies under Rust's verify_submission_signature(), and
a Rust-signed event verifies under JS's verifySubmissionSignature(). A
tampered field in either direction (confirmed directly, not assumed)
causes the corresponding verification to fail with a clear cause, not a
false pass — checked by deliberately mutating a signed event's codeUrl
before verification and confirming rejection, so this check is known to
actually discriminate rather than trivially succeed regardless of input.
In the same spirit as §9.1/§29.10's materialization-order finding: a
claim of interoperability needed to be demonstrated, not merely
intended, and now is.

H.12 — Module Registry Propagation, List Ranking, and Submission Eligibility

This corresponds to §27.4.2. The propagation fix: module-registry-reducer.js
and its Rust mirror fold module-register/module-update/module-audit DAG
events into ModuleRegistryState, replacing the previous standalone
object. Four JS + three Rust tests establish the property directly, not
by inspection of the code alone: a module registered on one domain's
local DAG is genuinely absent from another domain's own materialized
registry (queried independently, no shared state of any kind) before
the two DAGs merge; after merging, both domains converge to an
identical registry regardless of merge order, matching the same
determinism property already established for economics (Appendix H.7)
and conservation. A deliberately adversarial case is included: two
conflicting module-register events for the same id (a benign duplicate
or a forged claim) are folded without a crash, and exactly one survives
deterministically — the same canonical-order dependency documented in
§9.1/Appendix H.7 applies here too, not a new property.

List ranking and submission eligibility: module-rank.js and its Rust
mirror implement the two calculations described in §27.4.2, each with
its own test suite (8 JS + 8 Rust). computeModuleRank() is verified to
call reward() (§10) directly rather than reimplementing it — a rank
computed here for given (b, q) is checked against the same value §10's
own formula produces, not merely assumed consistent by construction.
checkSubmissionEligibility() is verified against the specific cases that
matter: a first-ever submission by an author is always eligible; an
improved or unchanged ratio is eligible; a declined ratio is rejected
with the numeric ratios stated in the rejection reason, not a bare
boolean.

Update, this revision: every item this paragraph once listed as open is now closed. checkSubmissionEligibility() is wired into the real submission pipeline (submitModule() / submit_module(), via an injected function — see §27.4.1 and Appendix H.20 for the wiring itself and a real bug found while testing it end to end, not merely by inspection), and the burn-registration flow is a real, reachable UI action (Commit → Burn), not confined to test fixtures. One further, later revision changed how the application's Desktop screen itself orders pinned modules: it no longer auto-sorts by rank. §27.7 explains why and what replaced it — rank is still computed and shown (a tile's tooltip), but a desktop a user has deliberately arranged should not have that arrangement silently overwritten by a background computation on every render. Recorded here rather than silently deleted, so the appendix keeps an honest record of when a gap was closed, not only that it eventually was.

H.13 — Local Proof-of-Work as c_id, and the Reference Demo's Domain Count

[Partial retraction, this revision: the local-pow.js / local_pow.rs implementation this section originally documented has been removed — see §24.6(ii)'s retraction note for why. Retained below, unedited, as a record of what was built and why it was withdrawn, not as current reference-implementation content; the domain-count correction in the second half of this entry stands independently and is unaffected.]

This corresponds to §24.6(ii) and to a correction of the reference
application itself, not the paper. An earlier revision of the reference
demo hardcoded exactly two domains ("Earth", "Mars"), with a single
global connectivity toggle gating a single global Reconcile action. This
was never a claim the paper made — §9's C(t) is already defined between
any two domains, with no fixed count or hierarchy implied anywhere in
the model — but the demo's fixed two-domain UI risked being read as one.
Corrected: domains are created on demand (no fixed count), and there is
no global connectivity state at all; Reconcile always targets one
specific, caller-chosen other domain, matching §9's actual pairwise
C(t) rather than a fictional whole-system link. Verified directly: a
third domain, created but never merged with either of two domains that
have reconciled with each other, remains fully isolated, aware only of
itself — not a partial or degraded view of the others, a complete
absence, exactly as §9 requires.

local-pow.js / local_pow.rs (8 JS + 8 Rust tests) verify: a genuinely
mined proof is accepted; a proof whose hash doesn't actually match
SHA-256(domain:nonce) is rejected regardless of its claimed difficulty;
a proof claiming more leading-zero bits than it actually clears is
rejected; a domain cannot register twice; a fabricated proof with no
real computation behind it is rejected at registration, not just at a
separate verification step. A domain registered via local PoW with zero
network calls was confirmed end to end (not merely by code inspection)
to reach the same "this domain has paid c_id" state the rest of the
system checks for, identically to a domain registered via SOL burn —
the two mechanisms are interchangeable from every other layer's point of
view, exactly as §24.6's framing of multiple mechanism classes intends.

H.14 — Proof-of-Will Reward Formula: Adoption, Parity, and What Remains Open

This corresponds to §10's revision. reward.js and reward.rs were
rewritten from the prior power-law form r(b,q)=K·b^α·q^β to
r(b,q,q_total,T) = (b·q^α)/[ln(q_total^(β(1−T))+C)]^γ, adopted directly
from the reference deployment's own real mining formula rather than
designed independently for this paper.

Cross-language and cross-implementation parity, verified directly:
using the real reference implementation's own constants (α=1.1,
β=2.2, γ=3, C=33³=35937), b=1, q=q_total=100, T=0, both the JS and
Rust implementations independently compute 0.11844290947765648 — the
same value confirmed a third time by exercising the real EventDag
end-to-end (100 real cadence-advance events, then one accrual event, in
public/js/app/main.js's own reference flow) rather than only by calling
reward() directly. 17 JS + 17 Rust unit tests cover: linear scaling in
b; the minQ floor (q below it yields exactly 0, restoring a "no instant
reward" guarantee the floor-at-1 numerator term alone does not provide
— see below); T's clamping to [0, 0.4] matching the original's own
Math.min(taxRate,40)/100; rejection of negative or non-finite inputs;
and that the function never returns a negative or non-finite result for
valid finite inputs, mirroring the original's own defensive
clamps (`r<0||!isFinite(r)||r>1e12 → 0`).

One behavioral note worth stating precisely, not left implicit: unlike
the prior power-law form, where q=0 yields r=0 automatically whenever
β>0 (a zero power-law term), the new formula's numerator uses
max(1,q) — q is floored at 1 before exponentiation, exactly as the
original formula's own dSlot=Math.max(1,cs-las) does. This means the
"no instant reward" guarantee is now provided entirely by minQ, not by
the formula's shape — a deployment that sets minQ=0 would see some
reward at q=0, not zero. minQ ≥ 1 is therefore load-bearing for that
property, not merely a convenience default, and reference-implementation
defaults reflect this.

What this revision explicitly does NOT close, stated as plainly as the
rest of this appendix states what is closed: §24.1's Sybil-profit
derivation and Appendix C's Lemma 1 divergence experiments were built
against the prior formula's b^α term; the current formula's b^1 term
changes the splitting-profit algebra in a way noted informally at §10
but not yet rigorously re-derived. The deployed module-registration
check (§27.2, validateEconomicConfig) still enforces the old
formula's α≤1 condition, unmodified and unexamined against the new
one. Both are recorded as open work in their respective sections, not
resolved here — a formula this consequential changing is exactly the
kind of event that should trigger re-verification of everything built
on top of it, and this appendix's role is to say precisely what has and
has not been re-verified, not to imply the whole edifice was checked
because the formula itself was.

H.15 — Domain Identity Is Derived, Not Named

The reference application's domain concept was corrected directly by the
user after two rounds of review: a domain is not a name a user picks
("Earth", "Mars", a typed "+ New domain" prompt) — it is derived,
deterministically, from the wallet that backs it. The reference
implementation now computes a domain's id as SHA-256(public key),
truncated, the moment a wallet is created; no domain or ledger exists
before a wallet does, and the id is never user-supplied. Verified
directly: the same wallet re-derives the identical id every time
(determinism), two independently generated wallets derive distinct ids
with no coordination (collision avoidance falls out of public-key
uniqueness, the same property §8.1 already relies on for event ids),
and reconciliation between two such domains converges correctly when
addressed by their real derived hashes rather than by chosen labels.

Contacts (§9's C(t) between domains) are now displayed by this same
derived hash, with an explicitly informational per-contact delay value
— editable, not measured, since no real network-delay instrumentation
exists in this environment — replacing an earlier boolean "linked/cut"
global toggle that implied a single whole-system connectivity state
§9 never assumes. A "create test peer" affordance remains, clearly
labeled as a testing-only device to exercise Reconcile within one
browser tab; it is not presented as a second real domain, since a real
second domain is simply another device running this same application
with its own independently derived identity.

H.16 — Conservation Wired to Economics: Sending Value Between Domains

This corresponds to §7's new bridge note. Closes a gap that had stood
open since this reference implementation's economics phases were first
built: conservation.js's real, tested Deactivate→Prove→Verify→Consume→
Activate pipeline (§6.1/§7) existed and passed its own tests, but was
never folded over H_d the same way cadence, accrual, and module events
already were — there was, concretely, no way for one domain to send
value to another, only to accrue new value from nothing (§10).

Two DAG event types close this, mirrored in JS (conservation-bridge.js)
and Rust (conservation_bridge.rs): 'claim-issue' converts part of a
domain's accrued G-balance into a spendable, uniquely-identified claim —
g.js's own handling of this event debits the balance; conservation.js's
handling of the identical event creates the actual claim record, the
same "two materialized views over one H_d" pattern already used
throughout this project, not a new coordination mechanism. 'transfer'
runs the real, unmodified pipeline via conservation.js's transfer()
convenience function with the identity derivation (a plain transfer,
not a transmutation).

Verified directly, both languages, not only by code inspection: a
domain that accrues 50 units via a real 5-epoch cadence sequence, issues
a claim of 20, and transfers it ends up with a balance of exactly 30,
while the recipient — queried independently, from its own materialized
Conservation state — owns a genuinely active claim of exactly 20. A
double-spend attempt (transferring the same already-consumed claim a
second time, to a different recipient) is rejected during the fold, not
merely by a separate check the caller must remember to run — the second
recipient ends up owning nothing. A transfer claimed from a sender who
never actually owned the claim is likewise rejected. Insufficient
balance at claim-issue time is rejected outright, not silently clamped
to whatever was available.

An identity-issued claim's `kind` field defaults to "AIWA" here — this
reference implementation does not yet exercise the transmutation half of
§7's pipeline (a non-identity derivation function converting one kind to
another); only transfer is wired into the application layer at this
revision, recorded as the accurate current scope rather than implied
complete.

H.17 — The Real WASM Binary, Loading in a Real Browser, Confirmed

This closes the project's longest-standing open item, previously
recorded at §9's WASM discussion and in Status tracking throughout: not
merely "the wiring around a WASM backend is tested against a faithful
fake" (already true since ledger-bridge.js's adapter tests caught two
real shape mismatches before ever reaching a browser), but the actual
compiled `.wasm` binary, loaded by an actual browser, confirmed to work.

Getting there required treating a chain of CI failures the same way
every other counterexample in this paper is treated: read the actual
output, do not guess from first principles, fix precisely what the
evidence shows. Three genuinely distinct failures were found in
sequence, in this reference implementation's CI (`ci.yml`), each masking
the next: (1) three shell scripts silently lost their Unix executable
bit through a delete-then-web-upload cycle on the hosting platform,
failing with a permission error unrelated to their actual content —
closed by invoking them as `bash scripts/x.sh`, permission-bit-independent
by construction, not by re-granting a bit that could be lost the same way
again; (2) the repository's own root `.gitignore` still excluded the
WASM output directory from an earlier phase when it genuinely was a
transient local artifact; (3) after both of those were fixed, a commit
step meant to publish the compiled binary kept reporting nothing to
commit despite the build demonstrably producing real files — traced,
only by inspecting the literal `ls -la` output rather than assuming the
build must be fine, to `wasm-pack` itself writing a one-byte `.gitignore`
(content: `*`) *inside its own output directory* on every build, silently
re-excluding everything regardless of what the repository's own
`.gitignore` said. Closed by deleting that generated file immediately
before staging.

Verified directly, not merely inferred from CI going green: the
committed `aiwa_core_bg.wasm` begins with the real WASM magic bytes
(`00 61 73 6d`), is 120,656 bytes, and — checked in an actual deployed
browser session — loads with zero console errors (only an unrelated
`favicon.ico` 404 remained, not part of this system at all). What this
does not establish, stated as precisely as what it does: a live,
in-browser, side-by-side comparison of WASM-backed and JS-backed
computed results has not been run. The shape-parity tests
(ledger-bridge.test.mjs, wasm-ledger-adapter.test.mjs) give strong
reason to expect agreement — they are what the fake module was built to
match exactly — but "the module loads without error" and "the module
computes identical results to the JS backend under real browser
conditions" are different claims, and only the first has direct evidence
here.

H.18 — Transfer Forgery Found and Closed: Ownership Requires Proof, Not a Claim

This corresponds to §7's new security note. conservation.js's own
ownership check — claim.owner == from — was never wrong as a state
machine invariant; what was missing sat one layer up, in
conservation-bridge.js, which is the code that actually decides what
`from` gets to mean when a transfer arrives as a DAG event. Before this
revision, `from` was whatever string the event's author wrote, checked
against nothing. Found by direct question, not by an audit checklist:
asked what a "soul" (an identity's registered burn) corresponds to and
where it lives, which led to checking the transfer path's authorization
directly rather than assuming the existing tests covered it — they did
not, because no test had ever tried to forge a transfer with a
mismatched signer.

Closed in both languages with real cryptography, not a stub:
conservation-bridge.js (via @noble/curves) and conservation_bridge.rs
(via ed25519-dalek) now require a transfer event to carry a real Ed25519
signature over the canonical fields (claimId, from, to, nonce,
timestamp), verify it against the declared signerPubkey, and separately
confirm that hashing that exact public key reproduces the claimed
`from` domain id (domain-id.js / domain_id.rs — see that file's own
note on why the id must be the full 256-bit hash, not a truncated
display-friendly one, once it started being checked inside a signature
path: a 48-bit truncation is within reach of a resourced brute-force
search for a colliding preimage, 256 bits is not). A nonce-based replay
guard prevents reapplying an already-consumed signed transfer.

The security test in each language is the load-bearing one, not a
formality: an attacker with a real, freshly-generated Ed25519 keypair —
not a malformed or missing signature, a completely valid one — signs a
transfer claiming `from` is the victim's domain id. Both implementations
confirm the claim is rejected, the victim's claim remains untouched and
active, and the attacker's declared destination receives nothing. This
is the literal reproduction of the vulnerability found, run against the
fixed code, not an abstract property asserted about it. 7 JS tests (1
of which is this security test), 6 Rust tests (1 of which mirrors it).

What this does not extend to: 'claim-issue' remains unsigned, by
design, not by oversight — it can only ever assign a new claim's
ownership to the same domain whose balance it debits, so forging one
cannot move value to anyone else; at worst it disturbs the victim's own
accounting. Only 'transfer', the event that actually moves value to a
different domain, required this fix.

H.19 — Identity Cost Is Now a Materialized View, Not a Local Variable

This corresponds to §26's new paragraph on identity-register events.
Closes exactly the gap named directly by the user: this "looks critical
for interplanetary deployments." It was.
IdentityCostState previously lived in a standalone `let` in the
reference application, populated only by the domain's own local
burns — never folded from H_d the way cadence, accrual, module
registrations, and now conservation transfers all are. Two domains that
reconciled after any partition, arbitrarily long or short, would never
actually learn that the other had a legitimately registered identity;
every rank computation (§27.4.2) and identity gate for a remote domain
would silently see "not registered" regardless of the truth.

identity-cost-reducer.js and identity_cost_reducer.rs close this by
making a verified burn an 'identity-register' DAG event, folded with
the exact same replay guard already tested in identity-cost.js's
registerIdentityCost() (one signature backs exactly one domain) — no
new verification logic was written, the existing tested function was
simply given an event to be called from instead of a direct call site.
Verified directly, both languages: a domain registered on one replica's
own DAG is confirmed absent from another domain's independently
materialized identity view before reconciliation; after merging, both
domains converge to an identical view, regardless of merge order; the
same burn signature is confirmed unable to register two different
domains even when both registration attempts reach the same merged DAG.
4 JS tests, 4 Rust tests.

The honest limit stated in §26 is worth restating precisely here, not
softened: this fold never queries Solana to confirm a claimed burn
amount is real. It only confirms the claim's internal consistency (well-
formed, not a signature replay, not a duplicate domain registration).
The domain that broadcasts the burn observed the truth directly, via a
real RPC call, before ever creating this event (§24.6(v)'s
broadcastAndVerifyBurn, itself renamed and simplified in this revision
to no longer touch any local identity state at all — its only job now
is producing a verified (signature, burnedLamports) pair for the caller
to fold as an event). A domain that later learns of the registration
through merge() is trusting the folded claim, not independently
re-confirming it, unless it separately queries Solana's RPC using the
embedded signature — a capability solana-rpc.js already provides as a
building block, not yet wired into the fold itself. Recorded as a
precise, bounded trust model, not left as an implied stronger guarantee
than what was actually built.

Also found and fixed in the course of this work, worth recording rather
than silently absorbing into the diff: main.js had its own local copy
of the domain-id derivation, independent of the one just extracted into
domain-id.js for the signature-verification path above, and that local
copy still truncated to 12 hex characters after domain-id.js's own copy
was extended to the full 256 bits. Had this shipped, no legitimately
signed transfer would ever have verified — the id the application
signed over would never have matched what the verification path
recomputed. Caught before delivery by a routine cross-check (which
imports were actually used, not merely assumed), not by a dedicated
test written for this specific mistake — recorded as a reminder that
extracting a shared function does not by itself prevent a stale
duplicate from continuing to exist elsewhere; the duplicate has to be
found and removed too.

H.20 — checkSubmissionEligibility Wired In, and a Real Bug Found Testing It

This corresponds to §27.4.1's update and Appendix H.12's closed gap.
checkSubmissionEligibility() (module-rank.js / module_rank.rs) was
built and tested since an earlier phase but never actually called from
the submission pipeline. Closed by injecting it into submitModule() /
submit_module() as an optional dependency — the caller (main.js)
supplies a closure computing the author's current rank and cadence-
epoch count from identity-cost and cadence state, matching the pattern
already used for registerModuleFn/updateModuleCodeFn: the pipeline
itself stays free of any dependency on identity or cadence modules.
Gates only a genuinely new module id, never an update to one the author
already owns, per module-rank.js's own documented reasoning. Omitting
the closure entirely reproduces the prior, fully open behavior exactly
— nothing about existing deployments changes unless they opt in.

Verified directly, not only asserted: a first-ever submission from an
author is always accepted, and its rank is recorded; a second,
different new module id from the same author, submitted while that
author's rank has since collapsed, is rejected with the specific
declining-ratio reason; an update to an id the author already owns
succeeds regardless of rank, confirming the update-exemption holds in
the actual wired pipeline, not only in module-rank.js's own isolated
tests. 5 new JS tests, 5 new Rust tests.

A real bug was found in the course of this, by testing the actual
end-to-end flow rather than trusting the unit tests already in place:
JS's recordNonce(), called after every accepted submission, returned a
brand-new object containing only usedNonces — silently discarding
lastSubmissionByAuthor's tracked entries for every author except the
one just submitted. Every existing test before this fix only ever
exercised a single author per test (either one submission, or several
sequential ones from the same signer), so each call's freshly-recreated
single entry happened to satisfy that test's own assertions — the loss
of OTHER authors' entries was invisible until a test was written that
tracks two different authors across sequential calls and checks both
survive. Fixed to preserve the rest of the state object; a dedicated
regression test (not a modification of an existing one) now exercises
exactly this two-author case. Rust's equivalent function never had this
failure mode, not because it was separately verified against it, but
because its &mut-based state mutation makes silently dropping
unrelated fields structurally impossible — an example of a class of
bug one language's own discipline rules out by construction and the
other's does not, worth recording as a real, language-specific
difference rather than treating both implementations as equally exposed
to every category of mistake by default.

H.21 — The Formula Made Immutable, and a Real Near-Miss Bug Found Verifying It

This corresponds to §10.1. formula-registry-reducer.js /
formula_registry_reducer.rs fold 'formula-register' DAG events into a
FormulaRegistryState: 'genesis' always present with no event required
(the real Proof-of-Will constants, α=1.1, β=2.2, γ=3, C=33³, minQ=1),
any other id a genuine mint, permanent from the moment it is registered.

Verified directly: a mint registers correctly with its declared
parameters; the exact same id cannot be re-minted, even with wildly
different parameters submitted by a different, adversarial author —
and, since the DAG gives two events sharing the same parent no real
time-order, the property actually tested is not "the honest mint always
wins" (unprovable — a real network cannot guarantee who writes first)
but that exactly one wins and every replica that folds the same history
agrees on which one, checked by folding twice independently and
confirming identical results; the reserved 'genesis' id itself cannot
be overwritten by anyone; two domains that mint different formulas
independently converge to a registry containing both after
reconciliation, regardless of merge order. 8 JS tests, 6 Rust tests.

A real, functional near-miss was found only by testing the full switch
end to end — mint, then actually verify a domain's computed balance
changes — rather than trusting that wiring a new UI control was
sufficient on its own. The JS reducer's minted-formula entries are
flat: `{alpha, beta, gamma, C, minQ, mintedBy, mintedAt}`. The Rust
mirror, for its own good reasons (distinguishing a formula's fixed
parameters from its mint metadata at the type level), nests the
former under a `params` field: `MintedFormula { params: FormulaParams,
minted_by, minted_at }`. main.js's first implementation of
currentRewardParams() read `registry.formulas[id]?.params`, unknowingly
written against the Rust shape while operating on the JS one — `.params`
is always undefined on a flat JS object, so the `?? GENESIS_FORMULA_PARAMS`
fallback fired on every single access to any minted formula, silently.
The bug had no error, no crash, and no visibly wrong output on its own:
the Parameters screen's read-only display (a separate code path, fixed
correctly) would show the right numbers for whichever formula was
selected, while the actual reward computation underneath kept using
genesis regardless of what a domain believed it had switched to — a UI
correctly describing a reality the computation had already silently
diverged from, exactly the class of bug hardest to notice by inspecting
either side alone.

Caught by writing an end-to-end check that mints a formula, switches to
it, and asserts the computed balance under a hand-verifiable parameter
set (α=1, β=0, γ=1, C=e−1, minQ=1, giving r=b·max(1,q) by construction —
the same trick used throughout this project's own test suite) — the
switch produced the unswitched genesis value, immediately visible as
wrong, rather than a subtly-off number that could be mistaken for
rounding. Fixed to read the flat shape directly; a dedicated permanent
regression test now asserts the JS entry has no `.params` field at all,
so a future refactor reintroducing this confusion fails loudly rather
than silently. Recorded here in full, including the exact reasoning
that produced the bug, in the same spirit as every other near-miss in
this appendix: the value of the record is in showing how it was found,
not only that it eventually was.

H.22 — Sybil-Profit Re-Derived for the Current Reference Formula, and a New Complication Found

This corresponds to §24.1's updated note and §10.1. Closes the specific
gap a direct critique named precisely: the paper's economic-security
core was "in transition, not finished" — with reward scaling linearly
in b, splitting a fixed capital is effectively neutral before identity
cost, and the old analysis needed to be redone from scratch. That
description was accurate; this appendix is that redo.

Setup, matching §24.1's own idealization exactly (fixed elapsed age t
across all N split identities), extended only by the current formula's
own extra domain-age term A, held fixed across the split identities the
same way t is: an attacker holds capital B, splits it evenly across N
identities (b = B/N each), each accruing at the same q and against the
same domain age A (in AIWA, each identity is a domain; "the same A"
means each split identity is created and evaluated at the same point in
its own domain's history — the natural extension of "fixed t" to a
formula that now has two time-like quantities, q and A, instead of one).

Result 1 (proved): capital-splitting is exactly reward-neutral before
identity cost, for any parameters. Each split identity earns
r_i = (B/N)·q^α / D, where D = [ln(A^(β(1−T)) + C)]^γ does not depend on
N under the stated idealization. Summed over N identities:

  R_N = N · r_i = N · (B/N) · q^α / D = B · q^α / D

— independent of N by exact cancellation, not approximation. With
identity cost: Profit(N) = B·q^α/D − N·c_id, linear in N with slope
−c_id < 0 for any c_id > 0. Profit is therefore strictly decreasing in
N for every parameter choice, and N*=1 is optimal unconditionally — no
constraint on α, β, γ, A, or T is needed, unlike the power-law form's
own conditional 0<α<1 case. Verified numerically, not only
symbolically: with the real reference constants (α=1.1, β=2.2, γ=3,
C=33³), B=1000, q=A=50, T=0, splitting into N=4 identities produces a
summed reward of 61.53595424577363 — identical to the N=1 case to
floating-point precision — while profit strictly falls (56.5 at N=1
versus 41.5 at N=4 once identity cost is subtracted), confirming the
derivation holds in the actual implementation, not only on paper.

Result 2 (a new complication, found by checking Result 1's own
robustness, not by a separate line of inquiry): the idealization "same
A across split identities" is not free to assume in general, because
the current formula's reward decays as A grows (§10) — a property the
power-law reference form never had, so its own N* analysis never needed
to consider what happens when split identities are NOT equally aged.
An attacker holding one aging domain (large A, meaning a large
denominator, meaning suppressed reward) can sometimes profit by
abandoning it and re-splitting the same capital across freshly-created,
young domains (small A, small denominator, larger reward) instead —
paying N times the identity cost, but avoiding the age-decay penalty
entirely. Confirmed numerically, not merely asserted: with B=1000,
q=50, T=0, c_id=5, and the real reference constants, one domain aged to
A=5000 nets a profit of 6.24; splitting the same capital across four
freshly-created domains at A=1 each nets 44.06 — decisively better,
despite quadrupling the identity-cost outlay. This is a genuinely
different attack shape than classical simultaneous capital-splitting
(Result 1 closes that one unconditionally) — call it identity churn:
discard and re-mint rather than split-and-hold. It is left open in this
revision, not resolved; no claim is made here about how large or
practically exploitable it is under realistic partition timing and
identity-cost calibration, only that it exists and that a specific,
reproducible numeric case demonstrates it clearly exceeding identity
cost. Both results are backed by a permanent, executable regression
test (tests/sybil-reward-splitting.test.mjs), not only the worked
numbers in this appendix's prose — Result 1 is additionally confirmed
across a spread of parameter choices beyond the single reference-
constant example above, and Result 2's decay property is confirmed to
hold monotonically, not only at the two specific ages cited. §17's
matrix reflects both results at this precision: capital-splitting
resistance under the current formula is now proved, not conjectured;
the age-decay/identity-churn interaction is a newly-named open item,
not a previously-known one being restated.

Update, this revision: identity churn now has a real, tested,
deployment-configured mitigation, described in §24.6 — the identity-
cost burn required for a NEW registration is a function of real
Solana slots elapsed since a fixed deployment genesis constant, needing
no live "current time" oracle since both numbers are already known once
a registration's real slot is captured (identity-cost.js /
identity_cost.rs, both implementations; the real slot itself was
already present in every burn-verification RPC response and simply
being discarded before this revision — see solana-rpc.js's own header).
Re-derived directly, not assumed to work from the mechanism's design
alone: extending this appendix's own Result 2 scenario (B=1000, q=50,
T=0, oldA=5000, youngA=1, N=4, cId=5) with a linear cost curve whose
base cost at genesis exactly matches the original flat cId=5 — so this
re-derivation does not silently change the baseline it extends —
confirms round 0 (negligible real time elapsed since genesis)
reproduces the original finding almost exactly (stayOld≈6.2 vs
churn≈44.1, matching the original 6.24/44.06 to the precision this
simplified round-based simulation allows), then confirms a genuine
crossover: by round 1 of the simulated horizon (slotsPerRound=2000,
lamportsPerSlot=0.01), cumulative churn profit already falls behind
cumulative stay-old profit, and the gap widens through round 39, the
simulation's final checkpoint (stayOld≈418.5 vs churn≈−60637.5). This
is dampening confirmed under a real, reproducible, directly re-runnable
computation (tests/sybil-reward-splitting.test.mjs), not a claim the
exploit is now impossible in general, or that this specific curve shape
is the deployment-recommended one — a deployment choosing a much
flatter curve, or leaving the mechanism off (the reference
implementation's own default), would see a different, possibly much
later or absent, crossover point. §17's matrix reflects this precisely:
identity-churn is dampened under this mechanism when a deployment
chooses to enable it, not closed unconditionally the way Result 1's
capital-splitting resistance is.

H.23 — The Issuing-Module Pathway Made Reachable, and Its Identity Scheme Displayed

This corresponds to §27.2's new paragraph. What was asked for was
simpler than what was found: surfacing identityScheme in the UI turned
out to require first noticing that the entire pathway producing it was
unreachable. main.js's submission form built every event with
isIssuing hardcoded to false — selectIdentityScheme(), the α≤1
rejection, and identityScheme itself (module-registry.js, already
built and tested since an earlier phase) had no path from the real
application into them at all, only from direct test-suite calls.

Closed by extending the submission form with the three fields
§27.2 actually requires (an issuing checkbox; a time-sensitivity
checkbox; α and a scarcity-policy field), with identityCostMechanism
deliberately NOT a free-text field — it is read from the submitting
domain's own materialized identity state (§26) and set to a real
mechanism name only if that domain genuinely has one, closing off the
obvious shortcut of typing a mechanism name without actually holding
the corresponding identity cost. Each registered module's resulting
identityScheme is now shown in the Domain screen's catalog as a
labeled badge ("🔒 strong id" / "🔓 weak id" / "non-issuing"), with
Lemma 1's own statement attached as the explanation rather than left
for the reader to look up separately.

Verified directly, not only via module-registry.js's own pre-existing
unit tests: an issuing module declaring α≤1 while the submitting
domain has no registered identity is confirmed rejected, reproducing
§24.1's exact stated reason string, not a generic error; the identical
declaration is confirmed accepted once that domain has a real
registered identity; a module declaring its reward time-sensitive is
confirmed to compute identityScheme='strong', and one declaring it
insensitive computes 'weak' — both checked through the actual
submission-event construction and registration call the real
application makes, not by calling registerModule() directly with a
hand-constructed entry as module-registry.test.mjs's own tests do.

H.24 — Transport: The Interface, Delay-Tolerant Backend, and Watchdog, Built and Tested

This corresponds to §25's update. Closes the "Transport, pluggable
layer" item this project's own status tracking had left open since
before this paper's economics and identity layers were built out.
Scoped deliberately: the WebRTC mesh backend needs real signaling
infrastructure and real peer connections to verify at all, neither
available in this development environment — left an honest, explicit
stub rather than a fabricated implementation that has never actually
connected two peers. The delay-tolerant backend and the watchdog, by
contrast, are pure queueing/timing logic that doesn't require a real
network to verify, and both are real, tested code here, not
specification prose alone.

transport.js: assertImplementsTransport() confirms a fully-conforming
object passes, a partial one is rejected with the exact missing method
names (not a generic failure), and null/undefined are handled without
throwing. createUnconnectedTransport() — a transport that has not yet
been wired to a real backend — throws a clear, diagnosable error
identifying exactly which method was called too early, on all five
interface methods, rather than silently doing nothing. 5 tests.

delay-tolerant-transport.js, verified directly: a message sent while
the network is reachable is delivered immediately and leaves nothing
queued (this specific property was the one bug found while testing —
see below); a message sent while unreachable stays durably queued; a
later flush() delivers everything queued once reachability returns, in
FIFO order; a flush() that hits a failure partway through a peer's
queue stops there rather than skipping ahead and reordering — the
specific test constructs a flaky sender that allows exactly one
delivery, confirming the second and third queued messages remain queued
rather than being silently dropped or reordered; two different peers'
queues are confirmed independent, so one peer's outage never blocks
delivery to another; broadcast (peerId=null) has its own queue,
separate from any per-peer queue; a sendFn that throws is treated as a
failure and the message stays queued, not propagated as an unhandled
rejection. 9 tests.

A real bug was found while writing these tests, not by inspection: the
first implementation of send() enqueued a message, attempted immediate
delivery, and returned whether it succeeded — but never removed the
message from the queue on a successful immediate send, so a message
that was, in fact, delivered right away was still reported as present
in the queue afterward. Caught immediately by the very first test
written (send while the network is up should leave nothing queued),
which failed with queueDepth returning 1 where 0 was expected — an
unambiguous, easy-to-diagnose failure, not a subtle one. Fixed by
tracking each queued entry's id and removing it from the correct queue
(per-peer or broadcast) the moment a send succeeds, whether that
happens immediately in send() or later in flush().

connection-watchdog.js, verified with an injected clock rather than a
real elapsed timeout: never fires before any peer was ever known (a
watchdog on a domain that has never connected to anyone is not "stale,"
it has simply never started); does not fire while activity is recent;
fires exactly once when the timeout window elapses with zero activity;
does not fire a second time for the same stale episode on repeated
checks, matching the requirement that onStale drives a one-time
teardown-and-reinit, not a repeated action while nothing has changed;
fresh activity after a stale episode correctly resets the watchdog, and
a second, genuinely independent stale episode after that is confirmed
to fire again, not suppressed by the first; construction rejects a
non-positive or non-finite timeout immediately, rather than failing
confusingly at the first check; activity exactly at the timeout
boundary is confirmed not yet stale, only once elapsed time is
greater than or equal to the timeout, resolving the boundary case
explicitly rather than leaving it to whatever a naive comparison
happened to do. 7 tests.

All three pieces confirmed working together, not only in isolation: a
simulated peer connects, sends a message during a network outage (queued,
not delivered); the watchdog, given no further activity, fires its stale
callback once the timeout elapses; a real contact window then opens and
flush() delivers the queued message — the same sequence a real
partition-and-reconnect episode would produce. 21 new tests total (5 +
9 + 7), 194 JS tests in the project overall as of this revision.

Wired into the reference application immediately after this appendix
was first written, once asked directly whether it had been — it had
not, and the question surfaced that gap the same turn it was asked.
main.js's DomainReplica now carries its own transport and watchdog
instance, and the app's reconciliation action (myDomain.syncWith(peerId))
goes through transport.send() rather than calling dag.merge() directly.
The one deliberately-simulated piece is delivery itself, since a single
browser tab has no real network to send bytes over — when a simulated
link is up, delivery is a real dag.merge() (content-addressed and
idempotent, the same mechanism this project already relies on
throughout, not a new format invented for this); when down,
transport.send() returns false and delay-tolerant-transport.js's own
real queueing takes over, with no separate queueing logic duplicated in
the application layer. Verified directly, using the actual classes and
functions main.js wires together, not a re-implementation for this
check: a simulated link set down causes a sync attempt to queue rather
than silently deliver, confirmed by the recipient still knowing nothing
of the sender at that point; setting the link back up and flushing is
confirmed to deliver exactly the queued sync, after which the recipient's
event count matches the sender's exactly. A UI toggle simulates a
partition per contact pair, a queue-depth stat shows what's actually
waiting, and a flush button attempts real delivery on demand — the
Reconcile action in this application is no longer a magic instant merge,
it is what §25's transport contract actually produces once its delivery
seam is connected to something real.

H.25 — H_d Made Durable: Closing the "Only Survives While a Tab Is Open" Gap

This corresponds to §8.2. Found and closed the same turn it was asked
about directly: does the DAG's data only live as long as at least one
user's computer is turned on, otherwise does everything disappear?
The answer, before this revision, was yes — and specifically,
unlockWalletAndDomain() constructed a brand-new empty ledger on every
call, meaning even the SAME domain reopening its own wallet saw zero
history, not merely a domain that had genuinely never acted.

Two pieces, kept deliberately separate, matching this project's
established discipline of isolating the untestable storage/network
primitive from the real logic built on top of it (solana-rpc.js,
module-loader.js, delay-tolerant-transport.js all follow the same
shape): EventDag itself (event-dag.js) gained a small, additive
subscribe() mechanism — genuinely new events, from either addEvent() or
merge(), notify subscribers; a re-added already-known event does not,
confirmed directly rather than assumed from addEvent()'s own existing
idempotency guarantee. 6 new tests, including the specific case that
merge() only notifies for events actually new to the receiving side,
not ones already known to it even if new to the caller's mental model
of "what merge() processed." event-dag-persistence.js is the IndexedDB-
touching half: real code, untestable via node --test the same way
solana-rpc.js's real fetch() calls are (IndexedDB is a browser API with
no equivalent in this Node-based sandbox) — except for
topologicalSortForReplay(), the one piece of genuinely pure logic in
this file (ordering a flat list of stored events so replay never hits
an unknown-parent rejection), which is fully tested, including the
property that actually matters: its output is confirmed replayable
through a real EventDag, not merely "sorted" by some abstract
definition divorced from what replay requires. 5 tests.

The IndexedDB-touching functions themselves were verified anyway, not
left as an unverified claim resting on the tested pieces alone — a
minimal, faithful in-memory fake of the indexedDB global (matching only
the specific operations this file's real code actually calls: open,
onupgradeneeded, transaction, objectStore, put, getAll) was built
specifically to drive the real, unmodified event-dag-persistence.js
code through its real paths across two independently constructed
sessions. A domain that accrues a real balance across five real cadence
advances in the first session is confirmed, in a wholly separate second
session against the same simulated storage, to recover exactly 7
events (not 0), the identical materialized balance, and the identical
cadence epoch. A second check went further than restoring history
alone: recovering the domain's own tip correctly enough to extend it.
main.js's restoreTipsFromDag() (a new method, not previously present)
recovers lastEventId from the DAG's own deterministic topological
order and lastCadenceId/epoch from cadence's own already-tracked
per-domain state (§10) rather than resetting to genesis — confirmed
directly: a domain restored from a prior session's history correctly
chains a new cadence event from its true recovered tip, reaching epoch
4 from a restored epoch 3, never hitting the "Unknown parent" rejection
that a naive reset-to-genesis implementation would have produced the
moment any post-restoration action tried to extend the recovered
history.

Scoped deliberately: only the application's own single real domain
(myDomain) is persisted. Test peers, used solely to demonstrate
Reconcile within one browser tab (§25's own note on this), remain
intentionally ephemeral — persisting throwaway demo constructs would
add storage overhead for a concept this paper is explicit elsewhere
about not treating as a real domain. 11 new tests total (6 + 5), 205 JS
tests in the project overall as of this revision.

H.26 — Presentation Independence, Actually Built and Checked, Not Only Claimed

This corresponds to §27.5's update. Closed the last remaining item on
this project's own open-work tracking (alongside AI, §28, deliberately
deferred by explicit choice rather than left as an oversight) — found
by checking whether the claim §27.5 already made in prose was backed
by anything in code, and it was not: zero theming or presentation
abstraction existed anywhere in the reference implementation before
this revision.

theme-tokens.js is plain data, not a framework: two presets
(DEFAULT_THEME, COMPACT_THEME) declaring the identical set of token
keys (colors, font, spacing) — confirmed directly, not assumed, so a
module written against one preset cannot silently break on a missing
key under the other. COMPACT_THEME is not an arbitrary second example;
its values are chosen against this section's own stated case (a
bandwidth- or hardware-constrained settlement): larger monospace text,
maximum contrast, and secondary/muted text intentionally collapsed to
the same value as primary text, removing a visual distinction a
constrained display or a distance-viewing context doesn't benefit from.
themeToCssVariables() converts either preset into a real `:root { }`
CSS custom-property block — confirmed to actually contain every
expected token, in kebab-case form, and confirmed to produce genuinely
different output between presets, not accidentally identical CSS
regardless of which theme was passed. getTheme() degrades to the
default for an unknown or missing id rather than throwing — a
presentation choice failing should not break module rendering
entirely. 8 tests.

module-sandbox.js's buildSandboxHtml() — already real code before this
revision, per Appendix H.11, just never carrying any presentation
concept — now injects the active theme both ways this section's own
text promises: as the CSS block above, inside a real `<style>` tag in
the generated document, and as ctx.theme, the identical token values
serialized as real, parseable JSON data available to a module's own
JavaScript. Verified directly, not only that theme injection happens
at all: the module's own code string is confirmed byte-identical across
both presets — only the surrounding injected presentation differs, the
literal claim §27.5 makes ("a presentation layer cannot alter module
behavior — only how a module's output is displayed"), checked as a
string-equality assertion rather than left as an architectural
intention. This required exporting buildSandboxHtml() itself (it was
previously module-private), the one part of module-sandbox.js's
document-generation that is pure string construction and therefore
testable without a real DOM — mounting itself (mountModule(), the
actual iframe creation and postMessage wiring) remains untested here for
the same reason the rest of this file already was, per its own header.
4 new tests.

Wired into the reference application: a presentation selector in
Parameters, switching a local activeThemeId variable that is passed to
runModule()'s mountModule() call — confirmed, by reading the actual
event listener, to have exactly one side effect (reassigning that
variable and writing a log line), touching theta, myDomain, the module
registry, or any other economic or DAG state in no way at all, matching
this section's "presentation is not protocol state" framing precisely
rather than only in prose. 12 new tests total (8 + 4), 217 JS tests in
the project overall as of this revision — the last item on this
project's own tracked open-work list before AI (§28, explicitly
deferred).

H.27 — The Idea Agent and Hyperprofile, Built and Verified

This corresponds to §28's narrowed scope and §27.6's new capabilities,
built together in one revision after a prior exploration of two much
larger YourMine-inspired subsystems (AI code generation with a mined-
pattern spec, and a theme-as-full-website presentation layer) was
deliberately set aside — confirmed directly: only an idea generator was
wanted from the AI layer, and themes were dropped in favor of the
presentation-token layer already built (§27.5, Appendix H.26), leaving
"hyperprofile" as the one genuinely new architectural addition this
appendix covers alongside the narrowed AI scope.

idea-agent.js, fully tested, no WebGPU dependency: collectContextSnapshot()
confirmed to separate a domain's own registered modules from its
contacts' correctly, to omit a contact from the snapshot entirely
(rather than an empty-array placeholder) when that contact has
registered nothing, and to count module categories across the whole
known registry rather than only the caller's own or only contacts'.
buildIdeaSystemPrompt() confirmed to reflect a real snapshot's exact
values, to state its "do not invent trends" constraint explicitly
(mirroring the real reference prompt's own discipline), and to degrade
honestly — "none yet," "0 known contact domains" — rather than fabricate
placeholder network data when a domain has none yet. sanitizeIdeaReply()
confirmed to truncate at the first leaked instruction marker, to leave
a genuinely clean reply untouched, and to never return an empty string
even if the entire reply happened to match a marker. 10 tests.
webllm-engine.js — real WebGPU detection, real Worker creation, real
streaming chat completion via @mlc-ai/web-llm — is untestable here for
the same reason solana-rpc.js's real network calls are; no test file
claims otherwise.

public-profile-reducer.js, fully tested: a published value is
materialized and readable; a domain that has published nothing returns
an empty object, not an error; a later publish to the same key
overwrites the earlier one (latest-write-wins, not immutable, a
deliberate contrast with module code hashes and minted formulas);
publishing value=null retracts a key, confirmed to actually remove it
rather than leave a null placeholder; different modules on the same
domain, and the same moduleId/key on different domains, are confirmed
never to collide; two domains publishing independently converge to an
identical view after reconciliation regardless of merge order, the
same convergence property every other materialized view in this paper
already has; a complex (non-primitive) value round-trips correctly;
malformed events are rejected without throwing. 9 tests.

module-sandbox.js's extensions — ctx.share, ctx.sendToPeer,
ctx.onPeerMessage, and the inbound aiwa-peer-message channel that lets
the host push a message INTO an already-mounted module rather than
only receive outbound calls from it — are confirmed present and wired
in the generated sandbox document via the same string-based testing
this file's presentation-injection code already used (Appendix H.26),
extended with 3 new tests for these specific additions, for 7 total in
that file.

The full mechanism was verified end to end, not only at the level of
its separately-tested pieces, using the real DomainReplica pattern
main.js wires together: a domain that publishes data via a module is
confirmed invisible to a peer before reconciliation and correctly
visible after, through the real transport (§25) and the real
materialized reducer, not a simulated shortcut; a real-time message
sent to a specific module id is confirmed delivered only when that
exact module is the one currently mounted on the receiving domain, and
confirmed silently ignored when a different module — or none — is
open, matching the real-time, non-durable interaction semantics this
section states rather than durable delivery. A genuine design
correction was needed and made during this verification, not found by
inspection alone: the existing simulatedNetworkSend() (§25's earlier
appendix) treated every message as a reconciliation trigger regardless
of payload, which would have silently reinterpreted a real-time module
message as a full DAG merge instead of routing it — closed by
branching on the payload's own declared type before deciding what
"delivery" means, rather than assuming one meaning for every message a
transport carries. 4 new tests in module-sandbox-html.test.mjs, 9 in
public-profile-reducer.test.mjs, 10 in idea-agent.test.mjs — 23 new
tests total, 239 JS tests in the project overall as of this revision.

H.28 — Desktop Drag-and-Drop and Folders, and the Rank-Sort Conflict It Surfaced

This corresponds to §27.7. Built after being asked directly for real
drag-and-drop desktop icons and folders, matching the real mechanism in
a reference implementation's own desk.js — adapted deliberately, not
copied wholesale: that reference system supports a paginated, multi-
screen desktop with edge-scroll-while-dragging between pages; AIWA's
desktop is a single page, so pagination has no equivalent here and was
not built. Ejecting an icon from a folder is a tap on an explicit
"↩" control inside the folder's own panel, not a drag back out past
the panel's edge — a deliberate simplification, more reliable across
both touch and the new desktop grid layout (Appendix H.26's earlier
CSS work) than detecting a drag gesture escaping a floating panel's
bounds would be.

desktop-layout.js, fully tested, no DOM dependency at all: reordering
top-level items; dropping one bare icon onto another creates a real
folder containing both, confirmed to place the target first and the
dragged icon second, confirmed to leave every other item untouched;
dropping onto an existing folder appends into it, confirmed to be a
no-op rather than a duplicate entry when the dropped id is already
inside; ejecting a module removes it from the folder and reintroduces
it as a bare top-level icon, confirmed to remove the folder entirely
once emptied rather than leaving an empty husk, and confirmed NOT to
auto-dissolve a folder left with exactly one remaining item — a
deliberate, explicitly tested scope choice, not an oversight; renaming
trims whitespace and rejects an empty name as a no-op; removing a
module from anywhere in the layout (top-level or nested) is confirmed
to leave sibling folder members untouched. A full realistic sequence —
reorder, fold, merge into the resulting folder, then eject one member
back out — is confirmed to compose correctly end to end, not only as
isolated single-step operations. 21 tests.

A real, non-hypothetical conflict was found in the course of this,
not invented for the appendix: the Desktop screen's existing render
logic re-sorted pinned modules by computed rank on every single call,
which — once a real user-controlled arrangement mechanism existed to
collide with it — would have silently discarded a user's own drag-and-
drop arrangement the next time anything else triggered a re-render
(§27.4.1's own eligibility check, a cadence advance, a contact
reconciling, all already call the same renderAll() that includes the
Desktop). Closed by removing rank as the desktop's sort criterion
entirely; rank is still computed and shown, in a tile's tooltip. An
earlier appendix entry's own note, which had stated the now-superseded
rank-sort behavior directly, is corrected accordingly rather than left
to silently disagree with the current code.

Storage migration was verified directly, not assumed correct by
inspection of the conditional alone: an old-format flat array of
pinned ids is confirmed to convert correctly to the new folder-capable
structure; an already-migrated layout is confirmed to be read back
unchanged, not reprocessed or corrupted by encountering the new format
a second time; a first-ever launch with no stored data at all is
confirmed to produce an empty layout rather than an error; and
deliberately corrupted stored data is confirmed to degrade to an empty
layout rather than crash the application on load. The real pointer-
event wiring that turns these verified rules into an actual drag
gesture (drag threshold, a ghost element following the cursor,
hit-testing the real DOM grid via elementFromPoint) is real code,
adapted from the reference implementation's own mechanism, untestable
here for the same reason module-sandbox.js's DOM code already is. 21
new tests, 260 JS tests in the project overall as of this revision.

H.29 — The First Real Causal Contract, and the Generalization That Made It Scale

This corresponds to §27.8. Built after being asked directly for a
jackpot funded entirely in AIWA, no real money, no neobank — and, once
a first version existed with five bespoke ctx methods, asked directly
whether every future contract would need its own new ones. It would
have, and that was named as a real architectural problem to solve
properly, not a detail to wave away.

jackpot-reducer.js, fully tested with real Conservation fixtures (real
issueClaim/transfer calls, not mocked): a pot mints once and is
permanent, matching the same discipline as a minted formula (§10.1); a
donation referencing a claim never actually transferred to the pot is
rejected, and — found directly while writing this specific test, not
assumed — the ORIGINAL pre-transfer claim id is confirmed to no longer
refer to anything pot-owned once consumed, since conservation.js's own
transfer() activates a new claim id rather than reusing the old one, a
real detail this reducer's donation-verification logic depends on
getting right; a donation's recorded amount is always read from the
real claim, never trusted from the event payload, which carries no
amount field at all; the same real claim cannot back two donations;
cycle assignment is computed purely from the fold itself, confirmed
directly to fill a cycle to its configured length before the next
opens; the deterministic draw is confirmed to actually weight by real
ticket count across many simulated trials, not merely asserted to.
verifyJackpotPayout — the function that decides whether a signature-
free claim release is legitimate — is the most heavily tested function
in this file for good reason: a legitimate payout to the real,
recomputed winner is accepted; a payout to anyone else is rejected; a
payout before the cycle has genuinely closed is rejected; a payout for
a claim that was never part of the cycle's real donations is rejected,
even when that claim is genuinely pot-owned from something else
entirely; a payout for an already-released claim is rejected, so the
same claim cannot be paid out twice; a payout claiming the wrong pot
address is rejected; a malformed release proof is rejected without
throwing. 25 tests.

A real, previously-undiscovered bug was found and fixed during this
work, not staged for the appendix: conservation.js's claim statuses are
the lowercase strings 'active'/'deactivated'/'consumed', and this
file's first draft checked for 'Active' — capitalized, matching no
real status this platform has ever produced. Every payout would have
been silently rejected, forever, the moment this shipped, since no
claim would ever satisfy that check. Caught immediately by the first
end-to-end test run against real conservation.js fixtures rather than
hand-written mocks, which is the entire reason this appendix's tests
build fixtures via real issueClaim()/transfer() calls instead of
constructing claim objects by hand — a hand-built fixture would have
happily used whichever casing was typed into it, masking exactly this
class of mistake.

conservation-bridge.js's own header now documents 'pot-release' fully;
new tests confirm it is rejected outright with no verifier supplied (a
deployment gains no signature-free path just by this feature existing),
accepted when an injected verifier approves, rejected when it
disapproves, rejected on a replayed nonce (the identical protection
ordinary signed transfers already get), and that a verifier which
itself throws is treated as a rejection, not a crash that could leave
state inconsistent. 6 tests, written against a corrected causal
ordering after an early draft placed claim-issue and pot-release as
concurrent siblings of the same parent rather than the pot-release
causally depending on the issuance — a real ordering mistake caught by
the very first assertion failing for the right reason once traced,
recorded here as the same category of near-miss this project's other
appendices are honest about, not smoothed over.

The separate, real over-issuance vulnerability named in §27.8's own
prose — Conservation creating a claim G had already rejected for
insufficient balance — is verified directly: a domain with zero real
balance is confirmed unable to obtain a real, spendable claim once
Conservation is given G's own rejected-event-id set; a genuinely
funded, legitimate claim-issue is confirmed completely unaffected by
the new cross-check; and materializeConservation() called exactly as
every prior caller in this codebase already does — with the new
parameter simply omitted — is confirmed to reproduce the exact prior
(vulnerable) behavior unchanged, so the fix is additive and opt-in at
the API level even though main.js's own real wiring always opts in.
3 tests.

The full flow was verified end to end using the real two-phase
materialization main.js actually performs (materialize Conservation
without any pot-release verifier, materialize jackpot state from that,
then re-materialize Conservation with a real verifier closing over the
jackpot state) — not asserted as correct because reasoning suggested it
should be. Two independently-funded, really-signed donors' transfers
into the pot are confirmed to genuinely leave their control (their real
domain balance does not include the donated claim afterward); the
deterministic winner is confirmed recomputed, and every one of the
cycle's real donation claims is confirmed to correctly transfer to that
exact winner via 'pot-release', with a same-claim impostor-payout
attempt confirmed rejected while the legitimate winner's holdings are
left completely untouched; a domain's G balance is confirmed
unaffected by jackpot participation beyond the one claim-issue debit it
deliberately requested. This end-to-end check surfaced one further
implementation slip during development — an early draft's manually-
reconstructed claim id (guessing conservation.js's internal proof-id
format rather than reading the real, activated claim back from
materialized state) failed exactly where it should have, confirming
the recompute-don't-trust discipline this whole exercise depends on
applies as much to this appendix's own verification code as it does to
the production reducer it verifies. 34 new tests total across this
revision (25 + 6 + 3), 298 JS tests in the project overall as of this
revision.

H.30 — Cadence Integrity Closed: A Sequential Hash Chain, Real
Cross-Language Parity, and a Dormant Bug It Surfaced

This corresponds to §16.2, closing R11. Found by one direct question
— does the mandatory heartbeat already bound the rate of cadence
advancement? — and one direct pushback on an initially incomplete
answer that conflated the heartbeat's real, but different, role
(§16.1's own "two distinct roles that must not be conflated") with
what was actually being asked.

cadence-vdf.js / cadence_vdf.rs, fully tested independently in both
languages before either was wired into the real cadence reducer:
deterministic (the identical seed and iteration count always produce
the identical output); a real 64-character hex digest; a different
seed, or a different iteration count, produces a completely different
chain; the real production cost is measurably proportional to
iteration count, confirmed directly with real timing measurements
(JS), not assumed from the algorithm's shape; a genuinely computed
chain verifies; a fabricated output with no real computation behind it
is rejected; a real chain honestly computed for fewer iterations than
claimed is rejected — the count cannot be shortcut; a chain computed
under the wrong seed (wrong domain, or the wrong prior-epoch position)
is rejected; malformed claimed-output strings are rejected without
throwing; and epoch-to-epoch chaining is confirmed to genuinely depend
on the prior epoch's real output, not merely its existence — a
"epoch 2" proof computed against a guessed or wrong prior output
produces a different, non-matching chain. 12 tests in each language.

Cross-language parity was verified as a real, specific numeric claim,
not merely asserted structurally: cadence_vdf.rs's own test suite
includes a value independently computed by the JS implementation
(Node, initially via the real @noble/hashes SHA-256 implementation)
for an identical (seed, iterations) pair, confirmed to match the Rust
implementation's own output (real sha2 crate) exactly, byte for byte,
on the first attempt. A genuine transcription slip was caught and
corrected during this exact step — an early draft of this test used a
63-character value, one hex character short of a real SHA-256 digest,
copied by hand rather than verified programmatically; both Node's own
`.length` property and an independent Python length check confirmed
the real value is 64 characters before the corrected value was used,
rather than trusting either the initial hand-transcription or a single
tool's report of it.

Correction, found immediately after this section first shipped: using
@noble/hashes introduced this project's first external npm dependency
into a core reducer's own import chain (cadence.js → cadence-vdf.js).
Every other core reducer file in this project — g.js, conservation-
bridge.js's own hashing, module-hash.js — uses either native Web
Crypto or pure computation, with zero npm dependency, specifically so
the id-parity, g-parity, and conservation-parity CI jobs (each
correctly designed with no `npm install` step at all, unlike the
separate js-tests job that legitimately needs one for @solana/web3.js)
never needed one either. Confirmed directly: the g-parity job failed
exactly this way in real CI the first time this revision shipped. The
fix was not to add npm install to jobs that were correctly designed
not to need it, weakening a real, deliberate architectural property
for the sake of one file — cadence-vdf.js now carries its own
standard, dependency-free SHA-256 implementation instead, verified
against the official published test vectors (SHA-256 of the empty
string and of "abc") and, critically, against this exact function's
own prior @noble/hashes-backed output for the identical inputs, so no
already-committed fixture value — test-vectors/g-scenario.json, the
Rust cross-language parity constant above — needed to change.

Wiring the sequential-hash-chain requirement into cadence.js and
cadence.rs as MANDATORY — the only choice that actually closes R11 for
a real deployment, since an optional check a deployment can forget to
enable does not meaningfully close anything — required updating every
place in both languages that constructs a cadence event, not only the
reducer itself. In JS: 11 test files (cadence.test.mjs,
cadence-integration.test.mjs, g.test.mjs, g-integration.test.mjs,
conservation-bridge.test.mjs, ledger-bridge.test.mjs,
main-demo.test.mjs, and the shared cross-language fixture
test-vectors/g-scenario.json, found only by running the full suite
together rather than file-by-file, since its cadence events live in
JSON data rather than inline test code and were missed by an initial
grep-based sweep) plus a new shared helper
(tests/helpers/cadence-vdf-helper.mjs). In Rust: cadence.rs's own test
module, g.rs's, and conservation_bridge.rs's, each with their own
local cadence-event-building helper updated to compute and thread real
VDF proofs through, mirroring the JS side's own updates function for
function.

A genuine, previously-dormant bug in cadence.rs was found in the
course of this, unrelated to the VDF mechanism's own logic: the
existing `self.domains.entry(domain).or_default()` line — present
before this revision, never touched by the VDF work itself — reads the
current per-domain state, but as a documented side effect of Rust's
Entry API, ALSO inserts a default entry into the map immediately, even
when the transition that triggered the read is then rejected and the
function returns early. No test before this revision ever checked
`domains.get(domain).is_none()` after a rejection occurring past that
line, so a domain whose cadence transition was correctly rejected
could still silently appear in the map with a zombie epoch:0 entry —
harmless for every prior test's own assertions, which never inspected
map membership after such a rejection, but a real correctness gap
nonetheless. The new VDF-rejection tests were the first to check
exactly this, surfacing the bug immediately rather than leaving it
dormant further. Closed by replacing the read with
`.get(domain).cloned().unwrap_or_default()` — a pure, non-mutating
lookup — rather than papering over the test's own assertion to
accommodate the existing behavior.

A second, smaller Rust-specific issue was found and closed in the same
pass: `CadencePayload`'s new `vdf_iterations`/`vdf_output` fields,
declared as `Option<T>` without `#[serde(default)]`, caused an entire
payload to fail JSON deserialization when those keys were absent
(rather than deserializing to `None`, which was the intended, needed
behavior) — meaning a cadence event with no VDF proof at all was
silently treated as a malformed non-cadence event and passed through
unrejected, rather than being rejected with a clear reason, exactly
the opposite of the intended behavior. Closed by adding
`#[serde(default)]` to both fields.

The real, deployed application (main.js) now computes a genuine VDF
proof before every cadence advance — DomainReplica.advanceCadence()
seeds from the domain's own real, tracked lastCadenceVdfOutput (itself
correctly restored from real materialized cadence state on reload, not
merely tracked in memory) — with the iteration count exposed as a
per-deployment Parameters-screen value (default 200,000, roughly 240ms
on typical hardware) rather than a hardcoded constant, matching Δ's
own already-documented deployment-configuration discipline in §16.1.

Final counts as of this revision: 319 JS tests (up from 301 — 12 new
in cadence-vdf.test.mjs, plus the 11 updated files' own new R11-
specific security tests, net of the pre-existing count), 152 Rust
tests (up from 134 — 12 in cadence_vdf.rs, plus new R11-specific
security tests added to cadence.rs's own suite). Zero warnings in
either language's build.

H.31 — Composable Verification Primitives, Validated Against a Real Contract's Own Logic

This corresponds to §27.9, closing the second half of the scaling
problem §27.8 first named — permissionless composition of verification
LOGIC, not only of event types. Found by continuing a direct
conversation about §27.8's own generalization: asked plainly whether a
genuinely new causal contract would always need a new reducer file, the
honest answer was yes for logic outside a small, fixed vocabulary — and
that vocabulary, if kept deliberately small and non-Turing-complete,
was worth building rather than reaching directly for a full interpreter.

causal-condition-evaluator.js / causal_condition_evaluator.rs, fully
tested independently in both languages before either touched a real
contract: each of the six primitives confirmed correct in isolation —
ownership accepts a real, active claim owned by the expected domain and
rejects a claim owned by someone else, a nonexistent claim, or an
inactive one; count accepts when enough real matching events exist and
rejects otherwise, confirmed with both a bare event-type filter and a
domain-narrowed one; deterministic-match accepts when recomputing a
registered function genuinely matches the claimed output (confirmed
with both a whole-result comparison and an outputPath-extracted single
field), rejects a mismatch, rejects an unregistered function name
without crashing, and treats a throwing (JS) or None-returning (Rust)
recomputation as a rejection rather than a crash; unique accepts an
unused key and rejects one already present in the caller-supplied used-
keys set, confirmed read-only from the evaluator's own perspective;
causal-order accepts a real ancestor found by walking the DAG's own
parent chain, rejects a non-ancestor, rejects an unknown afterEventId,
and is confirmed to work correctly through a real merged, multi-parent
DAG shape, not only a simple linear chain; signature accepts a real,
valid Ed25519 signature whose derived domain matches the claim, and —
the security-critical cases — rejects a signature over a different
message than claimed and rejects when the signing key does not derive
to the claimed domain. Composition (all/any/not, including a real
nested multi-level tree) is confirmed to short-circuit and combine
correctly. Malformed conditions (null, undefined, an unknown primitive
type, a non-object) are confirmed rejected without throwing. 31 JS
tests, 22 Rust tests.

The validation this section's own prose describes — rewriting
pool-reducer.js's verifyPoolPayout to construct a declarative condition
and delegate to the shared evaluator, rather than hand-writing the
final ownership and deterministic-match checks inline — was confirmed
against tests/pool-reducer.test.mjs's own 25 tests, left completely
unmodified rather than adjusted to fit the new implementation: all 25
passed unchanged, confirming the evaluator is a genuine drop-in
replacement for this real contract's own security-critical logic, not
merely a standalone system that resembles it. A further, real end-to-
end run — a real domain accruing real balance, minting a real pool,
transferring a real signed claim into it, contributing, and releasing
the real payout through the rewritten, generic-evaluator-based
verifyPoolPayout — was performed directly, confirming the full donate-
through-payout flow functions identically to the hand-written
implementation it replaced, not only that isolated unit tests still
pass.

A real, minor path-resolution mistake was made and caught immediately
during this work, not left in: causal-condition-evaluator.js's
signature primitive dynamically imports domain-id.js using a relative
path written as if the evaluator lived one directory deeper than it
actually does (`../identity/domain-id.js` instead of the correct
`./identity/domain-id.js`, since causal-condition-evaluator.js itself
lives directly in public/js/core/, not in a subdirectory of it) —
caught by the very first test run against the real file tree, not by
manual inspection, and corrected before any other work proceeded.

Both languages' function-recomputation primitive deliberately loads its
real cryptographic dependency (@noble/curves in JS, already a direct,
declared Cargo dependency in Rust) the same careful way this project
already learned to: the JS evaluator's signature primitive imports
@noble/curves and domain-id.js dynamically, inside the function that
needs them, specifically so causal-condition-evaluator.js itself never
carries a top-level dependency that could reproduce the exact CI break
Appendix H.30 already recorded and fixed for cadence-vdf.js, even
though this specific file is not currently reachable from any of the
no-npm-install parity CI jobs — a defensive choice made because it
costs almost nothing, not because a break was confirmed to already
exist.

This gap — pool-reducer.js had no Rust mirror at all as of this
revision — stood for exactly one revision; see Appendix H.32 for the
Rust mirror, its own real validation, and two further real gaps its
construction surfaced in conservation_bridge.rs itself. 31 + 22 = 53 new
tests total across both languages this revision: 365 JS tests, 185 Rust
tests (179 lib + 6 integration), zero warnings in either language's
build.

H.32 — The Pool Reducer's Rust Mirror, and Two Real Gaps Its Construction Surfaced in conservation_bridge.rs

This corresponds to §27.8's and §27.9's own updated notes. Built
directly in response to being asked, plainly, to close the gap those
two sections had just named honestly: pool-reducer.js had no Rust
mirror at all.

Building pool_reducer.rs required 'pot-release' to exist in
conservation_bridge.rs first — and it did not, at all, in either its
signature-free-but-verified form or its companion over-issuance fix.
Direct inspection confirmed both gaps before any code was written:
apply_conservation_event's real signature took only (state, event),
with no injected-verifier parameter and no cross-check against G's own
rejected-event-id set — meaning the Rust mirror had silently never
received either of the two real security fixes Appendix H.29's own JS
work had already closed. This was not a design choice deferred on
purpose; it was an omission, found only because pool_reducer.rs's own
construction needed to lean on 'pot-release' to exist. Closed in
conservation_bridge.rs directly, mirroring the JS fixes exactly:
apply_conservation_event / materialize_conservation gained two new
optional parameters, g_rejected_event_ids and verify_pot_release, both
None-by-default and both fully backward compatible — confirmed
directly, with a dedicated test asserting that omitting them entirely
reproduces the exact prior behavior. 7 new tests cover both mechanisms:
a zero-balance domain is confirmed unable to obtain a real claim once
Conservation is given G's own rejected-event-id set; a genuinely
funded claim-issue is confirmed unaffected; a pot-release is confirmed
rejected outright with no verifier supplied, accepted when the injected
verifier approves, rejected when it disapproves, and rejected on a
replayed nonce, mirroring conservation-bridge.js's own security-test
suite for 'pot-release' exactly.

pool_reducer.rs itself mirrors pool-reducer.js structurally — the same
pool-init/pool-contribute event handling, the same current-open-cycle
derivation from the real fold alone, the same claim-ownership and
active-status checks against the real, final materialized Conservation
state — and, per §27.9's own recommendation, verify_pool_payout was
written directly in its final form: constructing a declarative
Condition (real claim ownership, plus a deterministic-match against a
recomputed weighted draw) and delegating to
causal_condition_evaluator.rs's evaluate_condition, rather than a
hand-written version later rewritten. 25 tests mirror the JS suite's
own 25 exactly, one for one, including every SECURITY-labeled case: a
contribution referencing a claim never really transferred to the pool
is rejected; the stale, pre-transfer claim id (left Consumed once
transfer() activates a new one under `activated:{proof.id}`, the exact
same naming convention as the JS side's own Conservation) is rejected
if used instead of the real, post-transfer id; the recorded amount
always matches the real claim, never a self-declared field; the same
real claim cannot back two contributions; a legitimate payout to the
real, recomputed winner is accepted; a payout to anyone else, before
the cycle has genuinely closed, for a claim never part of the cycle,
for an already-released claim, claiming the wrong pot address, or for
an unknown pool, is rejected in every case; a malformed release proof
is rejected without panicking. All 25 tests use real Conservation
fixtures — real issue_claim and transfer calls — not hand-built claim
objects, the same discipline conservation_bridge.rs's own tests already
established.

Cross-language parity was measured directly, not assumed from the
algorithm's shared shape: the identical (poolId, cycleIndex,
contributions) input was run through pool-reducer.js's own
computeWeightedDraw and pool_reducer.rs's own compute_weighted_draw,
side by side, in the same working session — winnerDomain, totalAmount,
and the full 64-character SHA-256 drawHash all matched exactly, on the
first attempt, with no discrepancy to reconcile. This exact value is
now pinned as a permanent regression test in pool_reducer.rs itself,
not left as a one-off terminal comparison that could silently drift
from the code it once verified.

Final counts as of this revision: 218 Rust tests total (up from 185 —
7 new tests in conservation_bridge.rs closing the two mirrored gaps, 25
new tests in pool_reducer.rs itself, including the cross-language
parity test; 212 lib tests + 6 integration tests = 218). JS is
unchanged at 365 tests, since this revision's work was entirely on the
Rust side. Zero warnings in either language's build.

H.33 — A Systematic JS/Rust Sweep, Not Just a Reaction to the Next Task

This corresponds to the new §17 matrix row on cross-language parity as
its own risk category. Every cross-language gap found and closed
earlier this session (the module-hijacking vulnerability's Rust side,
the over-issuance cross-check, 'pot-release', pool-reducer.js's entire
Rust mirror) was found the same way: a specific task required touching
both languages, and the comparison happened as a side effect of that
task, not as its own deliberate activity. Named directly as a real
concern in its own right, not merely a string of coincidences: if the
pattern was real, it should be findable by DELIBERATELY comparing the
two languages function by function, not only when some other task
happens to force the comparison.

Method: every file in public/js/core/ implementing a real reducer
(recognized by the initial*State/apply*Event/materialize* pattern this
project's own reducers consistently follow) was listed and matched
against rust-core/src/. Files legitimately expected to have no Rust
mirror — browser/network-only code (solana-rpc.js, solana-wallet.js,
module-sandbox.js's DOM handling), pure local UI state never folded
from H_d (desktop-layout.js, theme-tokens.js), and EventDag's own
subscribe() method, already explicitly documented in its own doc
comment as JS-only by design — were excluded up front rather than
treated as findings. For every remaining pair, exported function names
were compared directly (`grep`-extracted from both languages, not
read file by file from memory), and any exported name present in one
language's list but absent from the other's was investigated directly
rather than assumed to be a naming difference.

Two real gaps were found this way, not zero — itself informative: had
the sweep found nothing, that would have been weak evidence the
concern was overstated; finding real gaps on the very first systematic
pass is stronger evidence the concern was correctly identified as a
real, recurring risk category rather than a one-off.

First, a small gap: rankFromIdentityAndCadence (module-rank.js) — a
thin composition of two already-independently-mirrored pieces (a
domain's real registered burn, its real current cadence epoch) — had
no Rust equivalent at all, meaning Rust could not compute this
composed value, though every piece it depends on was already correct
on both sides. Not itself a new security check; a real capability gap
regardless. Closed directly: rank_from_identity_and_cadence added to
module_rank.rs, mirroring the JS default (0 for an unregistered
domain) exactly, with 2 new tests mirroring the JS suite's own two
cases precisely.

Second, a genuinely larger gap: public-profile-reducer.js — a complete,
real reducer implementing the hyperprofile mechanism (§27.6), following
the exact same initial*State/apply*Event/materialize* shape as module-
registry-reducer.js, formula-registry-reducer.js, and every other
already-mirrored reducer — had no Rust file at all, not a signature
mismatch on an existing one. Closed directly: public_profile_reducer.rs
built from scratch, 10 tests, including one deliberately testing a
subtle behavior worth preserving exactly rather than "cleaning up":
JS's `value === null` check distinguishes an explicit JSON null (a
real, deliberate unpublish) from the `value` field being entirely
absent from a payload (`undefined !== null` in JS, which takes the
"set" branch instead of the "delete" branch) — mirrored precisely via
Rust's `Option<&Value>` rather than collapsing both cases to the same
outcome, specifically so a converged H_d materializes identically in
both languages even for this edge case, confirmed directly with a
dedicated test rather than assumed to not matter.

What this sweep does NOT claim: that it is now complete, automated, or
guaranteed to run again. It was one deliberate pass, prompted directly
rather than performed routinely, and the two gaps it found were real —
meaning further, undiscovered gaps of the same kind are a live
possibility, not a closed question. The §17 matrix records this
honestly as its own row rather than folding the finding quietly into
the specific files it touched.

Final counts as of this revision: 230 Rust tests total (up from 218 —
2 in module_rank.rs, 10 in public_profile_reducer.rs; 224 lib + 6
integration = 230). JS unchanged at 365 tests. Zero warnings in either
language's build.

H.34 — Permissionless Contract Minting: the Actual Last Mile, Demonstrated End to End

This corresponds to §27.10. Built after being asked directly whether
the composability promise §27.9 validated was actually delivered yet —
it was not, and naming that honestly, rather than resting on §27.9's
own real success, is what led to this work.

generic-contract-reducer.js / generic_contract_reducer.rs, fully
tested in both languages: a contract mints once with a real condition;
the same contractId cannot be re-minted with a different condition
(a real security test, not just a structural one — an attacker's
attempt to re-mint with a trivially-satisfiable condition is confirmed
rejected, with the original condition confirmed still in effect); a
mint with a missing or invalid condition is rejected without a crash;
materialize folds a real sequence correctly. substitutePlaceholders /
substitute_placeholders is confirmed to replace $claimId/$from/$to
wherever they appear as plain string values, to leave non-placeholder
strings completely untouched, to work correctly through nested
all/any/not composition, and — a real, deliberately-checked property,
not assumed — to never mutate the original template, since a minted
condition must remain a reusable pattern applied fresh to every release
attempt, not consumed or altered by evaluating it once.

The security-critical function, verifyGenericRelease /
verify_generic_release, was tested against the exact failure mode this
mechanism exists to prevent: an attacker constructs a release attempt
whose releaseProof carries a smuggled `condition` field alongside the
real `contractId`, hoping it gets evaluated instead of the real, minted
one. Confirmed directly, using a real minted condition chosen
specifically to be unambiguously false (a count of an event type that
never occurred) so the test can actually distinguish "the real
condition was evaluated" (must reject) from "the smuggled, trivially-
true one was used instead" (would wrongly accept): the release is
correctly rejected, confirming the smuggled field is never read at all
— only releaseProof.contractId is. A legitimate release matching the
real minted condition is confirmed accepted; a release referencing an
unminted contractId, and a malformed releaseProof, are both confirmed
rejected without throwing.

The end-to-end demonstration — a real 2-of-2 threshold-release escrow,
a genuinely new contract type sharing no code with pool-reducer.js at
all — was run twice: once as a standalone test using hand-built
fixtures, and once (JS only, since Rust has no equivalent application
layer to wire this into — see §27.10's own note on this) against the
actual application's real, two-phase materializeConservation(), the
identical composition path a real deployed session would use: a real
domain accrues balance, mints the escrow contract with its condition,
funds it with a real signed transfer, and a release attempt is
correctly withheld with only one of two required real approval events
present, then correctly succeeds once both are, releasing the real
funds to the real beneficiary. This confirms the mechanism works
through the application's own real wiring, not only in isolation.

conservation-bridge.js's real 'pot-release' verifier composition
(main.js's materializeConservation()) now tries pool's own check first,
then the generic-contract check, composed via ordinary sequential
fallback rather than a new primitive — safe specifically because a
releaseProof's own shape ({poolId, cycleIndex} versus {contractId}) is
structurally distinguishable, so a mismatched proof simply fails both
checks rather than being ambiguously routed.

Two honest limits are recorded precisely in §27.10's own prose, not
repeated here beyond this pointer: the scope boundary excluding
stateful-accumulation contracts (pool's own weighted draw remains a
dedicated reducer, correctly, not force-fit into this mechanism), and
the `unique` primitive's real inability to track used keys across the
fold within this specific mechanism, both confirmed by direct
inspection and tests rather than assumed.

The Rust mirror required one real, additional piece the JS side does
not: causal_condition_evaluator.rs's own Condition enum has no direct
serde Deserialize derive covering its field-per-variant shape, so
generic_contract_reducer.rs includes its own explicit parse_condition
function, hand-written and tested rather than derived — a genuinely
stricter, more explicit parsing requirement than JS's permissive object
literal, stated honestly as a real cross-language difference rather
than smoothed into "the same, basically."

Final counts as of this revision: 238 Rust tests total (up from 230 —
8 new tests in generic_contract_reducer.rs, including the end-to-end
threshold-escrow demonstration; 232 lib + 6 integration = 238). JS: 378
tests total (up from 365 — 13 new tests in
generic-contract-reducer.test.mjs, including the same end-to-end
demonstration run against the real application's own materialization
logic). Zero warnings in either language's build.

H.35 — The Idea Agent's Context, Deepened: Usage Over Registration, Recency Over All-Time, Multiple Contacts Over One

This corresponds to §28's update. Found and built after a direct
exchange: asked whether AIWA's idea agent enriched itself well from
plugin submissions, the honest answer required naming something the
user then pushed back on precisely — an earlier YourMine-inspired
exploration of a genuinely deeper, "mined-pattern" context system had
existed and was deliberately set aside (Appendix H.27's own record),
and the user wanted the current, narrower version enriched in that
direction rather than left as-is.

collectContextSnapshot()'s three new signals, each tested against the
specific distinction it exists to make, not only its own presence:

- Own usage vs. own authorship: `myPinnedModuleIds` (desktop-layout.js's
  own allModuleIdsInLayout, real local arrangement) and
  `myPublishedData` (public-profile-reducer.js's own
  publishedDataForDomain) pass through as an optional, defaulted-empty
  parameter — confirmed to round-trip untouched when supplied, and to
  default to empty rather than throw when omitted, so an older caller
  (or a hand-built test snapshot) degrades gracefully rather than
  breaking. The system prompt weaves these in directly ("this domain
  actually keeps N module(s) pinned... real usage, not just
  registration"), confirmed by a real prompt-content test, not only a
  data-shape one.

- Recency over all-time: trendingCategories confirmed, with a
  deliberately adversarial test, to surface a category that is a
  minority all-time but the ONLY category among the most recently
  registered third of the network — the exact case a flat count would
  miss entirely, confirmed by construction (3 old Tools modules against
  1 brand-new Games module; trendingCategories[0] is Games).

- Multiple independent contacts over one prolific contact:
  multiContactOverlap confirmed, again adversarially, to require 2+
  DISTINCT contact domains, not 2+ modules from the same contact — one
  contact with two modules in the same category produces an EMPTY
  multiContactOverlap (confirmed directly), while two different
  contacts each with one module in the same category correctly produces
  {category, contactCount: 2}. categoryGaps confirmed as a real set
  difference (contacts' categories minus this domain's own), including
  the case where the gap is genuinely empty because this domain already
  covers everything its contacts do.

The defensive leak-marker list (sanitizeIdeaReply's own known-failure-
mode guard against small local models regurgitating instruction text)
was extended to cover the newly introduced instruction phrases
("TRENDING categories", "CATEGORY GAPS", "MULTI-CONTACT PATTERNS",
"Prefer an idea that ties to"), confirmed with a dedicated test that a
leaked instance of one of these new phrases is still correctly
truncated — a real, checked consequence of enriching the prompt, not
an assumption that the old marker list would keep working unchanged.

Wired into the real application, not left as a tested-but-unused
capability: both of main.js's own real call sites now pass the real
pinnedIds() and publishedDataForDomain() results into
collectContextSnapshot(), confirmed by direct inspection of the
resulting diff rather than assumed from the function signature alone.

The structural guarantee this whole section exists to protect —
"the idea agent has no path into §8–§24" — was re-examined directly
rather than assumed to survive the enrichment unexamined: every new
signal is read-only, sourced from data already materialized (the
module registry) or already the caller's own real local state (desktop
pins, own published data, never another domain's private or financial
state), and the function this feeds, buildIdeaSystemPrompt, still only
ever produces a prompt string — no new signal is written anywhere, and
none reaches any consensus-relevant function. This holds by
construction (nothing in idea-agent.js performs a write of any kind, a
property already true before this revision and unchanged by it), not
merely by continued assertion.

Final counts as of this revision: 19 tests in idea-agent.test.mjs (up
from 10 — 9 new, covering the three new signals and their prompt-level
integration), 387 JS tests in the project overall. Zero warnings.

H.36 — A Real GitHub Bot, a Legal Correction Made Before Building, and a Deployment Bug Caught Before It Shipped

This corresponds to §28's second update this revision. The user
initially described "a LinkedIn bot for the AI," modeled on a YourMine
subsystem — named directly as a real legal exposure (LinkedIn's terms
of service generally prohibit automated scraping without their own
restrictive official API) before any code was written, not discovered
after. The user then corrected their own request: a GitHub bot, not
LinkedIn — which resolved the legal question cleanly, since GitHub
publishes a real, official, documented, public REST search API
(GET /search/repositories) with a stated, generous-enough-for-a-daily-
run rate limit (10 requests/minute unauthenticated), confirmed directly
against GitHub's own current documentation before this was built, not
assumed from general knowledge.

scripts/fetch-github-trends.mjs, split the same way solana-rpc.js and
webllm-engine.js already are: buildSearchQuery() and
shapeTrendsFromApiResponse() are pure, fully tested against a fixture
matching GitHub's own real, documented response shape (items[].
full_name, .description, .language, .stargazers_count, .html_url,
.topics — confirmed against the real API documentation before the
fixture was written, not guessed); the real network call itself is
untestable in this project's own sandboxed runner, for the same
network-access reason as those two files, and is not invoked by any
test. 6 tests: the search-query date qualifier is confirmed correct for
multiple lookback windows; the response shaping is confirmed against a
real-shaped fixture including a repository with no description and no
topics (both fields GitHub's real API can genuinely omit); a malformed
or empty API response is confirmed handled without throwing; a default
timestamp is confirmed to fall within the real call's own execution
window.

update-github-trends.yml, the actual bot: a scheduled GitHub Action
(daily, plus manual dispatch for the first seeding run), mirroring
ci.yml's own wasm-build job's exact commit-back pattern — same bot
identity, same diff-before-commit guard so an unchanged day's data
never produces an empty, noisy commit. The committed data file itself
(before the bot's first real run) is deliberately an honest, empty
placeholder (fetchedAt: null, an empty repositories array, with an
explanatory note field) rather than fabricated example content — this
project's "never invent a trend" discipline, already stated for the
model's own prompt, applied here to the file that now feeds it.

A real deployment bug, caught before it ever shipped rather than
discovered later in production: the data file was initially written to
a repository-root data/ directory. Reading deploy-pages.yml's own real
configuration directly (rather than assuming the path would resolve)
showed it uploads only the public/ directory as the Pages artifact —
meaning a repo-root data/ file would never actually be served by the
deployed site at all, and main.js's own same-origin fetch would
silently, permanently fail (caught by cachedExternalTrends simply
staying null forever, not a crash — but silently never working is its
own real failure mode, worth catching before shipping rather than
after). Corrected to public/data/github-trends.json before this was
delivered — both the bot's own write path and the deployed app's fetch
path confirmed to agree.

idea-agent.js's own extension: collectContextSnapshot() gained a fifth
parameter, externalTrends, defaulting to null and passed through
untouched — confirmed directly, including with the real, honest,
empty-placeholder shape the committed file starts in, which is treated
identically to "no external data available" rather than as real,
present-but-empty data. buildIdeaSystemPrompt() renders this as its
own, separately-labeled prompt block — confirmed, with a dedicated
test, that an external repository's real programming language field
never leaks into sharedCategories/trendingCategories, the fields that
specifically mean "real activity on THIS AIWA network" — and states
real data freshness honestly (fetched today vs. N days ago, may be
stale) rather than implying the data is always current. The leak-
marker list guarding against small local models regurgitating
instruction text was extended to cover the new section's own header
phrase. 6 new tests in idea-agent.test.mjs.

Wired into the real application: main.js gained a small, module-level
cache (cachedExternalTrends) and a lazy, fire-and-forget loader
(loadExternalTrendsOnce()) — deliberately never awaited inside a render
function, so the idea agent's own availability and responsiveness
never depends on this fetch resolving, failing, or even having started
yet, matching §7's own discipline precisely rather than only in prose.
Both of the application's real call sites now pass the cached value
through.

Final counts as of this revision: 25 tests in idea-agent.test.mjs (up
from 19), 6 new tests in fetch-github-trends.test.mjs, 399 JS tests in
the project overall. Zero warnings.

H.37 — Mining AIWA's Own Real Modules for Mechanism Patterns, Adapted Not Ported

This corresponds to §28's third update this revision. The user shared
the real source behind the earlier YourMine reference (mine-patterns.js,
ym-spec.json) directly, asking whether it inspired further work — it
did, but genuinely adapting it required naming two real, structural
reasons it could not simply be ported, both confirmed by direct
inspection before any code was written, not assumed.

First: YourMine's own miner crawls a single, centralized files.json
manifest from one GitHub repository — a real, fetchable, canonical list
of every sphere that exists. AIWA has no equivalent, by design: module
registration is permissionless and DAG-replicated, and different
domains have reconciled different subsets of the real network, so "the
complete list of every module that exists" is not even a meaningful
concept to crawl. This is why fetch-github-trends.mjs's own scheduled-
bot pattern (Appendix H.36) could not be reused here — there is nothing
external and centralized for a bot to poll. module-pattern-miner.js
instead mines whatever real modules THIS domain's own materialized
registry already contains.

Second: YourMine's ym-spec.json is explicitly built to feed a model
enough structural knowledge to GENERATE new sphere code —
skeleton_by_intent contains full, ready-to-adapt code templates for
three module archetypes. §28 already confirmed, directly and more than
once this revision, that code generation stays outside AIWA's actual,
confirmed AI scope. module-pattern-miner.js's own header states this
boundary explicitly rather than leaving it to be inferred: the file
stops at pattern FREQUENCY data, never code.

module-pattern-miner.js, fully tested (11 tests): extractModulePattern()
confirmed to detect a real IIFE wrapper and correctly report its
absence; to detect real ctx calls actually present in a module's code,
including dotted calls (ctx.storage.get/ctx.storage.set) handled
correctly, and to NOT report a call that isn't actually present; to
report a real line count. The KNOWN_CTX_CALLS list itself is confirmed,
via a dedicated test, to match module-sandbox.js's own real, currently-
constructed ctx object exactly — not YourMine's different ctx surface,
and not assumed to stay correct without a check. summarizeModulePatterns()
confirmed to compute real frequencies across multiple modules, to
correctly filter patterns below a given threshold, to identify ctx
primitives NEVER used by any mined module — the genuinely new signal
this mining adds, distinct from every prior signal, since it points at
an entirely unexplored MECHANISM rather than merely an under-
represented category — and to handle zero mined modules honestly
(every primitive reported as unused, not an error).

Wired into the real application: main.js gained
mineMechanismPatternsOnce(registryState), bounded to 20 modules and
reusing loadVerifiedModuleCode (module-loader.js) — the same real,
hash-verifying fetch mountModule() itself uses to run a module at all,
a genuine integrity guarantee the YourMine original's own raw,
unverified fetch() never had. A module whose code fails to fetch or
fails hash verification simply does not contribute to the mined
sample, confirmed not to block or fail the others. Never awaited inside
a render function, matching loadExternalTrendsOnce()'s own established
pattern exactly.

idea-agent.js's own extension: collectContextSnapshot() gained a sixth
parameter, mechanismPatterns, defaulting to null, rendered in its own
prompt section confirmed by a dedicated test to include real common-
pattern percentages and real never-used primitives when data is
present, to state honestly that nothing has been mined yet when it
isn't, and — the test written specifically to guard the boundary this
whole appendix exists to protect — confirmed to never contain a code
skeleton or the literal word "skeleton" anywhere in the rendered
prompt. The leak-marker list was extended to cover the new section's
own header phrase. 5 new tests in idea-agent.test.mjs.

Final counts as of this revision: 11 new tests in
module-pattern-miner.test.mjs, 5 new tests in idea-agent.test.mjs (30
total, up from 25). 415 JS tests in the project overall. Zero warnings.
