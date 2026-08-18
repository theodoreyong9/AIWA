use serde::Deserialize;

use crate::event::Event;
use crate::identity::{ChurnConfig, Commitment, IdentityCostState, NormalizedBurnTx};

#[derive(Deserialize)]
struct IdentityRegisterPayload {
    domain: Option<String>,
    signature: Option<String>,
    #[serde(rename = "burnedLamports")]
    burned_lamports: Option<i64>,
    #[serde(default)]
    slot: Option<i64>,
    at: Option<i64>,
}

/// Mirror of applyIdentityEvent() in identity-cost-reducer.js — closes
/// the gap the user flagged directly: identity registration used to
/// live in a standalone variable, never folded from H_d. See that
/// file's header for the honest limit this fold has (pure, no network
/// re-verification of the claimed burn amount during the fold itself).
/// `churn_config`: §24 — threaded through unchanged, see ChurnConfig's
/// own doc comment. `None` reproduces the exact prior behavior.
pub fn apply_identity_event(state: &mut IdentityCostState, event: &Event, churn_config: Option<&ChurnConfig>) {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    if kind != Some("identity-register") {
        return;
    }

    let Ok(p) = serde_json::from_value::<IdentityRegisterPayload>(event.payload.clone()) else { return };
    let (Some(domain), Some(signature), Some(burned_lamports)) = (p.domain, p.signature, p.burned_lamports) else { return };
    if domain.is_empty() || signature.is_empty() {
        return;
    }

    let tx = NormalizedBurnTx { signature, err: None, incinerator_balance_delta_lamports: burned_lamports, commitment: Commitment::Finalized, slot: p.slot };
    state.register_identity_cost(&domain, &tx, 0, p.at.unwrap_or(0), churn_config);
}

/// registry(H_d) for identity cost — mirror of materializeIdentity().
/// `churn_config` threaded through unchanged.
pub fn materialize_identity(ordered_events: &[&Event], churn_config: Option<&ChurnConfig>) -> IdentityCostState {
    let mut state = IdentityCostState::new();
    for event in ordered_events {
        apply_identity_event(&mut state, event, churn_config);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::EventDagCore;

    fn identity_event(id: &str, parents: Vec<String>, domain: &str, signature: &str, burned_lamports: i64) -> Event {
        Event {
            id: id.to_string(),
            parents,
            payload: serde_json::json!({ "type": "identity-register", "domain": domain, "signature": signature, "burnedLamports": burned_lamports, "at": 0 }),
        }
    }

    #[test]
    fn identity_invisible_on_another_domain_before_reconciliation() {
        let mut earth = EventDagCore::new();
        let genesis = earth.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        earth.add_event(vec![genesis], identity_event("i1", vec![], "earth", "sig1", 500).payload).unwrap();

        let mut mars = EventDagCore::new();
        mars.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();

        let earth_identity = materialize_identity(&earth.topo_order(), None);
        let mars_identity = materialize_identity(&mars.topo_order(), None);

        assert!(earth_identity.has_identity_cost("earth"));
        assert!(!mars_identity.has_identity_cost("earth"));
    }

    #[test]
    fn converges_after_merge_regardless_of_order() {
        let mut earth = EventDagCore::new();
        let e_genesis = earth.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        earth
            .add_event(vec![e_genesis], serde_json::json!({"type": "identity-register", "domain": "earth", "signature": "sig1", "burnedLamports": 500, "at": 0}))
            .unwrap();

        let mut mars = EventDagCore::new();
        let m_genesis = mars.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        mars.add_event(vec![m_genesis], serde_json::json!({"type": "identity-register", "domain": "mars", "signature": "sig2", "burnedLamports": 300, "at": 0}))
            .unwrap();

        let mut forward = EventDagCore::new();
        forward.merge(&earth);
        forward.merge(&mars);
        let mut backward = EventDagCore::new();
        backward.merge(&mars);
        backward.merge(&earth);

        let identity_forward = materialize_identity(&forward.topo_order(), None);
        let identity_backward = materialize_identity(&backward.topo_order(), None);

        assert!(identity_forward.has_identity_cost("earth"));
        assert!(identity_forward.has_identity_cost("mars"));
        assert_eq!(identity_forward.registered.len(), identity_backward.registered.len());
    }

    #[test]
    fn same_signature_cannot_register_two_domains_even_across_merge() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis.clone()], serde_json::json!({"type": "identity-register", "domain": "earth", "signature": "sig-shared", "burnedLamports": 500, "at": 0}))
            .unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "identity-register", "domain": "mars", "signature": "sig-shared", "burnedLamports": 500, "at": 1}))
            .unwrap();

        let identity = materialize_identity(&dag.topo_order(), None);
        let earth_ok = identity.has_identity_cost("earth");
        let mars_ok = identity.has_identity_cost("mars");
        assert!(!(earth_ok && mars_ok));
        assert!(earth_ok || mars_ok);
    }

    #[test]
    fn malformed_events_folded_through_without_panicking() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis.clone()], serde_json::json!({"type": "identity-register", "domain": "", "signature": "x", "burnedLamports": 10}))
            .unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "identity-register", "domain": "d1", "signature": "", "burnedLamports": 10}))
            .unwrap();
        let identity = materialize_identity(&dag.topo_order(), None);
        assert!(identity.registered.is_empty());
    }
}
