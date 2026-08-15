use std::collections::HashMap;

/// A claim's lifecycle state, per §7's Deactivate→Prove→Verify→Consume→
/// Activate pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimStatus {
    Active,
    Deactivated,
    Consumed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Claim {
    pub id: String,
    pub kind: String,
    pub amount: f64,
    pub owner: String,
    pub status: ClaimStatus,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Proof {
    pub id: String,
    pub claim_id: String,
    pub from: String,
    pub to: String,
    pub derivation: String,
    pub kind_out: String,
    pub amount_out: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ConservationState {
    pub claims: HashMap<String, Claim>,
    pub consumed: HashMap<String, bool>,
}

#[derive(Debug, PartialEq)]
pub struct ConservationError(pub String);

impl std::fmt::Display for ConservationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// An authorized derivation function f: (kind, amount) -> Some((kind,
/// amount)) if the conversion is valid for this input, None if rejected
/// (e.g. wrong input kind).
pub type DerivationFn = fn(&str, f64) -> Option<(String, f64)>;

pub fn identity_derivation(kind: &str, amount: f64) -> Option<(String, f64)> {
    Some((kind.to_string(), amount))
}

impl ConservationState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn issue_claim(&mut self, id: &str, kind: &str, amount: f64, owner: &str) -> Result<(), ConservationError> {
        if self.claims.contains_key(id) {
            return Err(ConservationError(format!("Claim id already exists: {id}")));
        }
        self.claims.insert(
            id.to_string(),
            Claim { id: id.to_string(), kind: kind.to_string(), amount, owner: owner.to_string(), status: ClaimStatus::Active },
        );
        Ok(())
    }

    /// Step 1: Deactivate. Precondition: the claim is Active.
    pub fn deactivate(&mut self, claim_id: &str) -> Result<(), ConservationError> {
        let claim = self.claims.get_mut(claim_id).ok_or_else(|| ConservationError(format!("Unknown claim: {claim_id}")))?;
        if claim.status != ClaimStatus::Active {
            return Err(ConservationError(format!(
                "Cannot deactivate claim {claim_id}: status is {:?}, not Active",
                claim.status
            )));
        }
        claim.status = ClaimStatus::Deactivated;
        Ok(())
    }

    /// Step 2: Prove. Pure computation (only `&self`, no mutation).
    /// Precondition: the claim must already be Deactivated.
    pub fn prove_transfer(
        &self,
        claim_id: &str,
        from: &str,
        to: &str,
        n: &str,
        derivation_name: &str,
        derivation: DerivationFn,
    ) -> Result<Proof, ConservationError> {
        let claim = self.claims.get(claim_id).ok_or_else(|| ConservationError(format!("Unknown claim: {claim_id}")))?;
        if claim.status != ClaimStatus::Deactivated {
            return Err(ConservationError(format!(
                "Cannot prove a transfer for claim {claim_id}: status is {:?}, not Deactivated",
                claim.status
            )));
        }
        if claim.owner != from {
            return Err(ConservationError(format!("Claim {claim_id} is not owned by {from}")));
        }
        let (kind_out, amount_out) = derivation(&claim.kind, claim.amount)
            .ok_or_else(|| ConservationError(format!("Derivation '{derivation_name}' rejected input (kind={}, amount={})", claim.kind, claim.amount)))?;

        Ok(Proof {
            id: format!("{claim_id}:{from}:{to}:{n}:{derivation_name}"),
            claim_id: claim_id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            derivation: derivation_name.to_string(),
            kind_out,
            amount_out,
        })
    }

    /// Step 3: Verify. Pure, side-effect-free, safe to call more than once.
    pub fn verify(&self, proof: &Proof, derivation: DerivationFn) -> (bool, Option<String>) {
        let claim = match self.claims.get(&proof.claim_id) {
            Some(c) => c,
            None => return (false, Some(format!("Unknown claim: {}", proof.claim_id))),
        };
        if claim.status != ClaimStatus::Deactivated {
            return (false, Some(format!("Claim {} is not deactivated (status: {:?})", proof.claim_id, claim.status)));
        }
        if claim.owner != proof.from {
            return (false, Some(format!("Claim {} is not owned by {}", proof.claim_id, proof.from)));
        }
        if self.consumed.contains_key(&proof.id) {
            return (false, Some(format!("Proof {} already consumed", proof.id)));
        }
        match derivation(&claim.kind, claim.amount) {
            Some((k, a)) if k == proof.kind_out && a == proof.amount_out => (true, None),
            _ => (false, Some("Proof output does not match what the derivation function produces".to_string())),
        }
    }

    /// Step 4: Consume. THE load-bearing invariant of §7:
    /// count(Consume(p)) <= 1.
    pub fn consume(&mut self, proof: &Proof) -> Result<(), ConservationError> {
        if self.consumed.contains_key(&proof.id) {
            return Err(ConservationError(format!("Replay rejected: proof {} already consumed", proof.id)));
        }
        self.consumed.insert(proof.id.clone(), true);
        Ok(())
    }

    /// Step 5: Activate. Precondition: the proof must already be consumed.
    pub fn activate(&mut self, proof: &Proof) -> Result<(), ConservationError> {
        if !self.consumed.contains_key(&proof.id) {
            return Err(ConservationError(format!("Cannot activate: proof {} has not been consumed yet", proof.id)));
        }
        let dest_claim_id = format!("activated:{}", proof.id);
        if self.claims.contains_key(&dest_claim_id) {
            return Err(ConservationError(format!("Activation already applied for proof {}", proof.id)));
        }
        {
            let source = self
                .claims
                .get_mut(&proof.claim_id)
                .ok_or_else(|| ConservationError(format!("Unknown claim: {}", proof.claim_id)))?;
            source.status = ClaimStatus::Consumed;
        }
        self.claims.insert(
            dest_claim_id.clone(),
            Claim {
                id: dest_claim_id,
                kind: proof.kind_out.clone(),
                amount: proof.amount_out,
                owner: proof.to.clone(),
                status: ClaimStatus::Active,
            },
        );
        Ok(())
    }

    /// Convenience orchestrator running all five steps in order.
    pub fn transfer(
        &mut self,
        claim_id: &str,
        from: &str,
        to: &str,
        n: &str,
        derivation_name: &str,
        derivation: DerivationFn,
    ) -> Result<Proof, ConservationError> {
        self.deactivate(claim_id)?;
        let proof = self.prove_transfer(claim_id, from, to, n, derivation_name, derivation)?;
        let (valid, reason) = self.verify(&proof, derivation);
        if !valid {
            return Err(ConservationError(format!("Verification failed: {}", reason.unwrap_or_default())));
        }
        self.consume(&proof)?;
        self.activate(&proof)?;
        Ok(proof)
    }
}

pub mod conservation_bridge;
pub use conservation_bridge::{apply_conservation_event, materialize_conservation};

#[cfg(test)]
mod tests {
    use super::*;

    fn burn_x_mint_y(kind: &str, amount: f64) -> Option<(String, f64)> {
        if kind == "X" {
            Some(("Y".to_string(), amount * 2.0))
        } else {
            None
        }
    }

    #[test]
    fn plain_transfer_moves_ownership_without_changing_kind_or_amount() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();

        let proof = state.transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();

        assert_eq!(state.claims["c1"].status, ClaimStatus::Consumed);
        let dest = &state.claims[&format!("activated:{}", proof.id)];
        assert_eq!(dest.kind, "X");
        assert_eq!(dest.amount, 10.0);
        assert_eq!(dest.owner, "bob");
        assert_eq!(dest.status, ClaimStatus::Active);
    }

    #[test]
    fn transmutation_burns_x_and_mints_y_via_authorized_derivation() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();

        let proof = state.transfer("c1", "alice", "alice", "n1", "burnXMintY", burn_x_mint_y).unwrap();

        assert_eq!(state.claims["c1"].status, ClaimStatus::Consumed);
        let minted = &state.claims[&format!("activated:{}", proof.id)];
        assert_eq!(minted.kind, "Y");
        assert_eq!(minted.amount, 20.0);
        assert_eq!(minted.owner, "alice");
    }

    #[test]
    fn derivation_rejecting_wrong_input_kind_fails_at_prove_step() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "Z", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();

        let err = state.prove_transfer("c1", "alice", "alice", "n1", "burnXMintY", burn_x_mint_y);
        assert!(err.is_err());
    }

    #[test]
    fn protocol_order_enforced_cannot_prove_before_deactivate() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        let err = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation);
        assert!(err.is_err());
    }

    #[test]
    fn protocol_order_enforced_cannot_activate_before_consume() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();
        let proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();
        let err = state.activate(&proof);
        assert!(err.is_err());
    }

    #[test]
    fn count_consume_p_leq_1_double_consume_is_rejected() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();
        let proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();

        state.consume(&proof).unwrap();
        let err = state.consume(&proof);
        assert!(err.is_err());
    }

    #[test]
    fn verify_can_be_called_more_than_once_safely() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();
        let proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();

        assert!(state.verify(&proof, identity_derivation).0);
        assert!(state.verify(&proof, identity_derivation).0);
    }

    #[test]
    fn verify_rejects_a_forged_proof_output() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();
        let mut proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();
        proof.amount_out = 999.0; // tampered

        let (valid, _) = state.verify(&proof, identity_derivation);
        assert!(!valid);
    }

    #[test]
    fn already_deactivated_claim_cannot_be_deactivated_again() {
        let mut state = ConservationState::new();
        state.issue_claim("c1", "X", 10.0, "alice").unwrap();
        state.deactivate("c1").unwrap();
        assert!(state.deactivate("c1").is_err());
    }
}
