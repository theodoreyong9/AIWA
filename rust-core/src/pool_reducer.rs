//! pool_reducer.rs — mirror of pool-reducer.js. See that file's own
//! header for the full rationale: a general pool primitive (real
//! contributions, a weighted deterministic draw, signature-free-but-
//! recomputation-verified payout via conservation_bridge.rs's
//! 'pot-release'), of which a real community jackpot is one
//! application, not what this mechanism is specifically for.
//!
//! Honest note on this file's own history: this had no Rust mirror at
//! all until this revision — the jackpot/pool contract was only ever
//! built in JS. Building it surfaced two real, previously-undiscovered
//! gaps in conservation_bridge.rs itself, unrelated to pooling as such
//! but only found because this file needed 'pot-release' to exist:
//! the over-issuance cross-check (g_rejected_event_ids) and
//! 'pot-release' itself had never been mirrored from JS to Rust,
//! closed in conservation_bridge.rs alongside this file, not after it.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

use crate::causal_condition_evaluator::{evaluate_condition, Condition, EvaluationContext, FunctionRegistry};
use crate::conservation::ConservationState;
use crate::event::Event;

/// The pool address a given pool's contributions and payouts move
/// through — never a real domain, never backed by a keypair. The
/// literal prefix matches the JS mirror exactly, including its own
/// backward-compatibility note: it stays 'jackpot-pot:' even though
/// the file and functions around it are named generally.
pub fn pot_address(pool_id: &str) -> String {
    format!("jackpot-pot:{pool_id}")
}

#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub cycle_length_contributions: i64,
    pub minted_by: Option<String>,
    pub minted_at: i64,
}

#[derive(Debug, Clone)]
pub struct Contribution {
    pub contributor_domain: String,
    pub claim_id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Default)]
pub struct Cycle {
    pub contributions: Vec<Contribution>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PoolRejection {
    pub event_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default)]
pub struct PoolState {
    pub pools: HashMap<String, PoolConfig>,
    pub cycles: HashMap<String, HashMap<i64, Cycle>>,
    pub used_contribution_claim_ids: HashMap<String, bool>,
    pub rejections: Vec<PoolRejection>,
}

impl PoolState {
    pub fn new() -> Self {
        Self::default()
    }

    fn reject(&mut self, event_id: &str, reason: impl Into<String>) {
        self.rejections.push(PoolRejection { event_id: event_id.to_string(), reason: reason.into() });
    }

    /// Which cycle is currently accepting contributions — the first
    /// cycle whose contribution count hasn't yet reached the pool's own
    /// configured length. Purely derived from the folded history
    /// itself, never self-declared by any event.
    fn current_open_cycle_index(&self, pool_id: &str, pool: &PoolConfig) -> i64 {
        let empty = HashMap::new();
        let cycles_for_pool = self.cycles.get(pool_id).unwrap_or(&empty);
        let mut i = 0i64;
        while cycles_for_pool.get(&i).map(|c| c.contributions.len() as i64).unwrap_or(0) >= pool.cycle_length_contributions {
            i += 1;
        }
        i
    }

    /// Applies one event. `conservation_state` is the FULLY
    /// materialized Conservation state over the same H_d — read-only
    /// context, never mutated here. See pool-reducer.js's own header
    /// for why using the final materialized state (not an
    /// incrementally-tracked one) is deliberate and correct.
    pub fn apply_event(&mut self, event: &Event, conservation_state: &ConservationState) {
        let Some(kind) = event.payload.get("type").and_then(|v| v.as_str()) else { return };

        if kind == "pool-init" {
            let Some(pool_id) = event.payload.get("poolId").and_then(|v| v.as_str()) else {
                self.reject(&event.id, "missing poolId");
                return;
            };
            if pool_id.is_empty() {
                self.reject(&event.id, "missing poolId");
                return;
            }
            if self.pools.contains_key(pool_id) {
                self.reject(&event.id, format!("pool '{pool_id}' already initialized — permanent once minted"));
                return;
            }
            let cycle_length = event.payload.get("cycleLengthContributions").and_then(|v| v.as_i64());
            let Some(cycle_length) = cycle_length.filter(|n| *n >= 1) else {
                self.reject(&event.id, "cycleLengthContributions must be a positive integer");
                return;
            };
            let minted_by = event.payload.get("mintedBy").and_then(|v| v.as_str()).map(String::from);
            let minted_at = event.payload.get("at").and_then(|v| v.as_i64()).unwrap_or(0);
            self.pools.insert(pool_id.to_string(), PoolConfig { cycle_length_contributions: cycle_length, minted_by, minted_at });
            return;
        }

        if kind == "pool-contribute" {
            let (Some(pool_id), Some(contributor_domain), Some(claim_id)) = (
                event.payload.get("poolId").and_then(|v| v.as_str()),
                event.payload.get("contributorDomain").and_then(|v| v.as_str()),
                event.payload.get("claimId").and_then(|v| v.as_str()),
            ) else {
                self.reject(&event.id, "missing poolId, contributorDomain, or claimId");
                return;
            };
            if pool_id.is_empty() {
                self.reject(&event.id, "missing poolId");
                return;
            }
            let Some(pool) = self.pools.get(pool_id).cloned() else {
                self.reject(&event.id, format!("pool '{pool_id}' does not exist"));
                return;
            };
            if contributor_domain.is_empty() || claim_id.is_empty() {
                self.reject(&event.id, "missing contributorDomain or claimId");
                return;
            }
            if self.used_contribution_claim_ids.contains_key(claim_id) {
                self.reject(&event.id, format!("claim '{claim_id}' already backs a contribution — cannot be reused"));
                return;
            }

            let Some(claim) = conservation_state.claims.get(claim_id) else {
                self.reject(&event.id, format!("claim '{claim_id}' does not exist"));
                return;
            };
            if claim.owner != pot_address(pool_id) {
                self.reject(&event.id, format!("claim '{claim_id}' is not owned by pool '{pool_id}'"));
                return;
            }
            if claim.status != crate::conservation::ClaimStatus::Active {
                self.reject(&event.id, format!("claim '{claim_id}' is not active"));
                return;
            }

            let cycle_index = self.current_open_cycle_index(pool_id, &pool);
            let cycles_for_pool = self.cycles.entry(pool_id.to_string()).or_default();
            let cycle = cycles_for_pool.entry(cycle_index).or_default();
            cycle.contributions.push(Contribution { contributor_domain: contributor_domain.to_string(), claim_id: claim_id.to_string(), amount: claim.amount });
            self.used_contribution_claim_ids.insert(claim_id.to_string(), true);
        }
    }

    /// registry(H_d) for pools — mirror of every other materialize
    /// function in this project.
    pub fn materialize(ordered_events: &[&Event], conservation_state: &ConservationState) -> PoolState {
        let mut state = PoolState::new();
        for event in ordered_events {
            state.apply_event(event, conservation_state);
        }
        state
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Draw {
    pub winner_domain: String,
    pub total_amount: f64,
    pub draw_hash: String,
}

fn sha256hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hash_to_ticket_index(hex_hash: &str, total_tickets: u64) -> u64 {
    let prefix = &hex_hash[0..16.min(hex_hash.len())];
    let big_val = u64::from_str_radix(prefix, 16).unwrap_or(0);
    big_val % total_tickets
}

/// The deterministic draw — a specific distribution rule (weighted-
/// random, winner-take-all), not the only one this general pool
/// primitive could ever support. Mirror of computeWeightedDraw() in
/// pool-reducer.js. Synchronous here (Rust's sha2 crate is
/// synchronous), unlike JS's async version (Web Crypto's digest is
/// async-only) — same computation, same result, different calling
/// convention per language, matching how this project's other
/// cross-language mirrors already differ in sync/async shape where the
/// underlying platform APIs force it.
pub fn compute_weighted_draw(pool_id: &str, cycle_index: i64, contributions: &[Contribution]) -> Option<Draw> {
    if contributions.is_empty() {
        return None;
    }

    let joined: Vec<String> = contributions.iter().map(|c| format!("{}:{}:{}", c.contributor_domain, c.claim_id, c.amount)).collect();
    let hash_input = format!("{pool_id}|{cycle_index}|{}", joined.join("|"));
    let draw_hash = sha256hex(&hash_input);

    let mut total_tickets: u64 = 0;
    let mut ranges: Vec<(String, u64, u64)> = Vec::new();
    for c in contributions {
        let start = total_tickets;
        let tickets = c.amount.floor().max(0.0) as u64;
        total_tickets += tickets;
        ranges.push((c.contributor_domain.clone(), start, total_tickets.saturating_sub(1)));
    }
    if total_tickets == 0 {
        return None;
    }

    let winning_index = hash_to_ticket_index(&draw_hash, total_tickets);
    let winner_domain = ranges.iter().find(|(_, start, end)| winning_index >= *start && winning_index <= *end).map(|(d, _, _)| d.clone())?;
    let total_amount: f64 = contributions.iter().map(|c| c.amount).sum();

    Some(Draw { winner_domain, total_amount, draw_hash })
}

/// The injected verifier conservation_bridge.rs's 'pot-release' event
/// calls. §27.9's composable-primitives prototype (mirrored from the
/// JS side, Appendix H.31): this pool's structural checks (does this
/// pool/cycle exist, is it closed, does this claim belong to it) stay
/// pool-specific glue; the final, security-critical checks — real
/// claim ownership, and that recomputing the deterministic draw
/// genuinely matches the claimed winner — are expressed as a
/// declarative Condition evaluated by the shared, generic evaluator
/// (causal_condition_evaluator.rs), exactly mirroring how
/// pool-reducer.js's own verifyPoolPayout was rewritten.
pub fn verify_pool_payout(
    pool_state: &PoolState,
    conservation_state: &ConservationState,
    claim_id: &str,
    from: &str,
    to: &str,
    release_proof: &serde_json::Value,
) -> bool {
    let Some(pool_id) = release_proof.get("poolId").and_then(|v| v.as_str()) else { return false };
    let Some(cycle_index) = release_proof.get("cycleIndex").and_then(|v| v.as_i64()) else { return false };

    let Some(pool) = pool_state.pools.get(pool_id) else { return false };
    if from != pot_address(pool_id) {
        return false;
    }

    let Some(cycle) = pool_state.cycles.get(pool_id).and_then(|c| c.get(&cycle_index)) else { return false };
    if (cycle.contributions.len() as i64) < pool.cycle_length_contributions {
        return false; // cycle is not actually closed yet
    }

    let belongs_to_cycle = cycle.contributions.iter().any(|c| c.claim_id == claim_id);
    if !belongs_to_cycle {
        return false; // this claim was never part of this cycle's real contributions
    }

    // Build a minimal, crate-agnostic ownership view for the shared
    // evaluator's `ownership` primitive — see EvaluationContext's own
    // doc comment for why this is deliberately decoupled from any one
    // conservation module's own struct shape.
    let claim_owners: HashMap<String, (String, bool)> = conservation_state
        .claims
        .iter()
        .map(|(id, c)| (id.clone(), (c.owner.clone(), c.status == crate::conservation::ClaimStatus::Active)))
        .collect();

    let pool_id_owned = pool_id.to_string();
    let contributions_owned = cycle.contributions.clone();
    let draw_fn = move |args: &[serde_json::Value]| -> Option<serde_json::Value> {
        let cycle_idx = args.get(1)?.as_i64()?;
        let draw = compute_weighted_draw(&pool_id_owned, cycle_idx, &contributions_owned)?;
        Some(serde_json::json!({ "winnerDomain": draw.winner_domain, "totalAmount": draw.total_amount, "drawHash": draw.draw_hash }))
    };
    let mut registry: FunctionRegistry = HashMap::new();
    registry.insert("computeWeightedDraw", Box::new(draw_fn));

    let condition = Condition::All(vec![
        Condition::Ownership { claim_id: claim_id.to_string(), expected_owner: from.to_string() },
        Condition::DeterministicMatch {
            function: "computeWeightedDraw".to_string(),
            args: vec![serde_json::Value::String(pool_id.to_string()), serde_json::Value::from(cycle_index)],
            output_path: Some("winnerDomain".to_string()),
            expected_output: serde_json::Value::String(to.to_string()),
        },
    ]);

    let ctx = EvaluationContext { claim_owners: Some(&claim_owners), function_registry: Some(&registry), ..Default::default() };
    evaluate_condition(&condition, &ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conservation::identity_derivation;

    /// Real Conservation fixture: `contributor_domain` really transfers
    /// a real claim to the pool first — exactly what a legitimate
    /// contribution requires. Returns the REAL final claim id the pool
    /// now owns (transfer() activates a NEW claim id, `activated:{proof.id}`
    /// — the pre-transfer id is left Consumed, not reusable).
    fn conservation_with_real_contribution(pool_id: &str, contributor_domain: &str, pre_transfer_claim_id: &str, amount: f64) -> (ConservationState, String) {
        let mut state = ConservationState::new();
        state.issue_claim(pre_transfer_claim_id, "AIWA", amount, contributor_domain).unwrap();
        let proof = state.transfer(pre_transfer_claim_id, contributor_domain, &pot_address(pool_id), "0", "identity", identity_derivation).unwrap();
        let real_claim_id = format!("activated:{}", proof.id);
        (state, real_claim_id)
    }

    fn init_event(id: &str, pool_id: &str, cycle_length: i64) -> Event {
        Event { id: id.to_string(), parents: vec![], payload: serde_json::json!({"type": "pool-init", "poolId": pool_id, "cycleLengthContributions": cycle_length, "mintedBy": "alice", "at": 0}) }
    }
    fn contribute_event(id: &str, pool_id: &str, contributor_domain: &str, claim_id: &str) -> Event {
        Event { id: id.to_string(), parents: vec![], payload: serde_json::json!({"type": "pool-contribute", "poolId": pool_id, "contributorDomain": contributor_domain, "claimId": claim_id}) }
    }

    #[test]
    fn pot_address_never_collides_with_a_real_domain_id() {
        assert_eq!(pot_address("my-pool"), "jackpot-pot:my-pool");
        assert_ne!(pot_address("my-pool"), "my-pool");
    }

    #[test]
    fn pool_init_mints_a_real_usable_pool() {
        let mut state = PoolState::new();
        state.apply_event(&init_event("e1", "pool1", 5), &ConservationState::new());
        assert_eq!(state.pools["pool1"].cycle_length_contributions, 5);
    }

    #[test]
    fn the_same_pool_id_cannot_be_reinitialized() {
        let mut state = PoolState::new();
        state.apply_event(&init_event("e1", "pool1", 5), &ConservationState::new());
        state.apply_event(&init_event("e2", "pool1", 999), &ConservationState::new());
        assert_eq!(state.pools["pool1"].cycle_length_contributions, 5);
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn pool_init_rejects_a_non_positive_cycle_length() {
        let mut state = PoolState::new();
        state.apply_event(&init_event("e1", "pool1", 0), &ConservationState::new());
        assert!(state.pools.get("pool1").is_none());
    }

    #[test]
    fn a_real_contribution_is_recorded() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &conservation);
        state.apply_event(&contribute_event("d1", "pool1", "alice", &real_claim_id), &conservation);
        assert_eq!(state.cycles["pool1"][&0].contributions.len(), 1);
        assert_eq!(state.cycles["pool1"][&0].contributions[0].amount, 10.0);
    }

    #[test]
    fn security_a_contribution_referencing_a_claim_never_really_transferred_is_rejected() {
        let mut conservation = ConservationState::new();
        conservation.issue_claim("c1", "AIWA", 10.0, "alice").unwrap();
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &conservation);
        state.apply_event(&contribute_event("d1", "pool1", "alice", "c1"), &conservation);
        assert!(state.cycles.get("pool1").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_the_stale_pre_transfer_claim_id_is_rejected() {
        let (conservation, _real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &conservation);
        state.apply_event(&contribute_event("d1", "pool1", "alice", "c1"), &conservation); // stale, pre-transfer id
        assert!(state.cycles.get("pool1").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_the_recorded_amount_always_matches_the_real_claim() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 7.0);
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &conservation);
        state.apply_event(&contribute_event("d1", "pool1", "alice", &real_claim_id), &conservation);
        assert_eq!(state.cycles["pool1"][&0].contributions[0].amount, 7.0);
    }

    #[test]
    fn security_the_same_real_claim_cannot_back_two_contributions() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &conservation);
        state.apply_event(&contribute_event("d1", "pool1", "alice", &real_claim_id), &conservation);
        state.apply_event(&contribute_event("d2", "pool1", "alice", &real_claim_id), &conservation);
        assert_eq!(state.cycles["pool1"][&0].contributions.len(), 1);
    }

    #[test]
    fn a_contribution_for_an_unknown_pool_is_rejected() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let mut state = PoolState::new();
        state.apply_event(&contribute_event("d1", "nonexistent-pool", "alice", &real_claim_id), &conservation);
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn cycle_assignment_is_computed_from_the_real_fold() {
        let mut conservation = ConservationState::new();
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 2), &ConservationState::new());
        for i in 0..3 {
            let pre_id = format!("c{i}");
            conservation.issue_claim(&pre_id, "AIWA", 5.0, "alice").unwrap();
            let proof = conservation.transfer(&pre_id, "alice", &pot_address("pool1"), "0", "identity", identity_derivation).unwrap();
            let real_claim_id = format!("activated:{}", proof.id);
            state.apply_event(&contribute_event(&format!("d{i}"), "pool1", "alice", &real_claim_id), &conservation);
        }
        assert_eq!(state.cycles["pool1"][&0].contributions.len(), 2, "cycle 0 fills up to its configured length");
        assert_eq!(state.cycles["pool1"][&1].contributions.len(), 1, "the third contribution spills into cycle 1");
    }

    #[test]
    fn materialize_folds_a_real_sequence_correctly() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let init = init_event("i", "pool1", 5);
        let contribute = contribute_event("d1", "pool1", "alice", &real_claim_id);
        let events: Vec<&Event> = vec![&init, &contribute];
        let state = PoolState::materialize(&events, &conservation);
        assert_eq!(state.cycles["pool1"][&0].contributions.len(), 1);
    }

    #[test]
    fn compute_weighted_draw_is_deterministic() {
        let contributions = vec![
            Contribution { contributor_domain: "alice".to_string(), claim_id: "c1".to_string(), amount: 10.0 },
            Contribution { contributor_domain: "bob".to_string(), claim_id: "c2".to_string(), amount: 5.0 },
        ];
        let draw1 = compute_weighted_draw("pool1", 0, &contributions);
        let draw2 = compute_weighted_draw("pool1", 0, &contributions);
        assert_eq!(draw1, draw2);
    }

    #[test]
    fn compute_weighted_draw_weights_by_real_ticket_count() {
        let mut alice_wins = 0;
        let trials = 60;
        for i in 0..trials {
            let contributions = vec![
                Contribution { contributor_domain: "alice".to_string(), claim_id: format!("big-{i}"), amount: 95.0 },
                Contribution { contributor_domain: "bob".to_string(), claim_id: format!("small-{i}"), amount: 5.0 },
            ];
            if let Some(draw) = compute_weighted_draw("pool1", i, &contributions) {
                if draw.winner_domain == "alice" { alice_wins += 1; }
            }
        }
        assert!(alice_wins as f64 > trials as f64 * 0.8, "alice (95% of tickets) should win the large majority of trials, won {alice_wins}/{trials}");
    }

    #[test]
    fn compute_weighted_draw_returns_none_for_empty_contributions() {
        assert_eq!(compute_weighted_draw("pool1", 0, &[]), None);
    }

    #[test]
    fn compute_weighted_draw_returns_none_when_every_contribution_rounds_to_zero_tickets() {
        let contributions = vec![Contribution { contributor_domain: "alice".to_string(), claim_id: "c1".to_string(), amount: 0.4 }];
        assert_eq!(compute_weighted_draw("pool1", 0, &contributions), None);
    }

    #[test]
    fn compute_weighted_draw_total_amount_sums_correctly() {
        let contributions = vec![
            Contribution { contributor_domain: "alice".to_string(), claim_id: "c1".to_string(), amount: 10.0 },
            Contribution { contributor_domain: "bob".to_string(), claim_id: "c2".to_string(), amount: 15.0 },
        ];
        let draw = compute_weighted_draw("pool1", 0, &contributions).unwrap();
        assert_eq!(draw.total_amount, 25.0);
    }

    /// Cross-language parity: this exact value was independently
    /// computed by pool-reducer.js's own computeWeightedDraw() (Node,
    /// real Web Crypto SHA-256) for the identical inputs, and measured
    /// against a real, direct side-by-side run before being pinned
    /// here — winnerDomain, totalAmount, AND the full 64-character
    /// draw_hash all matched exactly, byte for byte, on the first
    /// attempt. If this ever fails, the two languages have diverged on
    /// what should be an identical, pure computation.
    #[test]
    fn cross_language_parity_matches_the_real_js_computed_draw() {
        let contributions = vec![
            Contribution { contributor_domain: "alice".to_string(), claim_id: "c1".to_string(), amount: 10.0 },
            Contribution { contributor_domain: "bob".to_string(), claim_id: "c2".to_string(), amount: 5.0 },
        ];
        let draw = compute_weighted_draw("pool1", 0, &contributions).unwrap();
        assert_eq!(draw.winner_domain, "alice");
        assert_eq!(draw.total_amount, 15.0);
        assert_eq!(draw.draw_hash, "3e6028acafd66b48f025ad34eef018edce2b5d514b5fe4cfb129fcb1c598198f");
    }

    // ── verify_pool_payout: the security-critical function ──────────

    fn setup_closed_cycle(pool_id: &str, cycle_length: i64) -> (PoolState, ConservationState, Vec<String>, String) {
        let mut conservation = ConservationState::new();
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", pool_id, cycle_length), &ConservationState::new());
        let mut claim_ids = Vec::new();
        for i in 0..cycle_length {
            let pre_id = format!("c{i}");
            let contributor = format!("contributor{i}");
            conservation.issue_claim(&pre_id, "AIWA", 10.0 + i as f64, &contributor).unwrap();
            let proof = conservation.transfer(&pre_id, &contributor, &pot_address(pool_id), "0", "identity", identity_derivation).unwrap();
            let real_claim_id = format!("activated:{}", proof.id);
            claim_ids.push(real_claim_id.clone());
            state.apply_event(&contribute_event(&format!("d{i}"), pool_id, &contributor, &real_claim_id), &conservation);
        }
        let draw = compute_weighted_draw(pool_id, 0, &state.cycles[pool_id][&0].contributions).unwrap();
        (state, conservation, claim_ids, draw.winner_domain)
    }

    #[test]
    fn a_legitimate_payout_to_the_real_recomputed_winner_is_accepted() {
        let (pool_state, conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), &winner, &release_proof));
    }

    #[test]
    fn security_a_payout_to_anyone_other_than_the_real_winner_is_rejected() {
        let (pool_state, conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        let impostor = if winner == "contributor0" { "contributor1" } else { "contributor0" };
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), impostor, &release_proof));
    }

    #[test]
    fn security_a_payout_before_the_cycle_has_closed_is_rejected() {
        let (conservation, real_claim_id) = conservation_with_real_contribution("pool1", "alice", "c1", 10.0);
        let mut state = PoolState::new();
        state.apply_event(&init_event("i", "pool1", 5), &ConservationState::new()); // needs 5 contributions
        state.apply_event(&contribute_event("d1", "pool1", "alice", &real_claim_id), &conservation); // only 1 posted
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(!verify_pool_payout(&state, &conservation, &real_claim_id, &pot_address("pool1"), "alice", &release_proof));
    }

    #[test]
    fn security_a_payout_for_a_claim_never_part_of_this_cycle_is_rejected() {
        let (pool_state, mut conservation, _claim_ids, winner) = setup_closed_cycle("pool1", 2);
        conservation.issue_claim("unrelated-claim", "AIWA", 999.0, &pot_address("pool1")).unwrap();
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(!verify_pool_payout(&pool_state, &conservation, "unrelated-claim", &pot_address("pool1"), &winner, &release_proof));
    }

    #[test]
    fn security_a_payout_for_an_already_released_claim_is_rejected() {
        let (pool_state, mut conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        conservation.transfer(&claim_ids[0], &pot_address("pool1"), &winner, "0", "identity", identity_derivation).unwrap();
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), &winner, &release_proof));
    }

    #[test]
    fn security_a_payout_claiming_the_wrong_from_is_rejected() {
        let (pool_state, conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        let release_proof = serde_json::json!({"poolId": "pool1", "cycleIndex": 0});
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], "not-the-real-pool-address", &winner, &release_proof));
    }

    #[test]
    fn security_a_payout_for_an_unknown_pool_is_rejected() {
        let (pool_state, conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        let release_proof = serde_json::json!({"poolId": "nonexistent", "cycleIndex": 0});
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("nonexistent"), &winner, &release_proof));
    }

    #[test]
    fn security_a_malformed_release_proof_is_rejected_without_panicking() {
        let (pool_state, conservation, claim_ids, winner) = setup_closed_cycle("pool1", 2);
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), &winner, &serde_json::Value::Null));
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), &winner, &serde_json::json!({})));
        assert!(!verify_pool_payout(&pool_state, &conservation, &claim_ids[0], &pot_address("pool1"), &winner, &serde_json::json!({"poolId": "pool1", "cycleIndex": "zero"})));
    }
}
