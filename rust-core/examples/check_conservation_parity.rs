//! check_conservation_parity — mirrors
//! scripts/check-conservation-parity.mjs. Runs the shared scenario in
//! ../../test-vectors/conservation-scenario.json through the Rust
//! conservation module and prints a canonical JSON summary, for
//! scripts/verify-conservation-parity.sh to diff.
//!
//! Run: cargo run --example check_conservation_parity

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use aiwa_core::{identity_derivation, ClaimStatus, ConservationState, DerivationFn};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct ClaimEntry {
    id: String,
    kind: String,
    amount: f64,
    owner: String,
}

#[derive(Deserialize)]
struct TransferEntry {
    #[serde(rename = "claimId")]
    claim_id: String,
    from: String,
    to: String,
    n: String,
    derivation: String,
}

#[derive(Deserialize)]
struct Fixture {
    claims: Vec<ClaimEntry>,
    transfers: Vec<TransferEntry>,
}

#[derive(Serialize)]
struct ClaimSummary {
    kind: String,
    amount: f64,
    owner: String,
    status: String,
}

#[derive(Serialize)]
struct Summary {
    claims: BTreeMap<String, ClaimSummary>,
    #[serde(rename = "consumedCount")]
    consumed_count: usize,
}

fn burn_x_mint_y(kind: &str, amount: f64) -> Option<(String, f64)> {
    if kind == "X" {
        Some(("Y".to_string(), amount * 2.0))
    } else {
        None
    }
}

fn derivation_by_name(name: &str) -> DerivationFn {
    match name {
        "identity" => identity_derivation,
        "burnXMintY" => burn_x_mint_y,
        other => panic!("unknown derivation in fixture: {other}"),
    }
}

fn status_str(s: ClaimStatus) -> &'static str {
    match s {
        ClaimStatus::Active => "active",
        ClaimStatus::Deactivated => "deactivated",
        ClaimStatus::Consumed => "consumed",
    }
}

fn main() {
    let fixture_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/conservation-scenario.json");
    let raw = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", fixture_path.display()));
    let fixture: Fixture = serde_json::from_str(&raw).expect("invalid fixture JSON");

    let mut state = ConservationState::new();
    for c in &fixture.claims {
        state.issue_claim(&c.id, &c.kind, c.amount, &c.owner).unwrap();
    }
    for t in &fixture.transfers {
        let derivation = derivation_by_name(&t.derivation);
        state
            .transfer(&t.claim_id, &t.from, &t.to, &t.n, &t.derivation, derivation)
            .unwrap();
    }

    let claims: BTreeMap<String, ClaimSummary> = state
        .claims
        .iter()
        .map(|(id, c)| {
            (
                id.clone(),
                ClaimSummary { kind: c.kind.clone(), amount: c.amount, owner: c.owner.clone(), status: status_str(c.status).to_string() },
            )
        })
        .collect();

    let summary = Summary { claims, consumed_count: state.consumed.len() };
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
}
