//! counterexample_nonatomic_consume — mirrors
//! tests/counterexample-nonatomic-consume.test.mjs. A deliberately
//! broken variant of consume(), kept here (not in src/) so it can never
//! be mistaken for usable code.

use aiwa_core::{identity_derivation, ConservationState};
use std::collections::HashMap;

/// Deliberately broken: splits the real, atomic check-then-insert into
/// two separate steps — mirrors brokenCheck/brokenCommit in the JS
/// counterexample.
fn broken_check(consumed: &HashMap<String, bool>, proof_id: &str) -> bool {
    consumed.contains_key(proof_id)
}
fn broken_commit(consumed: &mut HashMap<String, bool>, proof_id: &str) {
    consumed.insert(proof_id.to_string(), true);
}

#[test]
fn control_real_atomic_consume_rejects_a_second_attempt() {
    let mut state = ConservationState::new();
    state.issue_claim("c1", "X", 10.0, "alice").unwrap();
    state.deactivate("c1").unwrap();
    let proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();
    assert!(state.verify(&proof, identity_derivation).0);

    state.consume(&proof).unwrap();
    state.activate(&proof).unwrap();
    let dest_id = format!("activated:{}", proof.id);
    assert_eq!(state.claims[&dest_id].amount, 10.0);

    // A retried consume on the same (now-updated) state is correctly rejected.
    assert!(state.consume(&proof).is_err());

    let activated_count = state.claims.keys().filter(|id| id.starts_with("activated:")).count();
    assert_eq!(activated_count, 1);
}

#[test]
fn counterexample_nonatomic_check_then_commit_allows_double_activation() {
    let mut state = ConservationState::new();
    state.issue_claim("c1", "X", 10.0, "alice").unwrap();
    state.deactivate("c1").unwrap();
    let proof = state.prove_transfer("c1", "alice", "bob", "n1", "identity", identity_derivation).unwrap();
    assert!(state.verify(&proof, identity_derivation).0);

    // Two independent branches ("replicas"/callers) starting from the
    // same snapshot of `consumed`, both checking before either commits.
    let mut consumed_branch_1 = state.consumed.clone();
    let mut consumed_branch_2 = state.consumed.clone();

    assert!(!broken_check(&consumed_branch_1, &proof.id));
    assert!(!broken_check(&consumed_branch_2, &proof.id), "both branches pass the check — the crash window §7 describes");

    broken_commit(&mut consumed_branch_1, &proof.id);
    broken_commit(&mut consumed_branch_2, &proof.id);

    let mut state_branch_1 = state.clone();
    state_branch_1.consumed = consumed_branch_1;
    state_branch_1.activate(&proof).unwrap();

    let mut state_branch_2 = state.clone();
    state_branch_2.consumed = consumed_branch_2;
    state_branch_2.activate(&proof).unwrap();

    let dest_id = format!("activated:{}", proof.id);
    assert_eq!(state_branch_1.claims[&dest_id].amount, 10.0);
    assert_eq!(state_branch_2.claims[&dest_id].amount, 10.0);
    // Total value now claimed across both branches: 20, from a single
    // proof authorizing 10 — exactly what count(Consume(p)) <= 1 exists
    // to prevent.
}
