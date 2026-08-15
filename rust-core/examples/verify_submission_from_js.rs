//! verify_submission_from_js — reads a SubmissionEvent (as produced by
//! scripts/check-submission-parity-sign-js.mjs) as JSON from stdin,
//! reconstructs it, and calls verify_submission_signature(). Prints
//! PASS/FAIL and exits non-zero on failure, for
//! scripts/verify-submission-parity.sh to check.
//!
//! Run: cargo run --example verify_submission_from_js < event.json

use std::io::{self, Read};

use aiwa_core::{verify_submission_signature, EconomicConfig, SubmissionEvent};
use serde::Deserialize;

#[derive(Deserialize)]
struct RawEvent {
    #[serde(rename = "moduleId")]
    module_id: String,
    #[serde(rename = "codeHash")]
    code_hash: String,
    #[serde(rename = "codeUrl")]
    code_url: String,
    name: String,
    icon: String,
    category: String,
    description: String,
    #[serde(rename = "isIssuing")]
    is_issuing: bool,
    #[serde(rename = "timeSensitive")]
    time_sensitive: Option<bool>,
    #[serde(rename = "economicConfig")]
    economic_config: Option<RawEconomicConfig>,
    nonce: String,
    timestamp: i64,
    #[serde(rename = "signerPubkey")]
    signer_pubkey: String,
    signature: String,
}

#[derive(Deserialize)]
struct RawEconomicConfig {
    alpha: f64,
    #[serde(rename = "identityCostMechanism")]
    identity_cost_mechanism: Option<String>,
    #[serde(rename = "scarcityPolicy")]
    scarcity_policy: String,
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("failed to read stdin");
    let raw: RawEvent = serde_json::from_str(&input).expect("invalid event JSON");

    let event = SubmissionEvent {
        module_id: raw.module_id,
        code_hash: raw.code_hash,
        code_url: raw.code_url,
        name: raw.name,
        icon: raw.icon,
        category: raw.category,
        description: raw.description,
        is_issuing: raw.is_issuing,
        time_sensitive: raw.time_sensitive,
        economic_config: raw.economic_config.map(|c| EconomicConfig {
            alpha: c.alpha,
            identity_cost_mechanism: c.identity_cost_mechanism,
            scarcity_policy: c.scarcity_policy,
        }),
        nonce: raw.nonce,
        timestamp: raw.timestamp,
        signer_pubkey: raw.signer_pubkey,
        signature: raw.signature,
    };

    if verify_submission_signature(&event) {
        println!("PASS: Rust verified a signature and canonical message produced by JS.");
        std::process::exit(0);
    } else {
        eprintln!("FAIL: Rust rejected a signature JS produced — canonical message construction disagrees between languages.");
        std::process::exit(1);
    }
}
