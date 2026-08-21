//! reception_cadence.rs — mirror of reception-cadence.js. See that
//! file's own header for the full rationale: a mandatory, signed,
//! per-tick commitment to what a domain has (or has not) received from
//! other domains, and a monotonicity check across a domain's own
//! successive claims about the same sender.
//!
//! Two real properties, neither present anywhere else in this project:
//! (1) recurring cost — a real signed commitment required at every real
//! cadence tick, turning Sybil-cluster maintenance into an ongoing
//! cost, not a one-time registration burn; (2) reception monotonicity —
//! a domain's own successive claims about how far it has seen another
//! domain's real history must never go backwards, checked by pure
//! recomputation, with no external clock, no position, no propagation-
//! delay bound.
//!
//! Explicitly NOT what this file does: prove two domains are distinct
//! real-world entities (identity-cost's job, already separate), or
//! prevent a genuinely collaborating pair from fabricating a mutually-
//! consistent history together — no relational check with no external
//! anchor can ever rule that out, named honestly here as it is in the
//! JS mirror's own header.

use std::collections::HashMap;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::event::Event;
use crate::identity::derive_domain_id;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReceivedRef {
    #[serde(rename = "sourceDomain")]
    pub source_domain: String,
    #[serde(rename = "eventId")]
    pub event_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReceptionKind {
    Empty,
    Full,
}

#[derive(Debug, Clone)]
pub struct ReceptionCommitment {
    pub domain: String,
    pub epoch: i64,
    pub kind: ReceptionKind,
    pub received_from: Vec<ReceivedRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceptionRejection {
    pub event_id: String,
    pub domain: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default)]
pub struct ReceptionCadenceState {
    pub commitments: HashMap<String, Vec<ReceptionCommitment>>,
    pub max_seen_epoch: HashMap<String, HashMap<String, i64>>,
    pub rejections: Vec<ReceptionRejection>,
}

/// A pure function resolving a claimed (source_domain, event_id) pair
/// to the real epoch that produced it in that domain's own,
/// independently-materialized cadence state, or None if no such event
/// genuinely exists — the actual recompute-don't-trust check.
pub type SourceEpochLookup<'a> = dyn Fn(&str, &str) -> Option<i64> + 'a;

#[derive(Deserialize)]
struct ReceptionCommitPayload {
    domain: Option<String>,
    epoch: Option<i64>,
    kind: Option<String>,
    #[serde(rename = "receivedFrom", default)]
    received_from: Vec<ReceivedRefRaw>,
    signature: Option<String>,
    #[serde(rename = "signerPubkey")]
    signer_pubkey: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct ReceivedRefRaw {
    #[serde(rename = "sourceDomain")]
    source_domain: String,
    #[serde(rename = "eventId")]
    event_id: String,
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}

/// Canonical message — mirrors canonicalReceptionMessage() in
/// reception-cadence.js byte for byte: JSON.stringify of
/// {domain, epoch, kind, receivedFrom: <sorted>}, with receivedFrom
/// sorted by (sourceDomain + eventId) lexicographically.
fn canonical_reception_message(domain: &str, epoch: i64, kind: &str, received_from: &[ReceivedRefRaw]) -> String {
    let mut sorted = received_from.to_vec();
    sorted.sort_by(|a, b| format!("{}{}", a.source_domain, a.event_id).cmp(&format!("{}{}", b.source_domain, b.event_id)));
    let refs_json: Vec<String> = sorted
        .iter()
        .map(|r| format!("{{\"sourceDomain\":{},\"eventId\":{}}}", serde_json::to_string(&r.source_domain).unwrap(), serde_json::to_string(&r.event_id).unwrap()))
        .collect();
    format!(
        "{{\"domain\":{},\"epoch\":{},\"kind\":{},\"receivedFrom\":[{}]}}",
        serde_json::to_string(domain).unwrap(),
        epoch,
        serde_json::to_string(kind).unwrap(),
        refs_json.join(",")
    )
}

fn verify_commitment_signature(domain: &str, epoch: i64, kind: &str, received_from: &[ReceivedRefRaw], signature_hex: &str, signer_pubkey_hex: &str) -> bool {
    let (Some(pubkey_bytes), Some(sig_bytes)) = (from_hex(signer_pubkey_hex), from_hex(signature_hex)) else { return false };
    let Ok(pubkey_array): Result<[u8; 32], _> = pubkey_bytes.clone().try_into() else { return false };
    let Ok(sig_array): Result<[u8; 64], _> = sig_bytes.try_into() else { return false };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pubkey_array) else { return false };
    let signature = Signature::from_bytes(&sig_array);

    let message = canonical_reception_message(domain, epoch, kind, received_from);
    if verifying_key.verify(message.as_bytes(), &signature).is_err() {
        return false;
    }
    derive_domain_id(&pubkey_bytes) == domain
}

impl ReceptionCadenceState {
    pub fn new() -> Self {
        Self::default()
    }

    fn reject(&mut self, event_id: &str, domain: &str, reason: impl Into<String>) {
        self.rejections.push(ReceptionRejection { event_id: event_id.to_string(), domain: domain.to_string(), reason: reason.into() });
    }

    /// Applies one 'reception-commit' event.
    pub fn apply_event(&mut self, event: &Event, source_epoch_lookup: &SourceEpochLookup) {
        let kind_field = event.payload.get("type").and_then(|v| v.as_str());
        if kind_field != Some("reception-commit") {
            return;
        }

        let Ok(p) = serde_json::from_value::<ReceptionCommitPayload>(event.payload.clone()) else { return };
        let domain = p.domain.unwrap_or_default();
        if domain.is_empty() {
            self.reject(&event.id, "", "missing domain");
            return;
        }
        let Some(epoch) = p.epoch.filter(|e| *e >= 1) else {
            self.reject(&event.id, &domain, "epoch must be a positive integer");
            return;
        };
        let Some(kind_str) = p.kind else {
            self.reject(&event.id, &domain, "kind must be 'empty' or 'full'");
            return;
        };
        if kind_str != "empty" && kind_str != "full" {
            self.reject(&event.id, &domain, "kind must be 'empty' or 'full'");
            return;
        }
        if kind_str == "empty" && !p.received_from.is_empty() {
            self.reject(&event.id, &domain, "kind='empty' requires an empty receivedFrom");
            return;
        }
        if kind_str == "full" && p.received_from.is_empty() {
            self.reject(&event.id, &domain, "kind='full' requires a non-empty receivedFrom");
            return;
        }

        let (Some(signature), Some(signer_pubkey)) = (p.signature, p.signer_pubkey) else {
            self.reject(&event.id, &domain, "missing signature or signerPubkey");
            return;
        };
        if !verify_commitment_signature(&domain, epoch, &kind_str, &p.received_from, &signature, &signer_pubkey) {
            self.reject(&event.id, &domain, "invalid or non-matching signature");
            return;
        }

        let mut resolved_epochs: HashMap<String, i64> = HashMap::new();
        for r in &p.received_from {
            match source_epoch_lookup(&r.source_domain, &r.event_id) {
                Some(source_epoch) => {
                    let entry = resolved_epochs.entry(r.source_domain.clone()).or_insert(0);
                    if source_epoch > *entry {
                        *entry = source_epoch;
                    }
                }
                None => {
                    self.reject(&event.id, &domain, format!("claimed reception of '{}' from '{}' does not correspond to any real event there", r.event_id, r.source_domain));
                    return;
                }
            }
        }

        let prior_max = self.max_seen_epoch.get(&domain).cloned().unwrap_or_default();
        for (source_domain, new_max) in &resolved_epochs {
            let previous = prior_max.get(source_domain).copied().unwrap_or(0);
            if *new_max < previous {
                self.reject(&event.id, &domain, format!("reception monotonicity violated: previously claimed to have seen '{source_domain}' up to epoch {previous}, now claims only epoch {new_max}"));
                return;
            }
        }

        let received_from: Vec<ReceivedRef> = p.received_from.iter().map(|r| ReceivedRef { source_domain: r.source_domain.clone(), event_id: r.event_id.clone() }).collect();
        let kind = if kind_str == "empty" { ReceptionKind::Empty } else { ReceptionKind::Full };
        self.commitments.entry(domain.clone()).or_default().push(ReceptionCommitment { domain: domain.clone(), epoch, kind, received_from });

        let entry = self.max_seen_epoch.entry(domain).or_default();
        for (source_domain, new_max) in resolved_epochs {
            let e = entry.entry(source_domain).or_insert(0);
            if new_max > *e {
                *e = new_max;
            }
        }
    }

    /// registry(H_d) for reception commitments — mirror of every other
    /// materialize function in this project.
    pub fn materialize(ordered_events: &[&Event], source_epoch_lookup: &SourceEpochLookup) -> ReceptionCadenceState {
        let mut state = ReceptionCadenceState::new();
        for event in ordered_events {
            state.apply_event(event, source_epoch_lookup);
        }
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn signed_commit_event(id: &str, signing_key: &SigningKey, domain: &str, epoch: i64, kind: &str, received_from: Vec<ReceivedRefRaw>) -> Event {
        let message = canonical_reception_message(domain, epoch, kind, &received_from);
        let signature = signing_key.sign(message.as_bytes());
        let pubkey = signing_key.verifying_key().to_bytes();
        let refs_json: Vec<serde_json::Value> = received_from.iter().map(|r| serde_json::json!({"sourceDomain": r.source_domain, "eventId": r.event_id})).collect();
        Event {
            id: id.to_string(),
            parents: vec![],
            payload: serde_json::json!({
                "type": "reception-commit", "domain": domain, "epoch": epoch, "kind": kind, "receivedFrom": refs_json,
                "signature": to_hex(&signature.to_bytes()), "signerPubkey": to_hex(&pubkey),
            }),
        }
    }

    fn lookup_fn<'a>(map: &'a HashMap<&'a str, HashMap<&'a str, i64>>) -> impl Fn(&str, &str) -> Option<i64> + 'a {
        move |source_domain, event_id| map.get(source_domain)?.get(event_id).copied()
    }

    /// Cross-language parity: this exact message was independently
    /// computed by reception-cadence.js's own canonicalReceptionMessage()
    /// (Node) for the identical inputs, confirmed to match byte for
    /// byte on the first attempt.
    #[test]
    fn cross_language_parity_matches_the_real_js_canonical_message() {
        let refs = vec![
            ReceivedRefRaw { source_domain: "c".to_string(), event_id: "y".to_string() },
            ReceivedRefRaw { source_domain: "c".to_string(), event_id: "x".to_string() },
        ];
        let msg = canonical_reception_message("alice", 5, "full", &refs);
        assert_eq!(msg, r#"{"domain":"alice","epoch":5,"kind":"full","receivedFrom":[{"sourceDomain":"c","eventId":"x"},{"sourceDomain":"c","eventId":"y"}]}"#);
    }

    #[test]
    fn an_empty_commitment_is_accepted() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let event = signed_commit_event("e1", &signing_key, &domain, 1, "empty", vec![]);
        let mut state = ReceptionCadenceState::new();
        let empty_lookup: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        state.apply_event(&event, &lookup_fn(&empty_lookup));
        assert_eq!(state.rejections.len(), 0);
        assert_eq!(state.commitments[&domain].len(), 1);
    }

    #[test]
    fn kind_empty_with_non_empty_received_from_is_rejected() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let refs = vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "x".to_string() }];
        let event = signed_commit_event("e1", &signing_key, &domain, 1, "empty", refs);
        // Force the structural mismatch directly, matching the JS test's own hand-built malformed payload.
        let mut event = event;
        event.payload["kind"] = serde_json::json!("empty");
        let mut state = ReceptionCadenceState::new();
        let empty_lookup: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        state.apply_event(&event, &lookup_fn(&empty_lookup));
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_a_forged_signature_is_rejected() {
        let real_key = SigningKey::from_bytes(&[7u8; 32]);
        let attacker_key = SigningKey::from_bytes(&[9u8; 32]);
        let domain = derive_domain_id(&real_key.verifying_key().to_bytes());
        // Attacker signs with their OWN key but claims the victim's domain id.
        let event = signed_commit_event("e1", &attacker_key, &domain, 1, "empty", vec![]);
        let mut state = ReceptionCadenceState::new();
        let empty_lookup: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        state.apply_event(&event, &lookup_fn(&empty_lookup));
        assert_eq!(state.rejections.len(), 1);
        assert!(state.rejections[0].reason.contains("signature"));
    }

    #[test]
    fn a_full_commitment_referencing_a_real_existing_source_event_is_accepted() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let refs = vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "real1".to_string() }];
        let event = signed_commit_event("e1", &signing_key, &domain, 1, "full", refs);
        let mut c_map = HashMap::new();
        c_map.insert("real1", 5i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        let mut state = ReceptionCadenceState::new();
        state.apply_event(&event, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 0);
    }

    #[test]
    fn security_a_forged_nonexistent_reference_is_rejected() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let refs = vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "never-really-existed".to_string() }];
        let event = signed_commit_event("e1", &signing_key, &domain, 1, "full", refs);
        let mut c_map = HashMap::new();
        c_map.insert("real1", 5i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        let mut state = ReceptionCadenceState::new();
        state.apply_event(&event, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 1);
        assert!(state.rejections[0].reason.contains("does not correspond to any real event"));
    }

    #[test]
    fn security_reception_monotonicity_violation_is_rejected() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let mut c_map = HashMap::new();
        c_map.insert("c-at-50", 50i64);
        c_map.insert("c-at-30", 30i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        let mut state = ReceptionCadenceState::new();

        let e1 = signed_commit_event("e1", &signing_key, &domain, 1, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-50".to_string() }]);
        state.apply_event(&e1, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 0);

        let e2 = signed_commit_event("e2", &signing_key, &domain, 2, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-30".to_string() }]);
        state.apply_event(&e2, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 1);
        assert!(state.rejections[0].reason.contains("monotonicity violated"));
    }

    #[test]
    fn reception_monotonicity_accepts_later_or_equal_state() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let mut c_map = HashMap::new();
        c_map.insert("c-at-30", 30i64);
        c_map.insert("c-at-50", 50i64);
        c_map.insert("c-at-50b", 50i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        let mut state = ReceptionCadenceState::new();

        let e1 = signed_commit_event("e1", &signing_key, &domain, 1, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-30".to_string() }]);
        state.apply_event(&e1, &lookup_fn(&lookup_map));
        let e2 = signed_commit_event("e2", &signing_key, &domain, 2, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-50".to_string() }]);
        state.apply_event(&e2, &lookup_fn(&lookup_map));
        let e3 = signed_commit_event("e3", &signing_key, &domain, 3, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-50b".to_string() }]);
        state.apply_event(&e3, &lookup_fn(&lookup_map));

        assert_eq!(state.rejections.len(), 0);
        assert_eq!(state.max_seen_epoch[&domain]["c"], 50);
    }

    #[test]
    fn monotonicity_tracked_independently_per_source_domain() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let mut c_map = HashMap::new();
        c_map.insert("c-at-50", 50i64);
        let mut d_map = HashMap::new();
        d_map.insert("d-at-5", 5i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        lookup_map.insert("d", d_map);
        let mut state = ReceptionCadenceState::new();

        let e1 = signed_commit_event("e1", &signing_key, &domain, 1, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-at-50".to_string() }]);
        state.apply_event(&e1, &lookup_fn(&lookup_map));
        let e2 = signed_commit_event("e2", &signing_key, &domain, 2, "full", vec![ReceivedRefRaw { source_domain: "d".to_string(), event_id: "d-at-5".to_string() }]);
        state.apply_event(&e2, &lookup_fn(&lookup_map));

        assert_eq!(state.rejections.len(), 0);
    }

    /// End-to-end: the real two-partition, four-domain scenario,
    /// mirroring the JS suite's own end-to-end test.
    #[test]
    fn end_to_end_honest_reception_accepted_dishonest_rewrite_caught() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let domain_a = derive_domain_id(&signing_key.verifying_key().to_bytes());
        let mut c_map = HashMap::new();
        c_map.insert("c-genesis", 1i64);
        c_map.insert("c-epoch-10", 10i64);
        c_map.insert("c-epoch-25", 25i64);
        let mut lookup_map: HashMap<&str, HashMap<&str, i64>> = HashMap::new();
        lookup_map.insert("c", c_map);
        let mut state = ReceptionCadenceState::new();

        let first_contact = signed_commit_event("fc", &signing_key, &domain_a, 1, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-epoch-10".to_string() }]);
        state.apply_event(&first_contact, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 0);

        let later_honest = signed_commit_event("later", &signing_key, &domain_a, 2, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-epoch-25".to_string() }]);
        state.apply_event(&later_honest, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 0);
        assert_eq!(state.max_seen_epoch[&domain_a]["c"], 25);

        let dishonest_rewrite = signed_commit_event("rewrite", &signing_key, &domain_a, 3, "full", vec![ReceivedRefRaw { source_domain: "c".to_string(), event_id: "c-genesis".to_string() }]);
        state.apply_event(&dishonest_rewrite, &lookup_fn(&lookup_map));
        assert_eq!(state.rejections.len(), 1, "A cannot later claim to have seen only an earlier state of C than it already, honestly, claimed to have seen");
    }
}
