//! check_pool_parity — computes the real, deterministic weighted draw
//! over ../../test-vectors/pool-scenario.json, and prints a canonical
//! JSON summary to stdout, in the exact same shape as
//! scripts/check-pool-parity.mjs's output, for
//! scripts/verify-pool-parity.sh to diff.
//!
//! Run: cargo run --example check_pool_parity

use std::fs;
use std::path::Path;

use aiwa_core::{compute_weighted_draw, Contribution};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct FixtureContribution {
    #[serde(rename = "contributorDomain")]
    contributor_domain: String,
    #[serde(rename = "claimId")]
    claim_id: String,
    amount: f64,
}

#[derive(Deserialize)]
struct Fixture {
    #[serde(rename = "poolId")]
    pool_id: String,
    #[serde(rename = "cycleIndex")]
    cycle_index: i64,
    contributions: Vec<FixtureContribution>,
}

#[derive(Serialize)]
struct Summary {
    #[serde(rename = "winnerDomain")]
    winner_domain: String,
    #[serde(rename = "totalAmount")]
    total_amount: f64,
    #[serde(rename = "drawHash")]
    draw_hash: String,
}

fn main() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/pool-scenario.json");
    let fixture_text = fs::read_to_string(&fixture_path).expect("failed to read test-vectors/pool-scenario.json");
    let fixture: Fixture = serde_json::from_str(&fixture_text).expect("failed to parse pool-scenario.json");

    let contributions: Vec<Contribution> = fixture
        .contributions
        .iter()
        .map(|c| Contribution { contributor_domain: c.contributor_domain.clone(), claim_id: c.claim_id.clone(), amount: c.amount })
        .collect();

    let draw = compute_weighted_draw(&fixture.pool_id, fixture.cycle_index, &contributions).expect("real, non-empty contributions must produce a real draw");

    let summary = Summary { winner_domain: draw.winner_domain, total_amount: draw.total_amount, draw_hash: draw.draw_hash };
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
}
