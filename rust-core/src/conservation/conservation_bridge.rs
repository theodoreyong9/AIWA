use serde::Deserialize;

use crate::conservation::{identity_derivation, ConservationState};
use crate::event::Event;

#[derive(Deserialize)]
struct ClaimIssuePayload {
    domain: Option<String>,
    id: Option<String>,
    kind: Option<String>,
    amount: Option<f64>,
}

#[derive(Deserialize)]
struct TransferPayload {
    #[serde(rename = "claimId")]
    claim_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

/// Mirror of applyConservationEvent() in conservation-bridge.js — folds
/// 'claim-issue' and 'transfer' DAG events into ConservationState,
/// closing the "how do I send AIWA to someone" gap by finally folding
/// the real, tested Deactivate→Prove→Verify→Consume→Activate pipeline
/// (§6.1/§7) over H_d the way every other reducer in this project
/// already is.
pub fn apply_conservation_event(state: &mut ConservationState, event: &Event) {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    let Some(kind) = kind else { return };

    if kind == "claim-issue" {
        let Ok(p) = serde_json::from_value::<ClaimIssuePayload>(event.payload.clone()) else { return };
        let (Some(domain), Some(id), Some(amount)) = (p.domain, p.id, p.amount) else { return };
        if domain.is_empty() || id.is_empty() || !amount.is_finite() || amount <= 0.0 {
            return;
        }
        let kind_str = p.kind.unwrap_or_else(|| "AIWA".to_string());
        let _ = state.issue_claim(&id, &kind_str, amount, &domain); // duplicate id -> Err, tolerated, same fold discipline as elsewhere
        return;
    }

    if kind == "transfer" {
        let Ok(p) = serde_json::from_value::<TransferPayload>(event.payload.clone()) else { return };
        let (Some(claim_id), Some(from), Some(to)) = (p.claim_id, p.from, p.to) else { return };
        if claim_id.is_empty() || from.is_empty() || to.is_empty() {
            return;
        }
        let _ = state.transfer(&claim_id, &from, &to, "0", "identity", identity_derivation);
        return;
    }
}

/// registry(H_d) for Conservation — mirror of materializeConservation().
pub fn materialize_conservation(ordered_events: &[&Event]) -> ConservationState {
    let mut state = ConservationState::new();
    for event in ordered_events {
        apply_conservation_event(&mut state, event);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::EventDagCore;
    use crate::economics::g::{GState, Theta};
    use crate::economics::reward::RewardParams;

    fn theta<'a>(budgets: &'a [(&'a str, Option<f64>)]) -> Theta<'a> {
        Theta {
            reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 },
            budgets,
        }
    }

    fn build_alice_with_50(dag: &mut EventDagCore) -> String {
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let mut last = genesis.clone();
        let mut last_cadence: Option<String> = None;
        for e in 1..=5 {
            let parent = last_cadence.clone().unwrap_or_else(|| genesis.clone());
            let mut parents = vec![parent, last.clone()];
            parents.dedup();
            let id = dag.add_event(parents, serde_json::json!({"type": "cadence", "domain": "alice", "epoch": e})).unwrap();
            last_cadence = Some(id.clone());
            last = id;
        }
        dag.add_event(vec![last], serde_json::json!({"type": "accrual", "domain": "alice", "b": 10.0, "q0": 0, "T": 0.0})).unwrap()
    }

    #[test]
    fn claim_issue_debits_g_and_creates_a_claim_in_conservation() {
        let mut dag = EventDagCore::new();
        let last = build_alice_with_50(&mut dag);
        dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 20.0})).unwrap();

        let events = dag.topo_order();
        let t = theta(&[("alice", None)]);
        let g_state = GState::materialize(&t, &events);
        let con_state = materialize_conservation(&events);

        assert_eq!(g_state.balances.get("alice"), Some(&30.0));
        assert_eq!(con_state.claims["c1"].amount, 20.0);
        assert_eq!(con_state.claims["c1"].owner, "alice");
    }

    #[test]
    fn full_send_alice_to_bob_real_ownership_change() {
        let mut dag = EventDagCore::new();
        let mut last = build_alice_with_50(&mut dag);
        last = dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 20.0})).unwrap();
        dag.add_event(vec![last], serde_json::json!({"type": "transfer", "claimId": "c1", "from": "alice", "to": "bob"})).unwrap();

        let events = dag.topo_order();
        let t = theta(&[("alice", None)]);
        let g_state = GState::materialize(&t, &events);
        let con_state = materialize_conservation(&events);

        assert_eq!(g_state.balances.get("alice"), Some(&30.0));
        let bob_claims: Vec<_> = con_state.claims.values().filter(|c| c.owner == "bob" && c.status == crate::conservation::ClaimStatus::Active).collect();
        assert_eq!(bob_claims.len(), 1);
        assert_eq!(bob_claims[0].amount, 20.0);
    }

    #[test]
    fn double_spend_is_rejected_during_the_fold() {
        let mut dag = EventDagCore::new();
        let mut last = build_alice_with_50(&mut dag);
        last = dag.add_event(vec![last], serde_json::json!({"type": "claim-issue", "domain": "alice", "id": "c1", "amount": 20.0})).unwrap();
        let t1 = dag.add_event(vec![last], serde_json::json!({"type": "transfer", "claimId": "c1", "from": "alice", "to": "bob"})).unwrap();
        dag.add_event(vec![t1], serde_json::json!({"type": "transfer", "claimId": "c1", "from": "alice", "to": "carol"})).unwrap();

        let events = dag.topo_order();
        let con_state = materialize_conservation(&events);
        let carol_claims: Vec<_> = con_state.claims.values().filter(|c| c.owner == "carol").collect();
        assert_eq!(carol_claims.len(), 0);
    }

    #[test]
    fn malformed_events_are_folded_through_without_panicking() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis.clone()], serde_json::json!({"type": "claim-issue", "domain": "", "id": "x", "amount": 10.0})).unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "transfer", "claimId": "", "from": "a", "to": "b"})).unwrap();
        let events = dag.topo_order();
        let con_state = materialize_conservation(&events);
        assert!(con_state.claims.is_empty());
    }
}
