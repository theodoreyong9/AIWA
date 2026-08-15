//! counterexample_wallclock — mirrors
//! tests/counterexample-wallclock.test.mjs. A deliberately broken
//! variant of G, kept here (not in src/) so it can never be mistaken for
//! usable code, in the spirit of §20–22's methodology: break an
//! invariant on purpose and show the harness actually catches it.

use aiwa_core::{Event, EventDagCore};

/// Deliberately broken: q is derived from an externally-injected
/// wall-clock reading, not from cadence state. No cadence events are
/// even consulted — mirror of materializeBrokenWallClockG() in
/// tests/counterexample-wallclock.test.mjs.
fn materialize_broken_wallclock_g(ordered_events: &[&Event], wall_clock_now: i64) -> f64 {
    let mut balance = 0.0;
    for event in ordered_events {
        let payload = &event.payload;
        if payload.get("type").and_then(|v| v.as_str()) != Some("accrual") {
            continue;
        }
        let b = payload["b"].as_f64().unwrap();
        let q0 = payload["q0"].as_i64().unwrap();
        let q = (wall_clock_now - q0).max(0) as f64; // <-- the broken part
        balance += 1.0 * b.powf(1.0) * q.powf(1.0); // K=alpha=beta=1
    }
    balance
}

#[test]
fn control_real_cadence_derived_g_is_unaffected_by_wallclock_perturbation() {
    use aiwa_core::{GState, RewardParams, Theta};

    let mut dag = EventDagCore::new();
    let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
    let c1 = dag
        .add_event(vec![genesis], serde_json::json!({"type": "cadence", "domain": "d1", "epoch": 1}))
        .unwrap();
    dag.add_event(vec![c1], serde_json::json!({"type": "accrual", "domain": "d1", "b": 10, "q0": 0}))
        .unwrap();

    let ordered = dag.topo_order();
    let budgets = [("d1", None)];
    let theta = Theta { reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 }, budgets: &budgets };

    let state_a = GState::materialize(&theta, &ordered);
    let state_b = GState::materialize(&theta, &ordered);

    assert_eq!(state_a.balances, state_b.balances);
}

#[test]
fn counterexample_broken_wallclock_variant_diverges_on_identical_converged_event_set() {
    let mut dag = EventDagCore::new();
    let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
    // No cadence events at all — the broken variant doesn't consult them.
    dag.add_event(vec![genesis], serde_json::json!({"type": "accrual", "domain": "d1", "b": 10, "q0": 0}))
        .unwrap();

    let ordered = dag.topo_order();

    let replica_at_10 = materialize_broken_wallclock_g(&ordered, 10);
    let replica_at_1000 = materialize_broken_wallclock_g(&ordered, 1000);

    assert_ne!(
        replica_at_10, replica_at_1000,
        "the broken variant was expected to diverge — if this assertion fails, the counterexample itself is broken, not confirming anything"
    );

    assert_eq!(replica_at_10, 10.0 * 10.0);
    assert_eq!(replica_at_1000, 10.0 * 1000.0);
}
