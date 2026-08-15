//! check_g_parity — builds the real EventDagCore from
//! ../../test-vectors/g-scenario.json, materializes the full composed
//! GState, and prints a canonical JSON summary to stdout, in the exact
//! same shape as scripts/check-g-parity.mjs's output, for
//! scripts/verify-g-parity.sh to diff.
//!
//! Run: cargo run --example check_g_parity

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use aiwa_core::{EventDagCore, GState, RewardParams, Theta};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct FixtureEntry {
    label: String,
    parents: Vec<String>,
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct Summary {
    #[serde(rename = "cadenceDomains")]
    cadence_domains: BTreeMap<String, u64>,
    #[serde(rename = "cadenceRejectionCount")]
    cadence_rejection_count: usize,
    #[serde(rename = "scarcityDomains")]
    scarcity_domains: BTreeMap<String, f64>,
    balances: BTreeMap<String, f64>,
    #[serde(rename = "accrualRejectionCount")]
    accrual_rejection_count: usize,
}

fn main() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/g-scenario.json");
    let raw = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", fixture_path.display()));
    let fixture: Vec<FixtureEntry> = serde_json::from_str(&raw).expect("invalid fixture JSON");

    let mut dag = EventDagCore::new();
    let mut id_by_label: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for entry in &fixture {
        let parent_ids: Vec<String> = entry
            .parents
            .iter()
            .map(|label| id_by_label[label].clone())
            .collect();
        let id = dag.add_event(parent_ids, entry.payload.clone()).expect("add_event failed");
        id_by_label.insert(entry.label.clone(), id);
    }

    let budgets = [("d1", Some(100.0)), ("d2", None)];
    let theta = Theta { reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 }, budgets: &budgets };

    let ordered = dag.topo_order();
    let state = GState::materialize(&theta, &ordered);

    let summary = Summary {
        cadence_domains: state.cadence.domains.iter().map(|(d, s)| (d.clone(), s.epoch)).collect(),
        cadence_rejection_count: state.cadence.rejections.len(),
        scarcity_domains: state.scarcity.domains.iter().map(|(d, s)| (d.clone(), s.used)).collect(),
        balances: state.balances.into_iter().collect(),
        accrual_rejection_count: state.accrual_rejections.len(),
    };

    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
}
