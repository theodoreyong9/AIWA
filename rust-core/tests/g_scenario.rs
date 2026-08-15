//! Regression test pinning the exact materialized values for the shared
//! cross-language fixture (test-vectors/g-scenario.json). Mirror of
//! tests/g-scenario.test.mjs. If this ever fails without an intentional
//! change to the economics reducers, either the reducer logic changed
//! unintentionally or topo_order()'s tie-breaking rule changed.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use aiwa_core::{EventDagCore, GState, RewardParams, Theta};
use serde::Deserialize;

#[derive(Deserialize)]
struct FixtureEntry {
    label: String,
    parents: Vec<String>,
    payload: serde_json::Value,
}

#[test]
fn shared_g_scenario_fixture_materializes_to_the_exact_pinned_values() {
    let fixture_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/g-scenario.json");
    let raw = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", fixture_path.display()));
    let fixture: Vec<FixtureEntry> = serde_json::from_str(&raw).expect("invalid fixture JSON");

    let mut dag = EventDagCore::new();
    let mut id_by_label: HashMap<String, String> = HashMap::new();

    for entry in &fixture {
        let parent_ids: Vec<String> =
            entry.parents.iter().map(|label| id_by_label[label].clone()).collect();
        let id = dag.add_event(parent_ids, entry.payload.clone()).expect("add_event failed");
        id_by_label.insert(entry.label.clone(), id);
    }

    let budgets = [("d1", Some(100.0)), ("d2", None)];
    let theta = Theta { reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 }, budgets: &budgets };

    let ordered = dag.topo_order();
    let state = GState::materialize(&theta, &ordered);

    assert_eq!(state.cadence.domains["d1"].epoch, 3);
    assert_eq!(state.cadence.domains["d2"].epoch, 1);
    assert_eq!(state.cadence.rejections.len(), 1);
    assert_eq!(state.balances["d1"], 40.0);
    assert_eq!(state.balances["d2"], 20.0);
    assert_eq!(state.accrual_rejections.len(), 1);
}
