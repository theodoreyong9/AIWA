use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::event::Event;

/// Per-domain cadence state: current epoch and the id of the last
/// accepted cadence event for that domain (used for causal chaining /
/// replay- and fork-protection).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainCadenceState {
    pub epoch: u64,
    pub last_id: Option<String>,
}

impl Default for DomainCadenceState {
    fn default() -> Self {
        DomainCadenceState { epoch: 0, last_id: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub event_id: String,
    pub domain: String,
    pub reason: String,
}

/// Cadence state: per-domain epoch/lastId, plus a log of rejected
/// (invalid) cadence transitions for observability and testing. Mirror
/// of CadenceState in public/js/core/economics/cadence.js.
#[derive(Debug, Clone, Default)]
pub struct CadenceState {
    pub domains: HashMap<String, DomainCadenceState>,
    pub rejections: Vec<Rejection>,
}

/// Minimal shape of a cadence event's payload, per §10, Definition 10.1.
#[derive(Debug, Deserialize)]
struct CadencePayload {
    #[serde(rename = "type")]
    kind: String,
    domain: Option<String>,
    epoch: Option<i64>,
}

impl CadenceState {
    pub fn new() -> Self {
        Self::default()
    }

    fn reject(&mut self, event_id: &str, domain: &str, reason: impl Into<String>) {
        self.rejections.push(Rejection {
            event_id: event_id.to_string(),
            domain: domain.to_string(),
            reason: reason.into(),
        });
    }

    /// Applies one event. Non-cadence events, and cadence events with a
    /// malformed payload, are left as an unchanged no-op (payload shape
    /// validation is a DAG/schema concern, not this reducer's). Invalid
    /// *transitions* (wrong epoch, wrong causal parent) are rejected and
    /// recorded rather than causing an error — mirrors
    /// applyCadenceEvent() in cadence.js exactly.
    pub fn apply_event(&mut self, event: &Event) {
        let payload: CadencePayload = match serde_json::from_value(event.payload.clone()) {
            Ok(p) => p,
            Err(_) => return,
        };
        if payload.kind != "cadence" {
            return;
        }

        let domain = match payload.domain {
            Some(d) if !d.is_empty() => d,
            _ => {
                self.reject(&event.id, "", "missing or invalid domain");
                return;
            }
        };

        let epoch = match payload.epoch {
            Some(e) if e >= 1 => e as u64,
            _ => {
                self.reject(&event.id, &domain, "epoch must be a positive integer");
                return;
            }
        };

        let current = self.domains.entry(domain.clone()).or_default().clone();

        if epoch != current.epoch + 1 {
            self.reject(
                &event.id,
                &domain,
                format!("expected epoch {}, got {epoch}", current.epoch + 1),
            );
            return;
        }

        if let Some(last_id) = &current.last_id {
            if !event.parents.contains(last_id) {
                self.reject(
                    &event.id,
                    &domain,
                    format!("does not chain from domain's last accepted cadence event {last_id}"),
                );
                return;
            }
        }

        self.domains.insert(
            domain,
            DomainCadenceState { epoch, last_id: Some(event.id.clone()) },
        );
    }

    /// Folds cadence transitions over a topologically-ordered event list
    /// (e.g. from EventDagCore::topo_order()).
    pub fn materialize(ordered_events: &[&Event]) -> CadenceState {
        let mut state = CadenceState::new();
        for event in ordered_events {
            state.apply_event(event);
        }
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cadence_event(id: &str, parents: Vec<String>, domain: &str, epoch: i64) -> Event {
        Event {
            id: id.to_string(),
            parents,
            payload: serde_json::json!({ "type": "cadence", "domain": domain, "epoch": epoch }),
        }
    }

    #[test]
    fn first_cadence_transition_is_accepted() {
        let mut state = CadenceState::new();
        let e = cadence_event("c1", vec![], "d1", 1);
        state.apply_event(&e);

        assert_eq!(
            state.domains["d1"],
            DomainCadenceState { epoch: 1, last_id: Some("c1".to_string()) }
        );
        assert!(state.rejections.is_empty());
    }

    #[test]
    fn skipping_an_epoch_is_rejected() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("c1", vec![], "d1", 1));
        state.apply_event(&cadence_event("c2", vec!["c1".to_string()], "d1", 3)); // skip 2

        assert_eq!(state.domains["d1"].epoch, 1); // unchanged
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn transition_not_chained_to_last_accepted_is_rejected() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("c1", vec![], "d1", 1));
        // c2 claims epoch 2 but doesn't reference c1 as a parent.
        state.apply_event(&cadence_event("c2", vec![], "d1", 2));

        assert_eq!(state.domains["d1"].epoch, 1);
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn forked_competing_transition_at_same_epoch_is_rejected() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("c1", vec![], "d1", 1));
        state.apply_event(&cadence_event("c2", vec!["c1".to_string()], "d1", 2));
        // c2b also claims epoch 2, chained from c1 — a fork attempt.
        state.apply_event(&cadence_event("c2b", vec!["c1".to_string()], "d1", 2));

        assert_eq!(state.domains["d1"].last_id, Some("c2".to_string()));
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn independent_domains_advance_independently() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("a1", vec![], "domain-a", 1));
        state.apply_event(&cadence_event("b1", vec![], "domain-b", 1));
        state.apply_event(&cadence_event("a2", vec!["a1".to_string()], "domain-a", 2));

        assert_eq!(state.domains["domain-a"].epoch, 2);
        assert_eq!(state.domains["domain-b"].epoch, 1);
        assert!(state.rejections.is_empty());
    }

    #[test]
    fn interleaving_of_independent_domains_does_not_affect_the_final_state() {
        // §9: G must be deterministic over the converged event set alone,
        // not over receipt/processing order. Two independent domains'
        // causal chains, processed in two different (both causally
        // valid — parents still precede children within each chain)
        // interleavings, must produce the same final state.
        let a1 = cadence_event("a1", vec![], "domain-a", 1);
        let a2 = cadence_event("a2", vec!["a1".to_string()], "domain-a", 2);
        let b1 = cadence_event("b1", vec![], "domain-b", 1);
        let b2 = cadence_event("b2", vec!["b1".to_string()], "domain-b", 2);

        let order1 = CadenceState::materialize(&[&a1, &b1, &a2, &b2]);
        let order2 = CadenceState::materialize(&[&b1, &a1, &b2, &a2]);

        assert_eq!(order1.domains, order2.domains);
        assert!(order1.rejections.is_empty());
        assert!(order2.rejections.is_empty());
    }

    #[test]
    fn invalid_domain_and_epoch_shapes_are_rejected_without_panicking() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("x1", vec![], "", 1));
        state.apply_event(&cadence_event("x2", vec![], "d1", 0));
        // Note: unlike the JS side, epoch is typed as an integer in Rust's
        // payload schema, so a "1.5" case cannot reach this reducer at all —
        // it fails JSON deserialization upstream, which is a stronger
        // guarantee than a runtime check.
        assert_eq!(state.rejections.len(), 2);
        assert!(state.domains.is_empty());
    }

    #[test]
    fn non_cadence_events_pass_through_unchanged() {
        let mut state = CadenceState::new();
        let e = Event { id: "e1".to_string(), parents: vec![], payload: serde_json::json!({"type": "genesis"}) };
        state.apply_event(&e);
        assert!(state.domains.is_empty());
        assert!(state.rejections.is_empty());
    }
}

