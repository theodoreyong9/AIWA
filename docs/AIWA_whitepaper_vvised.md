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

Verification and consumption must be crash-safe and replay- resistant: a proof that can be verified twice but consumed twice is not a conservation mechanism, it is a double-spend waiting for the right crash window. AIWA's wallet layer implements this invariant with a persisted consumption record checked atomically before any state transition is applied (Appendix B's reference pseudocode, the "Wallet consumption guard (§7)" block — not Appendix B.7, which is a distinct mechanism, the merge-identifier replay guard; executable confirmation of this section's invariant, including a deliberately non-atomic counterexample, is in Appendix H.9).

8. Autonomous Accrual as a Replicated Data Type

Each accrual event is e = (d, c, b, id, θ) where id(e) = H(d, c, payload) using a full-width cryptographic hash — never truncated, since a truncated identifier reintroduces exactly the collision risk the identity-sufficiency argument in §11 is built to reason about precisely.

Replicated state is a set: H_d = {e₁, …, eₙ} . Local insertion is H_d' = H_d ∪ {e} . Merge across domains is set union: H_E ⊔ H_M = H_E ∪ H_M . Set union is idempotent ( H ∪ H = H ); a raw scalar total is not itself an idempotent replicated state — merging the same scalar contribution twice changes the result ( 100 + 100 = 200 ≠ 100 ). This is not a claim that addition is incompatible with replicated data types in general — an accumulator construction can use addition inside a materialized view while keeping the replicated state itself a per-source, monotonically-tracked structure. The requirement is narrower: addition may appear inside G (§9), provided the replicated state H retains enough per-event identity that a

duplicate delivery is recognized and discarded before contributing to the sum. This is exactly the role event identity plays in §11, and exactly what fails when it is removed (§20, variant V1).

8.1 Canonical encoding is part of the identity contract, not an implementation detail. H in id(e) = H(d, c, payload) is only well-defined once it is understood to operate on a canonical byte encoding of (d, c, payload), not on whichever serialization a given implementation happens to produce. For a scalar payload this distinction is invisible; for a structured payload — the common case once modules attach arbitrary event metadata (§27.2) — it is not: two conforming implementations that serialize the same logical value with object keys in a different order produce different hash inputs, and therefore different ids for what the protocol intends to be the same event, silently breaking the deduplication-by-identity that this section's set-union merge and Lemma 1 (§11) both depend on. This is not hypothetical. The reference implementation's two client-side encodings (JavaScript, Rust) initially diverged on exactly this case: Rust's default JSON value type canonicalizes object keys, JavaScript's JSON.stringify does not. The fix — recursive key-sorting applied identically before hashing on both sides — is verified against a fixed cross-implementation test-vector set covering nested payloads, arrays, and unsorted parent lists (Appendix H.5), not merely asserted to work. What this revision does not do is promote that fix to a specified part of the wire protocol: the paper still does not mandate a specific canonical encoding (e.g. a deterministic CBOR profile, or an explicit key-ordering rule in the event's byte representation), which means canonicalization remains a convention each implementation must independently get right rather than a checkable protocol requirement — exactly the kind of implicit, unchecked assumption §1 argues against inheriting. Recorded as open work in §29.9.

9. Replicated State Is Not the Economic View

A = G(H, θ) . Convergence of H (i.e. H_E = H_M ) does not automatically imply convergence of A — that additionally requires G to be a deterministic function of the converged event set alone. If G depends on receipt order, local execution history, mutable external state, or information discarded by the event-identity scheme, the event set can converge while the materialized economic state does not. This distinction is one of AIWA's central design requirements, and §21 tests it directly by breaking it on purpose.

9.1 "A deterministic function of the set" needs a specified canonical order, not just any topological one. This is not a restatement of the paragraph above — it is a sharper condition the reference implementation exposed by construction, not by design. A cadence-derived q (§10) is read from the domain's current epoch *as folded so far* at the point an accrual event is processed. For events with no strict ancestor relationship in the DAG — an accrual event and a later cadence event that both descend from some common but non-adjacent ancestor — more than one topological order of H is valid, and different valid orders can fold that cadence event before or after the accrual event, changing which q the accrual event receives, and therefore its reward. Concretely: in the reference implementation's shared test fixture (Appendix H.7), an accrual event with q_0 = 0, whose only direct parent is a cadence event at epoch 2, is folded only after a later, unrelated epoch-3 cadence event — because that epoch-3 event was pulled earlier in the canonical order by an unrelated descendant with a lexicographically smaller id. The accrual event legitimately receives q = 3, not q = 2. This is not a bug: both orderings are valid topological sorts of the same converged H, and the result is fully deterministic *given a specific tie-breaking rule* — id-sorted depth-first traversal, in this implementation (Appendix B's reference pseudocode, and public/js/core/event-dag.js / rust-core/src/core.rs's topo_order()). The point this section adds to §9's requirement: "G is a deterministic function of the converged event set" is necessary but not sufficient for two independent implementations to agree. Each could independently satisfy it — each internally deterministic, each depending only on the set — while disagreeing with each other, because they chose different (both individually valid) canonical tie-breaking rules for turning a set of parent-linked events into one order. §8.1 made this argument for the byte encoding hashed into an event's identity; the same argument applies to the function that orders events for folding. Materialization order is therefore part of the identity/consensus contract in the same sense canonical encoding is, and is currently fixed only by matching reference-implementation behavior across two languages (Appendix H.7), not by an explicit protocol-level specification. Recorded as open work alongside §29.9.

10. The Accrual Function, With Cadence-Derived Economic Time

AIWA's reference reward function is:

  r(b, q) = K · b^α · q^β

where b is committed resource for the event, K, α, β are deployment-chosen
constants, and q is elapsed economic age measured in mandatory protocol
cadence epochs rather than in an unconstrained wall clock.

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
claims in this paper should be cited.

| Claim | Status in v1.1 | Evidence / limitation |
|---|---|---|
| Event-set convergence under reorder + duplicate delivery | Proved by construction; experimentally confirmed for the tested fault class | 500/500 trials in §20; not a Byzantine or permanent-drop proof |
| Deterministic materialization over a converged event set | Required by construction; broken variant demonstrated | §9, §21 V3 |
| Fixed global issuance bound under arbitrary partitions and persistent positive issuance | Impossible under stated assumptions | Proposition 1, §12 |
| Bounded currently-valid supply with expiring rights | Constructively achievable | §13.3 and Appendix H.4 |
| Weak identity is sufficient when economic meaning is invariant within an identity class | Proved for first-representative-wins deduplication | Lemma 1 and §22 |
| Sybil resistance for α > 1 in the fixed-capital model | Splitting is locally disincentivized | Algebraic result in §24.1; this is not a general real-world Sybil proof |
| Sybil resistance for 0 < α < 1 | Conditional on identity and capital-acquisition costs | §24.1–§24.4; costs are not calibrated |
| Patient-capital security under random partition duration | Open | §24.3 and §29.1 |
| Wall-clock manipulation cannot directly change reward | Architectural requirement | §10; cadence integrity remains an unverified dependency |
| Cadence cannot be accelerated arbitrarily | Required, not established by the current prototype | §10, Appendix B.6.1, §29.8 |
| Protocol-level merge replay protection | Specified, not directly tested | Appendix B.7; V4 is only an economic surrogate |
| Physical truth of committed events | Not provided | §15, §29.3 |
| Third-party sandbox security | Specified/enforced in the reference interface; not exhaustively adversarially fuzz-tested | §27, Appendix G |
| AI non-authority for security decisions | Structural design invariant | §28; no AI-derived input enters core validity decisions |
| Machine-checked correctness | Not established | §29.4 |

This matrix deliberately prevents the phrase "AIWA is secure" from carrying more
information than the underlying evidence supports.

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

24.1 Adding identity cost to the fixed-capital case. Let an attacker hold total capital B , split evenly across N identities ( b = B/N each), and pay a fixed per-identity creation cost c_id > 0 . Profit as a function of N , for fixed B and elapsed age t :

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

24.6 Identity-cost mechanisms an AIWA deployment can actually configure. Four mechanism classes admit the closest

thing to a measurable c_id floor available in real deployments today:

(i) Bonded-capital staking. An identity requires a minimum bonded deposit before it is eligible to issue. The relevant cost is an opportunity cost — the spread between the riskless rate and the staking yield, times the deposit, times duration — which makes c_id a flow cost rather than a fixed one-time cost: c_id(T) ≈ (riskless rate − staking APY) × deposit × T . Since reward scales as t^β while this cost scales linearly in T , whether patient-capital exploitation grows profitable with T depends critically on β relative to 1. Slashing (the penalty for detected misbehavior) requires timely detection; under partition, slashing may not propagate until after T , reducing the effective cost further — the usable floor during a partition of length T shrinks as T grows, exactly the opposite of what a designer might hope.

(ii) Local proof-of-work registration. An identity-creation event carries a PoW puzzle solution. Unlike staking, this cost is sunk when paid — spent computation cannot be recovered — which makes it a better fit for the fixed-cost assumption of §24.1. The interplanetary complication: a shared-difficulty PoW system adjusts continuously with network-wide hash rate, but a domain-local PoW oracle running during partition has no such adjustment mechanism unless it uses a verifiable-delay- function or similar non-interactive construction — an attacker who pre-mines identity tokens before a partition begins faces only pre-partition difficulty. This is an open design question with no established solution in AIWA as specified here.

(iii) Attested hardware. A hardware root of trust (e.g. a WebAuthn-compatible security key, or a TPM where available) binds an identity to a physical device at low marginal chip cost,

but the system cost includes manufacturer certificate chains whose root authorities are external and may be unreachable during partition — an offline attested-hardware system requires pre-distributing trusted roots before partition begins, which converts this mechanism into a form of preallocated authority (§13.5). The effective c_id is the cost of undetected spoofing, substantially higher than the hardware's purchase price and difficult to calibrate precisely.

(iv) Reputation and credential aggregation. An identity inherits a Sybil-resistance score from multiple independently verifiable, pre-existing credentials. This is the closest existing approach to an empirically measured c_id in terrestrial deployments, because it can be tied to a market-revealed forgery price rather than an assumed one — but under partition, new credentials cannot be issued or verified against a terrestrial root, so the measured forgery cost is a lower bound on c_id for pre- partition identities only, a materially weaker guarantee than the mechanism provides in a terrestrial, always-connected setting.

The partition-delay problem common to all four mechanisms. In every case, identity-creation cost as actually paid by an adversary is not the cost advertised by the mechanism in a terrestrial deployment. It is a function of the terrestrial cost floor, the probability that misbehavior is detected within partition duration T , and the delay between misbehavior and enforcement — which under partition may exceed T entirely. A complete calibration must therefore distinguish registration cost (paid once, before partition), verification latency (bounded below by one-way propagation delay, above by T ), and enforcement cost (registered cost minus what is recoverable, discounted by detection probability). §24.1's treatment of c_id as a single fixed scalar implicitly conflates

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

26. Identity

An AIWA identity is a keypair (Ed25519, derived via BIP39/SLIP-10 from a locally-generated mnemonic) plus a locally-accumulated history. Two properties are structural requirements, not conventions:

Profile writes are events. A profile edit — a name change, a bio update, a new declared contact — is itself an event in the domain's event set H_d (§8), so it inherits exactly the same convergence guarantee (Lemma A1-equivalent, following directly from §9) as any other accrual event, rather than living in a separate, ad hoc storage record with no merge semantics of its own.

A profile's public commitment is evidence of non- tampering, not evidence of truth (§15). The verification API is named to make this unambiguous at the point a module author reads it, not buried in a paragraph of documentation likely to be skipped.

Key custody, stated as a limitation rather than solved. Keys are held client-side, encrypted at rest (PBKDF2, 200,000 iterations, AES-256-GCM). This is weaker than hardware- backed custody and AIWA does not claim otherwise — a browser environment has no general-purpose secure-enclave API, and a server-mediated custody model would reintroduce exactly the reachability dependency the whole platform exists to avoid. Hardware-key integration (WebAuthn-backed signing) is a stated future direction (§29), not a current guarantee.

27. Modules: Sandboxed Extensibility Without Elevated Trust

27.1 The module contract. A module is loaded code that receives a context object ctx at activation and nothing else. ctx exposes: ctx.storage (a namespaced key-value store, scoped per-module, inaccessible to other modules); ctx.send / ctx.onReceive (rate-limited peer-to-peer messaging, routed through the transport layer of §25 without the module ever touching it directly); ctx.toast (rate-limited user notifications); ctx.openPanel (UI surface within the module's own sandbox); ctx.sign (wallet signing — always gated behind an explicit user-facing confirmation dialog naming the amount, destination, and requesting module; a module can request a signature, it cannot obtain one silently). A module cannot: read or write another module's storage; intercept or

override the platform's network primitive; mutate platform globals; sign without confirmation; or access the private key material directly under any circumstance.

Activation must complete within a bounded timeout (8 seconds in the reference implementation); slow initialization work must be fire-and-forget rather than blocking activation, so that one slow or misbehaving module cannot stall the platform's boot sequence for the user.

27.2 Economic self-declaration. A module that emits accrual events (§8) must declare, at registration time, two things this paper's own analysis makes necessary: whether its reward function is time-sensitive (so the runtime selects a strong or weak event-identity scheme per Lemma 1, §11, automatically, rather than defaulting to the maximally strong — and maximally storage-costly — scheme everywhere), and its economic configuration — α , its declared identity-cost mechanism (§24.6), and its chosen scarcity mechanism (§13). Registration validation (Appendix B, validateEconomicConfig ) rejects a module declaring α ≤ 1 with zero identity cost, since §24.1 shows this configuration has an unbounded splitting incentive in the fixed-capital model, and rejects a module whose declared capital-acquisition cost function does not satisfy the growth condition of §24.3 where that function is given in closed form. A module that declares neither runs in a read-only, non-issuing mode — it can read the ledger but cannot add to it.

27.3 Presentation independence. The interface layer (theming, layout) is fully decoupled from module logic: a module's functional contract ( activate , deactivate , its rendering entry point) does not change based on which theme or presentation layer is active, and a presentation layer cannot

alter module behavior — only how a module's output is displayed. This matters specifically for interplanetary deployments, since a bandwidth- or hardware-constrained settlement may need a radically different presentation of identical underlying state, without every module needing to be rewritten to support it.

28. AI Assistance: Advisory, Structurally Non-Authoritative

AIWA includes an on-device AI layer for two functions: assisting module authors in generating new module code from a natural-language description, and triaging module activations or transactions for risk before presenting them to the user. Both functions are bound by a single structural rule, enforced at the architecture level rather than left to convention: no function in §8–§24 — merge validity, conservation, consumption-uniqueness, or the economic-configuration validation of §27.2 — takes AI-derived input of any kind. These functions are deterministic and symbolic; they produce the same accept/reject decision whether or not an AI component is installed, loaded, or functioning correctly. This is what G5 (§3) means concretely: removing the AI layer entirely changes the user experience and removes a convenience, and changes nothing about what the platform will or will not accept as valid.

AI-generated code receives no elevated trust. A module authored with AI assistance passes through exactly the same structural and sandboxing checks (§27.1) as hand-written code, and the runtime exposes no mechanism by which a

module could claim "AI-reviewed" status to bypass any of them.

Safety triage is non-blocking by explicit design. A risk assessment surfaces as a warning to the human operator; it does not gate activation or signing on its own. This is a deliberate choice, not an oversight: an unverified, locally-run model — degraded by a stale spec, an unavailable GPU context, or a corrupted local cache, all local failures with no relationship to the actual risk of the action — is exactly the kind of unstated trust dependency the rest of this paper's methodology (separating what is proved, what is tested, and what is merely assumed) exists to catch. Presenting it as a hard gate would quietly promote a UX aid into a security boundary it was never built to be.

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

29.8 Cadence-integrity mechanism. The v1.1 economic-time model removes the
wall clock from reward computation and instead requires a monotonically
advancing, replay-protected, bounded-advancement cadence counter. The open
work is to implement and formally verify this transition rule, including
crash recovery, local clock manipulation, skipped epochs, duplicated cadence
events, and long offline operation. Wall-clock integrity remains relevant
for transport and presentation, but is no longer a foundational dependency
of economic accrual.

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

D.2 Numerical illustration of N* (continuous relaxation, fixed t, α ≠ 1). K=1, B=1000, t=1, α=0.5, c_id=5 :

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

R11 Cadence integrity External-trust Not provided. assumption Load-bearing, unverified dependency of any time-

# Property Category Status

sensitive reward function (§10)

Proved Economic Sybil resistance, unconditionally R12 security α>1 regime for this regime assumption (§24.1)

Weakest category. Conditional on Economic positive c_id , Sybil resistance, R13 security uncalibrated, α≤1 regime assumption fixed-duration simplification only (§24.1– 24.4)

Conditional on stated growth Economic Capital-acquisition condition, not R14 security cost sufficiency mere convexity assumption (§24.3); uncalibrated

Not established. Economic Random- Patient-capital R15 security duration case bound assumption posed, not solved (§24.3, §29.1)

# Property Category Status

Proved algebraically; Budget / rate-limit / Economic policy confirmed R16 expiry-window enforcement numerically integrity (§21, Appendix H.4)

Proved algebraically (§13.2); RateBound ≠ Economic R17 confirmed SupplyBound design fact numerically (Appendix H.4, Policy C)

Proved (Lemma B.1); Reconciliation Convergence R18 confirmed determinism property empirically (§20)

Module sandboxing (storage isolation, Enforced as no fetch hard runtime R19 Safety invariant interception, no constraints unconfirmed (§27.1) signing)

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
