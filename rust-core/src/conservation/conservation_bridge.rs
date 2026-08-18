use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;

use crate::conservation::{identity_derivation, ConservationState};
use crate::event::Event;
use crate::identity::derive_domain_id;

#[derive(Deserialize)]
struct ClaimIssuePayload {
    domain: Option<String>,
    id: Option<String>,
    kind: Option<String>,
    amount: Option<f64>,
}

#[derive(Deserialize)]
struct TransferPayload {
    #[serde(rename = "claimId")]
    claim_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    nonce: Option<String>,
    timestamp: Option<i64>,
    #[serde(rename = "signerPubkey")]
    signer_pubkey: Option<String>,
    signature: Option<String>,
}

#[derive(Deserialize)]
struct PotReleasePayload {
    #[serde(rename = "claimId")]
    claim_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    nonce: Option<String>,
    #[serde(rename = "releaseProof")]
    release_proof: Option<Value>,
}

/// Mirror of the { conservation, usedTransferNonces } shape in
/// conservation-bridge.js.
#[derive(Debug, Clone, Default)]
pub struct ConservationBridgeState {
    pub conservation: ConservationState,
    pub used_transfer_nonces: std::collections::HashMap<String, bool>,
}

/// Injected verifier for 'pot-release' events — mirror of JS's
/// verifyPotRelease parameter. See conservation-bridge.js's own header
/// for why this is safe without a signature: a pool address has no
/// keypair by design, so requiring one would make its contents
/// permanently unspendable rather than protect anything. Omitted
/// (None) entirely, every pot-release is rejected — the same safe
/// default the JS mirror already guarantees.
pub type PotReleaseVerifier<'a> = dyn Fn(&str, &str, &str, &Value, &ConservationState) -> bool + 'a;

fn canonical_transfer_message(claim_id: &str, from: &str, to: &str, nonce: &str, timestamp: i64) -> String {
    format!(
        "{{\"claimId\":{},\"from\":{},\"to\":{},\"nonce\":{},\"timestamp\":{}}}",
        serde_json::to_string(claim_id).unwrap(),
        serde_json::to_string(from).unwrap(),
        serde_json::to_string(to).unwrap(),
        serde_json::to_string(nonce).unwrap(),
        timestamp,
    )
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}

/// Verifies a transfer is really authorized by whoever controls `from`
/// — mirror of verifyTransferAuthorization() in conservation-bridge.js.
/// Closes the exact vulnerability found by reading conservation.js
/// directly: `claim.owner != from` was a plain string comparison, with
/// nothing checking that the writer of the event held the private key
/// behind that domain id.
fn verify_transfer_authorization(claim_id: &str, from: &str, to: &str, nonce: &str, timestamp: i64, signer_pubkey_hex: &str, signature_hex: &str) -> bool {
    let Some(pubkey_bytes) = from_hex(signer_pubkey_hex) else { return false };
    let Some(sig_bytes) = from_hex(signature_hex) else { return false };
    let Ok(pubkey_array): Result<[u8; 32], _> = pubkey_bytes.clone().try_into() else { return false };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pubkey_array) else { return false };
    let Ok(sig_array): Result<[u8; 64], _> = sig_bytes.try_into() else { return false };
    let signature = Signature::from_bytes(&sig_array);

    let message = canonical_transfer_message(claim_id, from, to, nonce, timestamp);
    if verifying_key.verify(message.as_bytes(), &signature).is_err() {
        return false;
    }

    derive_domain_id(&pubkey_bytes) == from
}

/// Mirror of applyConservationEvent() in conservation-bridge.js.
///
/// SECURITY: `g_rejected_event_ids`, when supplied, closes a real
/// vulnerability found by direct inspection while wiring the jackpot/
/// pool module (JS side, Appendix H.29): a 'claim-issue' event never
/// checked whether the issuing domain had real, sufficient balance —
/// g.rs's own reducer correctly rejects an over-issuance, but this
/// function, folding the identical event independently, created the
/// claim anyway, since it never consulted G's verdict. A domain that
/// had accrued nothing could obtain a real, spendable Conservation
/// claim for any amount. This mirror had never received the JS-side
/// fix at all until this revision — closed the same way, by deferring
/// to G's own already-computed rejected-event-id set rather than
/// duplicating its reward-formula-dependent balance logic here.
///
/// `verify_pot_release`: see PotReleaseVerifier's own doc comment.
pub fn apply_conservation_event(
    state: &ConservationBridgeState,
    event: &Event,
    g_rejected_event_ids: Option<&std::collections::HashSet<String>>,
    verify_pot_release: Option<&PotReleaseVerifier>,
) -> ConservationBridgeState {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    let Some(kind) = kind else { return state.clone() };

    if kind == "claim-issue" {
        if g_rejected_event_ids.is_some_and(|ids| ids.contains(&event.id)) {
            return state.clone(); // G rejected this — Conservation must agree, not silently diverge
        }
        let Ok(p) = serde_json::from_value::<ClaimIssuePayload>(event.payload.clone()) else { return state.clone() };
        let (Some(domain), Some(id), Some(amount)) = (p.domain, p.id, p.amount) else { return state.clone() };
        if domain.is_empty() || id.is_empty() || !amount.is_finite() || amount <= 0.0 {
            return state.clone();
        }
        let kind_str = p.kind.unwrap_or_else(|| "AIWA".to_string());
        let mut new_state = state.clone();
        let _ = new_state.conservation.issue_claim(&id, &kind_str, amount, &domain);
        return new_state;
    }

    if kind == "transfer" {
        let Ok(p) = serde_json::from_value::<TransferPayload>(event.payload.clone()) else { return state.clone() };
        let (Some(claim_id), Some(from), Some(to), Some(nonce), Some(signer_pubkey), Some(signature)) =
            (p.claim_id, p.from, p.to, p.nonce, p.signer_pubkey, p.signature)
        else {
            return state.clone(); // structurally incomplete — e.g. an old, unsigned-format event
        };
        if claim_id.is_empty() || from.is_empty() || to.is_empty() || nonce.is_empty() {
            return state.clone();
        }
        if state.used_transfer_nonces.contains_key(&nonce) {
            return state.clone(); // replay
        }
        let timestamp = p.timestamp.unwrap_or(0);
        if !verify_transfer_authorization(&claim_id, &from, &to, &nonce, timestamp, &signer_pubkey, &signature) {
            return state.clone();
        }
        let mut new_state = state.clone();
        if new_state.conservation.transfer(&claim_id, &from, &to, "0", "identity", identity_derivation).is_ok() {
            new_state.used_transfer_nonces.insert(nonce, true);
        } else {
            return state.clone();
        }
        return new_state;
    }

    if kind == "pot-release" {
        let Ok(p) = serde_json::from_value::<PotReleasePayload>(event.payload.clone()) else { return state.clone() };
        let (Some(claim_id), Some(from), Some(to), Some(nonce)) = (p.claim_id, p.from, p.to, p.nonce) else { return state.clone() };
        if claim_id.is_empty() || from.is_empty() || to.is_empty() || nonce.is_empty() {
            return state.clone();
        }
        if state.used_transfer_nonces.contains_key(&nonce) {
            return state.clone(); // replay — the exact same protection ordinary transfers already get
        }
        let Some(verifier) = verify_pot_release else { return state.clone() }; // no verifier wired in — every pot-release rejected, full stop
        let release_proof = p.release_proof.unwrap_or(Value::Null);
        if !verifier(&claim_id, &from, &to, &release_proof, &state.conservation) {
            return state.clone();
        }
        let mut new_state = state.clone();
        if new_state.conservation.transfer(&claim_id, &from, &to, "0", "identity", identity_derivation).is_ok() {
            new_state.used_transfer_nonces.insert(nonce, true);
        } else {
            return state.clone();
        }
        return new_state;
    }

    state.clone()
}

/// registry(H_d) for Conservation — mirror of materializeConservation().
/// `g_rejected_event_ids` and `verify_pot_release` threaded through
/// unchanged — see apply_conservation_event's own doc comment.
pub fn materialize_conservation(
    ordered_events: &[&Event],
    g_rejected_event_ids: Option<&std::collections::HashSet<String>>,
    verify_pot_release: Option<&PotReleaseVerifier>,
) -> ConservationBridgeState {
    let mut state = ConservationBridgeState::default();
    for event in ordered_events {
        state = apply_conservation_event(&state, event, g_rejected_event_ids, verify_pot_release);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::EventDagCore;
    use crate::economics::g::{GState, Theta};
    use crate::economics::reward::RewardParams;
    use ed25519_dalek::{Signer, SigningKey};
    use rand_core::OsRng;

    fn theta<'a>(budgets: &'a [(&'a str, Option<f64>)]) -> Theta<'a> {
        Theta {
            reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 },
            budgets,
        }
    }

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn sign_transfer(signing_key: &SigningKey, claim_id: &str, from: &str, to: &str, nonce: &str, timestamp: i64) -> (String, String) {
        let message = canonical_transfer_message(claim_id, from, to, nonce, timestamp);
        let signature = signing_key.sign(message.as_bytes());
        (to_hex(signing_key.verifying_key().as_bytes()), to_hex(&signature.to_bytes()))
    }

    fn build_domain_with_50(dag: &mut EventDagCore, domain: &str) -> String {
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let mut last = genesis.clone();
        let mut last_cadence: Option<String> = None;
        let mut previous_vdf_output: Option<String> = None;
        for e in 1..=5 {
            let parent = last_cadence.clone().unwrap_or_else(|| genesis.clone());
            let mut parents = vec![parent, last.clone()];
            parents.dedup();
            let seed = crate::economics::cadence_vdf::vdf_seed(domain, previous_vdf_output.as_deref().unwrap_or("genesis"));
            let vdf_output = crate::economics::cadence_vdf::compute_vdf_chain(&seed, 50);
            let id = dag.add_event(parents, serde_json::json!({
                "type": "cadence", "domain": domain, "epoch": e,
                "vdfIterations": 50, "vdfOutput": vdf_output,
            })).unwrap();
            last_cadence = Some(id.clone());
            last = id;
            previous_vdf_output = Some(vdf_output);
        }
        dag.add_event(vec![last], serde_json::json!({"type": "accrual", "domain": domain, "b": 10.0, "q0": 0, "T": 0.0})).unwrap()
    }

    #[test]
    fn claim_issue_debits_g_and_creates_a_claim_in_conservation() {
        let mut dag = EventDagCore::new();
        let last = build_domain_with_50(&mut dag, "alice");
        dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 20.0})).unwrap();

        let events = dag.topo_order();
        let t = theta(&[("alice", None)]);
        let g_state = GState::materialize(&t, &events);
        let con_state = materialize_conservation(&events, None, None);

        assert_eq!(g_state.balances.get("alice"), Some(&30.0));
        assert_eq!(con_state.conservation.claims["c1"].amount, 20.0);
        assert_eq!(con_state.conservation.claims["c1"].owner, "alice");
    }

    #[test]
    fn a_signed_transfer_moves_real_ownership() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let alice_id = derive_domain_id(signing_key.verifying_key().as_bytes());

        let mut dag = EventDagCore::new();
        let mut last = build_domain_with_50(&mut dag, &alice_id);
        last = dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": alice_id, "id": "c1", "amount": 20.0})).unwrap();

        let (pubkey_hex, sig_hex) = sign_transfer(&signing_key, "c1", &alice_id, "bob", "n1", 1000);
        dag.add_event(
            vec![last],
            serde_json::json!({"type": "transfer", "claimId": "c1", "from": alice_id, "to": "bob", "nonce": "n1", "timestamp": 1000, "signerPubkey": pubkey_hex, "signature": sig_hex}),
        )
        .unwrap();

        let events = dag.topo_order();
        let budgets = [(alice_id.as_str(), None)];
        let t = theta(&budgets);
        let g_state = GState::materialize(&t, &events);
        let con_state = materialize_conservation(&events, None, None);

        assert_eq!(g_state.balances.get(&alice_id), Some(&30.0));
        let bob_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "bob" && c.status == crate::conservation::ClaimStatus::Active).collect();
        assert_eq!(bob_claims.len(), 1);
        assert_eq!(bob_claims[0].amount, 20.0);
    }

    #[test]
    fn security_forged_transfer_wrong_signer_for_claimed_from_is_rejected() {
        let alice_key = SigningKey::generate(&mut OsRng);
        let alice_id = derive_domain_id(alice_key.verifying_key().as_bytes());
        let attacker_key = SigningKey::generate(&mut OsRng); // a REAL key, but not alice's

        let mut dag = EventDagCore::new();
        let mut last = build_domain_with_50(&mut dag, &alice_id);
        last = dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": alice_id, "id": "c1", "amount": 20.0})).unwrap();

        // Attacker signs with THEIR key but claims `from: alice_id`.
        let (pubkey_hex, sig_hex) = sign_transfer(&attacker_key, "c1", &alice_id, "attacker-domain", "n1", 1000);
        dag.add_event(
            vec![last],
            serde_json::json!({"type": "transfer", "claimId": "c1", "from": alice_id, "to": "attacker-domain", "nonce": "n1", "timestamp": 1000, "signerPubkey": pubkey_hex, "signature": sig_hex}),
        )
        .unwrap();

        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        assert_eq!(con_state.conservation.claims["c1"].owner, alice_id);
        assert_eq!(con_state.conservation.claims["c1"].status, crate::conservation::ClaimStatus::Active);
        let attacker_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "attacker-domain").collect();
        assert_eq!(attacker_claims.len(), 0);
    }

    #[test]
    fn replayed_transfer_nonce_is_rejected() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let alice_id = derive_domain_id(signing_key.verifying_key().as_bytes());

        let mut dag = EventDagCore::new();
        let mut last = build_domain_with_50(&mut dag, &alice_id);
        last = dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": alice_id, "id": "c1", "amount": 20.0})).unwrap();

        let (pubkey_hex, sig_hex) = sign_transfer(&signing_key, "c1", &alice_id, "bob", "fixed-nonce", 1000);
        let payload = serde_json::json!({"type": "transfer", "claimId": "c1", "from": alice_id, "to": "bob", "nonce": "fixed-nonce", "timestamp": 1000, "signerPubkey": pubkey_hex, "signature": sig_hex});
        last = dag.add_event(vec![last], payload.clone()).unwrap();
        dag.add_event(vec![last], payload).unwrap(); // exact same signed payload replayed

        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        let bob_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "bob" && c.status == crate::conservation::ClaimStatus::Active).collect();
        assert_eq!(bob_claims.len(), 1);
    }

    #[test]
    fn old_unsigned_format_transfer_is_rejected_not_panicked_on() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "transfer", "claimId": "c1", "from": "alice", "to": "bob"})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        assert!(con_state.conservation.claims.is_empty());
    }

    #[test]
    fn malformed_claim_issue_events_are_folded_through_without_panicking() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "", "id": "x", "amount": 10.0})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        assert!(con_state.conservation.claims.is_empty());
    }

    // ── SECURITY: over-issuance, found while wiring the pool module —
    // never mirrored to Rust until this revision (§27.8/H.29's own JS
    // fix is now also closed here) ──────────────────────────────────

    #[test]
    fn security_regression_zero_balance_domain_cannot_create_a_real_claim() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis", "domain": "alice"})).unwrap();
        // alice has never accrued anything, tries to issue a claim of 1000 anyway.
        let bad_event = dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 1000.0})).unwrap();

        let events = dag.topo_order();
        let t = theta(&[]);
        let g_state = GState::materialize(&t, &events);
        assert_eq!(g_state.balances.get("alice"), None);
        assert!(g_state.accrual_rejections.iter().any(|r| r.event_id == bad_event));

        let rejected_ids: std::collections::HashSet<String> = g_state.accrual_rejections.iter().map(|r| r.event_id.clone()).collect();
        let con_state = materialize_conservation(&events, Some(&rejected_ids), None);
        assert!(con_state.conservation.claims.get("c1").is_none(), "Conservation must not create a claim G already rejected");
    }

    #[test]
    fn a_real_funded_claim_issue_is_unaffected_by_the_cross_check() {
        let mut dag = EventDagCore::new();
        let last = build_domain_with_50(&mut dag, "alice");
        dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 20.0})).unwrap();

        let events = dag.topo_order();
        let t = theta(&[("alice", None)]);
        let g_state = GState::materialize(&t, &events);
        let rejected_ids: std::collections::HashSet<String> = g_state.accrual_rejections.iter().map(|r| r.event_id.clone()).collect();
        let con_state = materialize_conservation(&events, Some(&rejected_ids), None);
        assert_eq!(con_state.conservation.claims["c1"].amount, 20.0);
    }

    #[test]
    fn omitting_g_rejected_event_ids_entirely_reproduces_the_exact_prior_behavior() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis", "domain": "alice"})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 1000.0})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        assert_eq!(con_state.conservation.claims["c1"].amount, 1000.0);
    }

    // ── 'pot-release': signature-free but recomputation-verified ────

    #[test]
    fn pot_release_rejected_outright_with_no_verifier_supplied() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let issue_id = dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "jackpot-pot:my-pot", "id": "c1", "amount": 10.0})).unwrap();
        dag.add_event(vec![issue_id], serde_json::json!({"type": "pot-release", "claimId": "c1", "from": "jackpot-pot:my-pot", "to": "alice", "nonce": "n1", "releaseProof": {}})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order(), None, None);
        assert_eq!(con_state.conservation.claims["c1"].owner, "jackpot-pot:my-pot");
    }

    #[test]
    fn pot_release_accepted_when_the_injected_verifier_approves() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let issue_id = dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "jackpot-pot:my-pot", "id": "c1", "amount": 10.0})).unwrap();
        dag.add_event(vec![issue_id], serde_json::json!({"type": "pot-release", "claimId": "c1", "from": "jackpot-pot:my-pot", "to": "alice", "nonce": "n1", "releaseProof": {}})).unwrap();
        let always_approve = |_: &str, _: &str, _: &str, _: &Value, _: &ConservationState| true;
        let con_state = materialize_conservation(&dag.topo_order(), None, Some(&always_approve));
        let alice_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "alice" && c.status == crate::conservation::ClaimStatus::Active).collect();
        assert_eq!(alice_claims.len(), 1);
        assert_eq!(alice_claims[0].amount, 10.0);
    }

    #[test]
    fn pot_release_rejected_when_the_injected_verifier_disapproves() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let issue_id = dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "jackpot-pot:my-pot", "id": "c1", "amount": 10.0})).unwrap();
        dag.add_event(vec![issue_id], serde_json::json!({"type": "pot-release", "claimId": "c1", "from": "jackpot-pot:my-pot", "to": "alice", "nonce": "n1", "releaseProof": {}})).unwrap();
        let always_reject = |_: &str, _: &str, _: &str, _: &Value, _: &ConservationState| false;
        let con_state = materialize_conservation(&dag.topo_order(), None, Some(&always_reject));
        assert_eq!(con_state.conservation.claims["c1"].owner, "jackpot-pot:my-pot");
    }

    #[test]
    fn pot_release_replaying_the_same_nonce_is_rejected() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let issue_id = dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "jackpot-pot:my-pot", "id": "c1", "amount": 10.0})).unwrap();
        let always_approve = |_: &str, _: &str, _: &str, _: &Value, _: &ConservationState| true;
        let r1 = dag.add_event(vec![issue_id], serde_json::json!({"type": "pot-release", "claimId": "c1", "from": "jackpot-pot:my-pot", "to": "alice", "nonce": "fixed-nonce", "releaseProof": {}})).unwrap();
        dag.add_event(vec![r1], serde_json::json!({"type": "pot-release", "claimId": "c1", "from": "jackpot-pot:my-pot", "to": "bob", "nonce": "fixed-nonce", "releaseProof": {}})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order(), None, Some(&always_approve));
        let bob_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "bob").collect();
        assert_eq!(bob_claims.len(), 0, "the replayed nonce must not let a second release through");
    }
}
