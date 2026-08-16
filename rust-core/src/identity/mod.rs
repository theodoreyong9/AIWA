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
#[derive(Debug, Clone)]
pub struct NormalizedBurnTx {
    pub signature: String,
    pub err: Option<String>,
    pub incinerator_balance_delta_lamports: i64,
    pub commitment: Commitment,
}

#[derive(Debug, Clone)]
pub struct RegisteredIdentity {
    pub domain: String,
    pub signature: String,
    pub burned_lamports: i64,
    pub registered_at: i64,
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
    pub fn register_identity_cost(
        &mut self,
        domain: &str,
        tx: &NormalizedBurnTx,
        min_lamports: i64,
        now: i64,
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

        let check = verify_burn_proof(tx, min_lamports);
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
        NormalizedBurnTx { signature: signature.to_string(), err, incinerator_balance_delta_lamports: delta, commitment }
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
        let result = state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000);

        assert!(result.accepted);
        assert!(state.has_identity_cost("earth"));
        assert_eq!(state.registered["earth"].burned_lamports, ONE_SOL_LAMPORTS);
    }

    #[test]
    fn same_signature_cannot_back_two_domains() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000);

        let second = state.register_identity_cost("mars", &tx, ONE_SOL_LAMPORTS, 1001);
        assert!(!second.accepted);
        assert!(!state.has_identity_cost("mars"));
    }

    #[test]
    fn domain_cannot_register_twice() {
        let mut state = IdentityCostState::new();
        let tx1 = valid_tx("sig-1", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        state.register_identity_cost("earth", &tx1, ONE_SOL_LAMPORTS, 1000);

        let tx2 = valid_tx("sig-2", ONE_SOL_LAMPORTS, Commitment::Finalized, None);
        let second = state.register_identity_cost("earth", &tx2, ONE_SOL_LAMPORTS, 1001);
        assert!(!second.accepted);
    }

    #[test]
    fn invalid_burn_rejected_at_registration_too() {
        let mut state = IdentityCostState::new();
        let tx = valid_tx("sig-1", 1, Commitment::Finalized, None);
        let result = state.register_identity_cost("earth", &tx, ONE_SOL_LAMPORTS, 1000);
        assert!(!result.accepted);
        assert!(!state.has_identity_cost("earth"));
    }

    #[test]
    fn has_identity_cost_false_for_unregistered_domain() {
        let state = IdentityCostState::new();
        assert!(!state.has_identity_cost("mars"));
    }
}
