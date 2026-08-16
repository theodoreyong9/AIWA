use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;

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

/// Mirror of the { conservation, usedTransferNonces } shape in
/// conservation-bridge.js.
#[derive(Debug, Clone, Default)]
pub struct ConservationBridgeState {
    pub conservation: ConservationState,
    pub used_transfer_nonces: std::collections::HashMap<String, bool>,
}

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
pub fn apply_conservation_event(state: &ConservationBridgeState, event: &Event) -> ConservationBridgeState {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    let Some(kind) = kind else { return state.clone() };

    if kind == "claim-issue" {
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

    state.clone()
}

/// registry(H_d) for Conservation — mirror of materializeConservation().
pub fn materialize_conservation(ordered_events: &[&Event]) -> ConservationBridgeState {
    let mut state = ConservationBridgeState::default();
    for event in ordered_events {
        state = apply_conservation_event(&state, event);
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
        for e in 1..=5 {
            let parent = last_cadence.clone().unwrap_or_else(|| genesis.clone());
            let mut parents = vec![parent, last.clone()];
            parents.dedup();
            let id = dag.add_event(parents, serde_json::json!({"type": "cadence", "domain": domain, "epoch": e})).unwrap();
            last_cadence = Some(id.clone());
            last = id;
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
        let con_state = materialize_conservation(&events);

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
        let con_state = materialize_conservation(&events);

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

        let con_state = materialize_conservation(&dag.topo_order());
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

        let con_state = materialize_conservation(&dag.topo_order());
        let bob_claims: Vec<_> = con_state.conservation.claims.values().filter(|c| c.owner == "bob" && c.status == crate::conservation::ClaimStatus::Active).collect();
        assert_eq!(bob_claims.len(), 1);
    }

    #[test]
    fn old_unsigned_format_transfer_is_rejected_not_panicked_on() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "transfer", "claimId": "c1", "from": "alice", "to": "bob"})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order());
        assert!(con_state.conservation.claims.is_empty());
    }

    #[test]
    fn malformed_claim_issue_events_are_folded_through_without_panicking() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "claim-issue", "domain": "", "id": "x", "amount": 10.0})).unwrap();
        let con_state = materialize_conservation(&dag.topo_order());
        assert!(con_state.conservation.claims.is_empty());
    }
}
