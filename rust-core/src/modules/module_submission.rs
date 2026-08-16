use std::collections::HashMap;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

use crate::modules::module_hash::compute_module_hash;
use crate::modules::module_rank::LastSubmission;
use crate::modules::module_registry::{
    validate_economic_config, EconomicConfig, ModuleRegistryState, NewModule, RegisterOutcome,
};

/// Mirror of SubmissionEvent in module-submission.js.
#[derive(Debug, Clone)]
pub struct SubmissionEvent {
    pub module_id: String,
    pub code_hash: String,
    pub code_url: String,
    pub name: String,
    pub icon: String,
    pub category: String,
    pub description: String,
    pub is_issuing: bool,
    pub time_sensitive: Option<bool>,
    pub economic_config: Option<EconomicConfig>,
    pub nonce: String,
    pub timestamp: i64,
    pub signer_pubkey: String,
    pub signature: String,
}

/// The exact fields that are signed — mirror of
/// canonicalSubmissionMessage() in module-submission.js. Field order
/// and JSON shape must match byte-for-byte with the JS side for a
/// signature produced by one implementation to verify under the other.
fn canonical_submission_message(event: &SubmissionEvent) -> String {
    format!(
        "{{\"moduleId\":{},\"codeHash\":{},\"codeUrl\":{},\"isIssuing\":{},\"timeSensitive\":{},\"nonce\":{},\"timestamp\":{}}}",
        serde_json::to_string(&event.module_id).unwrap(),
        serde_json::to_string(&event.code_hash).unwrap(),
        serde_json::to_string(&event.code_url).unwrap(),
        event.is_issuing,
        match event.time_sensitive {
            Some(b) => b.to_string(),
            None => "null".to_string(),
        },
        serde_json::to_string(&event.nonce).unwrap(),
        event.timestamp,
    )
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
fn from_hex(hex: &str) -> Vec<u8> {
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)).collect()
}

/// Builds and signs a submission event. Mirror of buildSubmissionEvent()
/// in module-submission.js. Any keypair may sign — nothing here
/// requires the signer to have a registered identity cost.
#[allow(clippy::too_many_arguments)]
pub fn build_submission_event(
    module_id: &str,
    code_hash: &str,
    code_url: &str,
    name: &str,
    icon: &str,
    category: &str,
    description: &str,
    is_issuing: bool,
    time_sensitive: Option<bool>,
    economic_config: Option<EconomicConfig>,
    signing_key: &SigningKey,
    nonce: &str,
    timestamp: i64,
) -> SubmissionEvent {
    let mut event = SubmissionEvent {
        module_id: module_id.to_string(),
        code_hash: code_hash.to_string(),
        code_url: code_url.to_string(),
        name: name.to_string(),
        icon: icon.to_string(),
        category: category.to_string(),
        description: description.to_string(),
        is_issuing,
        time_sensitive,
        economic_config,
        nonce: nonce.to_string(),
        timestamp,
        signer_pubkey: String::new(),
        signature: String::new(),
    };
    let message = canonical_submission_message(&event);
    let signature: Signature = signing_key.sign(message.as_bytes());
    event.signer_pubkey = to_hex(signing_key.verifying_key().as_bytes());
    event.signature = to_hex(&signature.to_bytes());
    event
}

/// Pure signature check — mirror of verifySubmissionSignature().
pub fn verify_submission_signature(event: &SubmissionEvent) -> bool {
    let message = canonical_submission_message(event);
    let pubkey_bytes = from_hex(&event.signer_pubkey);
    let sig_bytes = from_hex(&event.signature);

    let Ok(pubkey_array): Result<[u8; 32], _> = pubkey_bytes.try_into() else { return false };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pubkey_array) else { return false };
    let Ok(sig_array): Result<[u8; 64], _> = sig_bytes.try_into() else { return false };
    let signature = Signature::from_bytes(&sig_array);

    verifying_key.verify(message.as_bytes(), &signature).is_ok()
}

#[derive(Debug, Clone, Default)]
pub struct SubmissionState {
    pub used_nonces: HashMap<String, bool>,
    pub last_submission_by_author: HashMap<String, LastSubmission>,
}

#[derive(Debug, PartialEq)]
pub struct ValidationOutcome {
    pub valid: bool,
    pub reason: Option<String>,
}

/// The full pre-registration check — mirror of validateSubmission().
/// All pure: `code` is already-fetched text, no network here.
pub fn validate_submission(submission_state: &SubmissionState, event: &SubmissionEvent, code: &str) -> ValidationOutcome {
    if submission_state.used_nonces.contains_key(&event.nonce) {
        return ValidationOutcome {
            valid: false,
            reason: Some(format!("nonce {} already used — replay rejected", event.nonce)),
        };
    }
    if !verify_submission_signature(event) {
        return ValidationOutcome { valid: false, reason: Some("invalid signature — event does not match signerPubkey".to_string()) };
    }
    let actual_hash = compute_module_hash(code);
    if actual_hash != event.code_hash {
        return ValidationOutcome {
            valid: false,
            reason: Some(format!("content hash mismatch: claimed {}, fetched code hashes to {actual_hash}", event.code_hash)),
        };
    }
    if event.is_issuing {
        let Some(_time_sensitive) = event.time_sensitive else {
            return ValidationOutcome { valid: false, reason: Some("an issuing module must declare time_sensitive".to_string()) };
        };
        let Some(config) = &event.economic_config else {
            return ValidationOutcome { valid: false, reason: Some("an issuing module must declare economic_config".to_string()) };
        };
        let check = validate_economic_config(config);
        if !check.valid {
            return ValidationOutcome { valid: false, reason: check.reason };
        }
    }
    ValidationOutcome { valid: true, reason: None }
}

/// Mirror of recordNonce().
pub fn record_nonce(submission_state: &mut SubmissionState, nonce: &str) {
    submission_state.used_nonces.insert(nonce.to_string(), true);
}

#[derive(Debug, PartialEq)]
pub struct SubmitOutcome {
    pub accepted: bool,
    pub is_update: bool,
    pub reason: Option<String>,
}

/// The full pure pipeline — mirror of submitModule(): validate against
/// the actual fetched code, then register or update, then record the
/// nonce, all or nothing.
/// Result the caller's eligibility closure must return — carries the
/// freshly-computed rank/epochs alongside the verdict, since
/// submit_module() needs both to update last_submission_by_author.
#[derive(Debug, Clone, Copy)]
pub struct SubmissionEligibilityCheck {
    pub eligible: bool,
    pub rank: f64,
    pub epochs_elapsed: f64,
}

/// Mirror of submitModule() in module-submission.js, including the
/// eligibility wiring added in this revision: check_eligibility_fn is
/// injected by the caller (needs identity-cost + cadence state this
/// module has no business importing), and — matching module-rank.js's
/// own documented reasoning — only ever gates a genuinely NEW module
/// id, never an update to one the author already owns.
pub fn submit_module(
    registry_state: &mut ModuleRegistryState,
    submission_state: &mut SubmissionState,
    event: &SubmissionEvent,
    code: &str,
    now: i64,
    check_eligibility_fn: Option<&dyn Fn(&str, Option<&LastSubmission>) -> SubmissionEligibilityCheck>,
) -> SubmitOutcome {
    let check = validate_submission(submission_state, event, code);
    if !check.valid {
        return SubmitOutcome { accepted: false, is_update: false, reason: check.reason };
    }

    let already_registered = registry_state.modules.contains_key(&event.module_id);

    let mut fresh_submission: Option<LastSubmission> = None;
    if !already_registered {
        if let Some(f) = check_eligibility_fn {
            let last = submission_state.last_submission_by_author.get(&event.signer_pubkey);
            let result = f(&event.signer_pubkey, last);
            if !result.eligible {
                return SubmitOutcome {
                    accepted: false,
                    is_update: false,
                    reason: Some("ratio must not decline to register a new module id".to_string()),
                };
            }
            fresh_submission = Some(LastSubmission { rank: result.rank, epochs_elapsed: result.epochs_elapsed });
        }
    }

    let result: RegisterOutcome = if already_registered {
        registry_state.update_module_code(&event.module_id, event.code_hash.clone(), event.code_url.clone())
    } else {
        registry_state.register_module(
            NewModule {
                id: event.module_id.clone(),
                name: event.name.clone(),
                icon: event.icon.clone(),
                category: event.category.clone(),
                description: event.description.clone(),
                code_hash: event.code_hash.clone(),
                code_url: event.code_url.clone(),
                author: event.signer_pubkey.clone(),
                is_issuing: event.is_issuing,
                time_sensitive: event.time_sensitive,
                economic_config: event.economic_config.clone(),
            },
            now,
        )
    };

    if !result.accepted {
        return SubmitOutcome { accepted: false, is_update: false, reason: result.reason };
    }

    record_nonce(submission_state, &event.nonce);
    if let Some(fresh) = fresh_submission {
        submission_state.last_submission_by_author.insert(event.signer_pubkey.clone(), fresh);
    }
    SubmitOutcome { accepted: true, is_update: already_registered, reason: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    fn make_signer() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn base_event(signer: &SigningKey, code_hash: &str, nonce: &str) -> SubmissionEvent {
        build_submission_event(
            "mymodule.js",
            code_hash,
            "https://example.com/mymodule.js",
            "My Module",
            "🔮",
            "Tools",
            "Does a thing.",
            false,
            None,
            None,
            signer,
            nonce,
            1000,
        )
    }

    #[test]
    fn real_signature_verifies() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");
        assert!(verify_submission_signature(&event));
    }

    #[test]
    fn tampered_field_invalidates_signature() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let mut event = base_event(&signer, &hash, "n1");
        event.code_url = "https://evil.example/swapped.js".to_string();
        assert!(!verify_submission_signature(&event));
    }

    #[test]
    fn validate_rejects_hash_mismatch() {
        let signer = make_signer();
        let claimed_code = "const x = 1;";
        let hash = compute_module_hash(claimed_code);
        let event = base_event(&signer, &hash, "n1");

        let actually_fetched = "const x = 1; exfiltrate();";
        let check = validate_submission(&SubmissionState::default(), &event, actually_fetched);
        assert!(!check.valid);
    }

    #[test]
    fn validate_accepts_matching_signed_submission() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");
        let check = validate_submission(&SubmissionState::default(), &event, code);
        assert!(check.valid);
    }

    #[test]
    fn validate_rejects_replayed_nonce() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "fixed-nonce");

        let mut state = SubmissionState::default();
        record_nonce(&mut state, "fixed-nonce");

        let check = validate_submission(&state, &event, code);
        assert!(!check.valid);
    }

    #[test]
    fn forged_signature_wrong_signer_is_rejected() {
        let attacker = make_signer();
        let victim = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);

        let mut event = base_event(&attacker, &hash, "n1");
        event.signer_pubkey = to_hex(victim.verifying_key().as_bytes());
        assert!(!verify_submission_signature(&event));
    }

    #[test]
    fn submit_module_end_to_end_registers_new_module() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, None);

        assert!(outcome.accepted);
        assert!(!outcome.is_update);
        assert_eq!(registry.modules["mymodule.js"].code_hash, hash);
        assert!(submissions.used_nonces.contains_key("n1"));
    }

    #[test]
    fn submit_module_second_submission_updates_and_resets_audit() {
        use crate::modules::module_registry::AuditStatus;

        let signer = make_signer();
        let code_v1 = "const x = 1;";
        let hash_v1 = compute_module_hash(code_v1);
        let event1 = base_event(&signer, &hash_v1, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        submit_module(&mut registry, &mut submissions, &event1, code_v1, 1000, None);
        registry.set_audit_status("mymodule.js", AuditStatus::Passed);

        let code_v2 = "const x = 2;";
        let hash_v2 = compute_module_hash(code_v2);
        let event2 = base_event(&signer, &hash_v2, "n2");
        let outcome2 = submit_module(&mut registry, &mut submissions, &event2, code_v2, 1001, None);

        assert!(outcome2.accepted);
        assert!(outcome2.is_update);
        assert_eq!(registry.modules["mymodule.js"].code_hash, hash_v2);
        assert_eq!(registry.modules["mymodule.js"].audit_status, AuditStatus::Unaudited);
    }

    fn event_with_id(signer: &SigningKey, module_id: &str, code_hash: &str, nonce: &str) -> SubmissionEvent {
        build_submission_event(
            module_id, code_hash, &format!("https://example.com/{module_id}"), module_id, "🔮", "Tools", "Does a thing.",
            false, None, None, signer, nonce, 1000,
        )
    }

    fn eligibility_fn(rank: f64, epochs_elapsed: f64) -> impl Fn(&str, Option<&LastSubmission>) -> SubmissionEligibilityCheck {
        move |_author, last| {
            let check = crate::modules::module_rank::check_submission_eligibility(rank, epochs_elapsed, last.copied());
            SubmissionEligibilityCheck { eligible: check.eligible, rank, epochs_elapsed }
        }
    }

    #[test]
    fn first_submission_always_eligible_and_records_rank() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = event_with_id(&signer, "first.js", &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let f = eligibility_fn(100.0, 5.0);
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, Some(&f));

        assert!(outcome.accepted);
        let stored = submissions.last_submission_by_author.get(&event.signer_pubkey).unwrap();
        assert_eq!(stored.rank, 100.0);
        assert_eq!(stored.epochs_elapsed, 5.0);
    }

    #[test]
    fn second_new_module_id_with_declining_ratio_is_rejected() {
        let signer = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let code1 = "const a = 1;";
        let hash1 = compute_module_hash(code1);
        let event1 = event_with_id(&signer, "first.js", &hash1, "n1");
        let f1 = eligibility_fn(1000.0, 10.0);
        let outcome1 = submit_module(&mut registry, &mut submissions, &event1, code1, 1000, Some(&f1));
        assert!(outcome1.accepted);

        let code2 = "const b = 2;";
        let hash2 = compute_module_hash(code2);
        let event2 = event_with_id(&signer, "second.js", &hash2, "n2");
        let f2 = eligibility_fn(1.0, 10.0); // cratered ratio
        let outcome2 = submit_module(&mut registry, &mut submissions, &event2, code2, 1001, Some(&f2));

        assert!(!outcome2.accepted);
        assert!(!registry.modules.contains_key("second.js"));
    }

    #[test]
    fn eligibility_does_not_gate_an_update() {
        let signer = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let code_v1 = "const v = 1;";
        let hash_v1 = compute_module_hash(code_v1);
        let event_v1 = event_with_id(&signer, "mine.js", &hash_v1, "n1");
        let f1 = eligibility_fn(1000.0, 10.0);
        submit_module(&mut registry, &mut submissions, &event_v1, code_v1, 1000, Some(&f1));

        let code_v2 = "const v = 2;";
        let hash_v2 = compute_module_hash(code_v2);
        let event_v2 = event_with_id(&signer, "mine.js", &hash_v2, "n2");
        let f2 = eligibility_fn(0.0, 10.0);
        let outcome2 = submit_module(&mut registry, &mut submissions, &event_v2, code_v2, 1001, Some(&f2));

        assert!(outcome2.accepted);
        assert!(outcome2.is_update);
    }

    #[test]
    fn none_eligibility_fn_skips_the_check_backward_compatible() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = event_with_id(&signer, "any.js", &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, None);

        assert!(outcome.accepted);
    }

    #[test]
    fn record_nonce_preserves_last_submission_by_author_for_other_authors() {
        let alice = make_signer();
        let bob = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let alice_code = "const a = 1;";
        let alice_hash = compute_module_hash(alice_code);
        let alice_event = event_with_id(&alice, "alice-mod.js", &alice_hash, "n1");
        let fa = eligibility_fn(500.0, 20.0);
        submit_module(&mut registry, &mut submissions, &alice_event, alice_code, 1000, Some(&fa));
        assert!(submissions.last_submission_by_author.contains_key(&alice_event.signer_pubkey));

        let bob_code = "const b = 2;";
        let bob_hash = compute_module_hash(bob_code);
        let bob_event = event_with_id(&bob, "bob-mod.js", &bob_hash, "n2");
        let fb = eligibility_fn(10.0, 5.0);
        submit_module(&mut registry, &mut submissions, &bob_event, bob_code, 1001, Some(&fb));

        assert!(submissions.last_submission_by_author.contains_key(&alice_event.signer_pubkey));
        assert!(submissions.last_submission_by_author.contains_key(&bob_event.signer_pubkey));
    }
}
