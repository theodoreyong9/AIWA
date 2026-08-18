use std::collections::HashMap;

/// The Solana network's well-known incinerator address — a real,
/// documented, unspendable address widely used across the Solana
/// ecosystem for irrecoverable burns. See identity-cost.js's header for
/// the full rationale on why a burn (not a bonded stake) is used here.
pub const SOLANA_INCINERATOR_ADDRESS: &str = "1nc1nerator11111111111111111111111111111111";

#[derive(Debug, Clone, PartialEq)]
pub enum Commitment {
    Processed,
    Confirmed,
    Finalized,
}

/// Mirror of NormalizedBurnTx in identity-cost.js. Produced by a
/// separate, real RPC adapter (not present in this crate — the
/// reference implementation's browser-facing solana-rpc.js is the only
/// place that touches the network; this struct is what it's expected to
/// produce).
///
/// `slot`: §24 churn resistance — the real Solana slot the burn landed
/// at, already present in every burn-verification RPC response
/// (previously read and discarded on the JS side too — see
/// solana-rpc.js's own header for the full account). `None` when
/// unknown, never treated as advantageous — see required_burn_lamports.
#[derive(Debug, Clone)]
pub struct NormalizedBurnTx {
    pub signature: String,
    pub err: Option<String>,
    pub incinerator_balance_delta_lamports: i64,
    pub commitment: Commitment,
    pub slot: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct RegisteredIdentity {
    pub domain: String,
    pub signature: String,
    pub burned_lamports: i64,
    pub registered_at: i64,
    pub slot: Option<i64>,
}

/// §24 churn resistance — deployment-wide, real-slot-indexed identity
/// cost. Mirror of identity-cost.js's own mechanism; see that file's
/// header for the full rationale (why this closes the Sybil re-
/// derivation's Result 2 without touching the reward formula's own
/// domain-local age term, why it needs no live "current time" oracle,
/// and the honest, unresolved late-joiner tradeoff it does not
/// prescribe an answer to). `genesis_slot` is a single fixed deployment
/// constant, agreed once, exactly like alpha/beta/gamma/C/min_q already
/// are.
pub struct ChurnConfig<'a> {
    pub genesis_slot: i64,
    pub cost_curve: &'a dyn Fn(i64) -> i64,
}

/// A deployment-chosen cost curve: real burn lamports required as a
/// function of real slots elapsed since genesis. Linear is the
/// simplest honest choice, not the only one this mechanism requires.
pub fn linear_cost_curve(base_lamports: i64, lamports_per_slot: i64) -> impl Fn(i64) -> i64 {
    move |slots_since_genesis: i64| base_lamports + slots_since_genesis.max(0) * lamports_per_slot
}

/// The minimum burn required for a registration landing at
/// `registration_slot`. Pure, purely local — no network access needed,
/// only the two already-known numbers. Returns 0 for an unknown slot —
/// an absent field is never treated as advantageous, but also never
/// penalized beyond whatever floor the caller separately requires.
pub fn required_burn_lamports(registration_slot: Option<i64>, genesis_slot: i64, cost_curve: &dyn Fn(i64) -> i64) -> i64 {
    match registration_slot {
        None => 0,
        Some(slot) => cost_curve((slot - genesis_slot).max(0)),
    }
}

#[derive(Debug, Clone, Default)]
pub struct IdentityCostState {
    pub registered: HashMap<String, RegisteredIdentity>,
    pub used_signatures: HashMap<String, bool>,
}

#[derive(Debug, PartialEq)]
pub struct VerifyResult {
    pub valid: bool,
    pub reason: Option<String>,
}

/// Pure check against a normalized transaction record — mirror of
/// verifyBurnProof() in identity-cost.js. No fixed minimum by design:
/// min_lamports defaults to 0 via verify_burn_proof_default(); a burn
/// of any positive size is a real cost and counts as c_id. The only
/// hard requirement is that something was actually burned (delta > 0).
pub fn verify_burn_proof(tx: &NormalizedBurnTx, min_lamports: i64) -> VerifyResult {
    if tx.err.is_some() {
        return VerifyResult { valid: false, reason: Some("transaction failed on-chain (err is non-null)".to_string()) };
    }
    if tx.commitment != Commitment::Finalized {
        return VerifyResult {
            valid: false,
            reason: Some(format!("commitment is {:?}, not Finalized — not yet irreversible", tx.commitment)),
        };
    }
    if tx.incinerator_balance_delta_lamports <= 0 {
        return VerifyResult { valid: false, reason: Some("no positive burn detected (incinerator balance did not increase)".to_string()) };
    }
    if tx.incinerator_balance_delta_lamports < min_lamports {
        return VerifyResult {
            valid: false,
            reason: Some(format!(
                "incinerator balance increased by {} lamports, need >= {min_lamports} (deployment-configured floor)",
                tx.incinerator_balance_delta_lamports
            )),
        };
    }
    VerifyResult { valid: true, reason: None }
}

#[derive(Debug, PartialEq)]
pub struct RegisterResult {
    pub accepted: bool,
    pub reason: Option<String>,
}

impl IdentityCostState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mirror of registerIdentityCost() in identity-cost.js. Enforces
    /// the same replay guard: one signature backs exactly one identity.
    /// `churn_config`: §24 — when supplied, the effective floor is
    /// whichever is HIGHER of `min_lamports` and the real, slot-indexed
    /// requirement, so an explicit deployment policy floor and the
    /// churn-resistance curve compose rather than one silently
    /// overriding the other. `None` reproduces the exact prior
    /// behavior — no curve enforced.
    pub fn register_identity_cost(
        &mut self,
        domain: &str,
        tx: &NormalizedBurnTx,
        min_lamports: i64,
        now: i64,
        churn_config: Option<&ChurnConfig>,
    ) -> RegisterResult {
        if self.used_signatures.contains_key(&tx.signature) {
            return RegisterResult {
                accepted: false,
                reason: Some(format!("signature {} already used to back an identity", tx.signature)),
            };
        }
        if self.registered.contains_key(domain) {
            return RegisterResult {
                accepted: false,
                reason: Some(format!("domain '{domain}' already has a registered identity cost")),
            };
        }

        let effective_min_lamports = match churn_config {
            Some(cfg) => min_lamports.max(required_burn_lamports(tx.slot, cfg.genesis_slot, cfg.cost_curve)),
            None => min_lamports,
        };

        let check = verify_burn_proof(tx, effective_min_lamports);
        if !check.valid {
            return RegisterResult { accepted: false, reason: check.reason };
        }

        self.registered.insert(
            domain.to_string(),
            RegisteredIdentity {
                domain: domain.to_string(),
                signature: tx.signature.clone(),
                burned_lamports: tx.incinerator_balance_delta_lamports,
                registered_at: now,
                slot: tx.slot,
            },
        );
        self.used_signatures.insert(tx.signature.clone(), true);
        RegisterResult { accepted: true, reason: None }
    }

    pub fn has_identity_cost(&self, domain: &str) -> bool {
        self.registered.contains_key(domain)
    }
}

pub mod domain_id;
pub mod identity_cost_reducer;
pub use domain_id::{derive_domain_id, short_domain_label};
pub use identity_cost_reducer::{apply_identity_event, materialize_identity};

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_SOL_LAMPORTS: i64 = 1_000_000_000;

    fn valid_tx(signature: &str, delta: i64, commitment: Commitment, err: Option<String>) -> NormalizedBurnTx {
        NormalizedBurnTx { signature: signature.to_string(), err, incinerator_balance_delta_lamports: delta, commitment, slot: None }
    }

    #[test]
    fn valid_finalized_burn_of_at_least_min_lamports_is_accepted() {
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        assert!(verify_burn_proof(&tx, ONE_SOL_LAMPORTS).valid);
    }

    #[test]
    fn tiny_burn_is_accepted_with_zero_floor_no_minimum_by_default() {
        let tx = valid_tx("sig-1", 1, Commitment::Finalized, None);
        assert!(verify_burn_proof(&tx, 0).valid);
    }

    #[test]
    fn zero_lamport_burn_is_rejected_even_with_zero_floor() {
        let tx = valid_tx("sig-1", 0, Commitment::Finalized, None);
        assert!(!verify_burn_proof(&tx, 0).valid);
    }

    #[test]
    fn failed_onchain_transaction_is_rejected() {
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, Some("Custom".to_string()));
        assert!(!verify_burn_proof(&tx, ONE_SOL_LAMPORTS).valid);
    }

    #[test]
    fn non_finalized_commitment_is_rejected() {
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Confirmed, None);
        assert!(!verify_burn_proof(&tx, ONE_SOL_LAMPORTS).valid);
    }

    #[test]
    fn burn_below_minimum_is_rejected() {
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS / 2, Commitment::Finalized, None);
        assert!(!verify_burn_proof(&tx, ONE_SOL_LAMPORTS).valid);
    }

    #[test]
    fn register_accepts_a_valid_burn_and_records_it() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        let result = state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000, None);

        assert!(result.accepted);
        assert!(state.has_identity_cost("earth"));
        assert_eq!(state.registered["earth"].burned_lamports, ONE_SOL_LAMPORTS);
    }

    #[test]
    fn same_signature_cannot_back_two_domains() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000, None);

        let second = state.register_identity_cost("mars", &tx, ONE_SOL_LAMPORTS, 1001, None);
        assert!(!second.accepted);
        assert!(!state.has_identity_cost("mars"));
    }

    #[test]
    fn domain_cannot_register_twice() {
        let mut state = IdentityCostState::new();
        let tx1 = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        state.register_identity_cost("earth", &tx1, ONE_SOL_LAMPORTS, 1000, None);

        let tx2 = valid_tx("sig-2", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        let second = state.register_identity_cost("earth", &tx2, ONE_SOL_LAMPORTS, 1001, None);
        assert!(!second.accepted);
    }

    #[test]
    fn invalid_burn_rejected_at_registration_too() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", 1, Commitment::Finalized, None);
        let result = state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000, None);
        assert!(!result.accepted);
        assert!(!state.has_identity_cost("earth"));
    }

    #[test]
    fn has_identity_cost_false_for_unregistered_domain() {
        let state = IdentityCostState::new();
        assert!(!state.has_identity_cost("mars"));
    }

    // ── Churn resistance: deployment-wide, real-slot-indexed identity
    // cost (§24) — mirror of identity-cost.test.mjs's own suite ──────

    #[test]
    fn linear_cost_curve_is_pure_and_deterministic() {
        let curve = linear_cost_curve(1000, 10);
        assert_eq!(curve(0), 1000);
        assert_eq!(curve(50), 1500);
        assert_eq!(curve(100), 2000);
    }

    #[test]
    fn required_burn_lamports_computes_purely_locally() {
        let curve = linear_cost_curve(1000, 10);
        assert_eq!(required_burn_lamports(Some(1050), 1000, &curve), 1500);
        assert_eq!(required_burn_lamports(Some(1000), 1000, &curve), 1000);
    }

    #[test]
    fn required_burn_lamports_clamps_pre_genesis_slots_rather_than_going_negative() {
        let curve = linear_cost_curve(1000, 10);
        assert_eq!(required_burn_lamports(Some(900), 1000, &curve), 1000);
    }

    #[test]
    fn required_burn_lamports_is_zero_for_an_unknown_slot() {
        let curve = linear_cost_curve(1000, 10);
        assert_eq!(required_burn_lamports(None, 1000, &curve), 0);
    }

    #[test]
    fn register_identity_cost_enforces_the_curve_when_churn_config_is_supplied() {
        let curve = linear_cost_curve(ONE_SOL_LAMPORTS, 1_000_000);
        let churn_config = ChurnConfig { genesis_slot: 1000, cost_curve: &curve };
        let mut state = IdentityCostState::new();
        let mut tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        tx.slot = Some(1500); // 500 slots since genesis needs 1 SOL + 500M lamports; this burn is only 1 SOL
        let result = state.register_identity_cost("earth", &tx, 0, 1000, Some(&churn_config));
        assert!(!result.accepted, "a burn below the real slot-indexed requirement must be rejected");
    }

    #[test]
    fn register_identity_cost_accepts_a_burn_meeting_the_curve() {
        let curve = linear_cost_curve(ONE_SOL_LAMPORTS, 1_000_000);
        let churn_config = ChurnConfig { genesis_slot: 1000, cost_curve: &curve };
        let mut state = IdentityCostState::new();
        let mut tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        tx.slot = Some(1000); // at genesis, base cost only
        let result = state.register_identity_cost("earth", &tx, 0, 1000, Some(&churn_config));
        assert!(result.accepted);
        assert_eq!(state.registered["earth"].slot, Some(1000));
    }

    #[test]
    fn a_churn_attempt_later_in_real_time_costs_objectively_more() {
        let curve = linear_cost_curve(ONE_SOL_LAMPORTS, 1_000_000);
        let genesis_slot = 1000;
        let first_required = required_burn_lamports(Some(1100), genesis_slot, &curve);
        let second_required = required_burn_lamports(Some(50100), genesis_slot, &curve);
        assert!(second_required > first_required, "real elapsed deployment-wide time must make a later registration cost more, regardless of which domain id is used");
    }

    #[test]
    fn omitting_churn_config_entirely_reproduces_the_exact_prior_behavior() {
        let mut state = IdentityCostState::new();
        let mut tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        tx.slot = Some(999_999_999);
        let result = state.register_identity_cost("earth", &tx, 0, 1000, None);
        assert!(result.accepted, "omitting churn_config must reproduce the exact prior behavior — no curve enforced");
    }

    #[test]
    fn registered_state_carries_the_real_slot() {
        let mut state = IdentityCostState::new();
        let mut tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        tx.slot = Some(12345);
        state.register_identity_cost("earth", &tx, 0, 1000, None);
        assert_eq!(state.registered["earth"].slot, Some(12345));
    }

    #[test]
    fn a_tx_with_no_slot_registers_with_none_not_a_panic() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None); // slot defaults to None
        let result = state.register_identity_cost("earth", &tx, 0, 1000, None);
        assert!(result.accepted);
        assert_eq!(state.registered["earth"].slot, None);
    }

    #[test]
    fn explicit_min_lamports_and_churn_config_compose_the_higher_applies() {
        let curve = linear_cost_curve(100, 1); // curve requires very little here
        let churn_config = ChurnConfig { genesis_slot: 1000, cost_curve: &curve };
        let mut state = IdentityCostState::new();
        let mut tx = valid_tx("sig-1", 500, Commitment::Finalized, None);
        tx.slot = Some(1000);
        let result = state.register_identity_cost("earth", &tx, 10_000, 1000, Some(&churn_config));
        assert!(!result.accepted, "the explicit min_lamports floor (10,000) must still apply even though the curve alone would have accepted 500");
    }
}
