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
