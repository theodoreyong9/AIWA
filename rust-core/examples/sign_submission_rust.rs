//! sign_submission_rust — signs a submission event with a real,
//! randomly-generated Ed25519 keypair, using the SAME fixed field
//! values as check-submission-parity-sign-js.mjs, and prints the
//! signed event as JSON to stdout — the reverse direction of
//! Appendix H.11's cross-language parity check.
//!
//! Run: cargo run --example sign_submission_rust

use aiwa_core::{build_submission_event, SubmissionEvent};
use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use serde::Serialize;

#[derive(Serialize)]
struct OutEvent<'a> {
    #[serde(rename = "moduleId")]
    module_id: &'a str,
    #[serde(rename = "codeHash")]
    code_hash: &'a str,
    #[serde(rename = "codeUrl")]
    code_url: &'a str,
    name: &'a str,
    icon: &'a str,
    category: &'a str,
    description: &'a str,
    #[serde(rename = "isIssuing")]
    is_issuing: bool,
    #[serde(rename = "timeSensitive")]
    time_sensitive: Option<bool>,
    #[serde(rename = "economicConfig")]
    economic_config: Option<()>,
    nonce: &'a str,
    timestamp: i64,
    #[serde(rename = "signerPubkey")]
    signer_pubkey: &'a str,
    signature: &'a str,
}

fn main() {
    let signing_key = SigningKey::generate(&mut OsRng);

    let event: SubmissionEvent = build_submission_event(
        "weather.js",
        "a1b2c3d4e5f6",
        "https://example.com/weather.js",
        "Weather",
        "⬡",
        "Tools",
        "Cross-language parity fixture.",
        false,
        None,
        None,
        &signing_key,
        "parity-fixture-nonce-rust",
        1735689600000,
    );

    let out = OutEvent {
        module_id: &event.module_id,
        code_hash: &event.code_hash,
        code_url: &event.code_url,
        name: &event.name,
        icon: &event.icon,
        category: &event.category,
        description: &event.description,
        is_issuing: event.is_issuing,
        time_sensitive: event.time_sensitive,
        economic_config: None,
        nonce: &event.nonce,
        timestamp: event.timestamp,
        signer_pubkey: &event.signer_pubkey,
        signature: &event.signature,
    };

    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
