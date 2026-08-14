//! Regression test pinning the exact materialized values for the shared
//! cross-language fixture (test-vectors/conservation-scenario.json).
//! Mirror of tests/conservation-scenario.test.mjs.

use std::fs;
use std::path::Path;

use aiwa_core::{identity_derivation, ConservationState, DerivationFn};
use serde::Deserialize;

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

#[test]
fn shared_conservation_scenario_fixture_materializes_to_the_exact_pinned_values() {
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
        state.transfer(&t.claim_id, &t.from, &t.to, &t.n, &t.derivation, derivation).unwrap();
    }

    assert_eq!(state.claims["c1"].status, aiwa_core::ClaimStatus::Consumed);
    assert_eq!(state.claims["c2"].status, aiwa_core::ClaimStatus::Consumed);
    assert_eq!(state.claims["activated:c1:alice:bob:n1:identity"].kind, "X");
    assert_eq!(state.claims["activated:c1:alice:bob:n1:identity"].amount, 10.0);
    assert_eq!(state.claims["activated:c2:bob:alice:n2:burnXMintY"].kind, "Y");
    assert_eq!(state.claims["activated:c2:bob:alice:n2:burnXMintY"].amount, 10.0);
    assert_eq!(state.consumed.len(), 2);
}
