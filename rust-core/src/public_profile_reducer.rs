//! public_profile_reducer.rs — mirror of public-profile-reducer.js.
//! See that file's own header for the full rationale: 'module-data-
//! published' is a durable DAG event type, folded here into a
//! materialized view any domain can read once reconciled — the real
//! foundation "visiting a profile" needs. Tracks the LATEST value per
//! (domain, moduleId, key), not immutable-once-set like module
//! registration or a minted formula. A published value of exactly
//! `null` retracts that key — a real, explicit unpublish.
//!
//! Found missing entirely — not a signature-level divergence but a
//! whole file never mirrored — during a direct, systematic JS-vs-Rust
//! sweep, not because anyone asked for this one file specifically.

use std::collections::HashMap;

use crate::event::Event;

#[derive(Debug, Clone, PartialEq)]
pub struct PublishedValue {
    pub value: serde_json::Value,
    pub published_at: i64,
}

/// data[domain][moduleId][key] = { value, publishedAt }
#[derive(Debug, Clone, Default)]
pub struct PublicProfileState {
    pub data: HashMap<String, HashMap<String, HashMap<String, PublishedValue>>>,
}

impl PublicProfileState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mirror of applyPublicProfileEvent(). A subtle behavior
    /// deliberately matched exactly, not "cleaned up": JS's
    /// `value === null` check distinguishes an EXPLICIT null (real
    /// unpublish) from the field being entirely ABSENT from the
    /// payload (which JS's `undefined !== null` sends down the "set"
    /// branch instead, storing an effectively-empty value rather than
    /// deleting anything). Mirrored precisely here via
    /// `Option<&Value>` — `None` (absent) and `Some(non-null)` both
    /// take the "set" branch; only `Some(&Value::Null)` (explicit
    /// JSON null) unpublishes — so a converged H_d materializes
    /// identically in both languages even for this edge case.
    pub fn apply_event(&mut self, event: &Event) {
        let Some(kind) = event.payload.get("type").and_then(|v| v.as_str()) else { return };
        if kind != "module-data-published" {
            return;
        }

        let (Some(domain), Some(module_id), Some(key)) = (
            event.payload.get("domain").and_then(|v| v.as_str()),
            event.payload.get("moduleId").and_then(|v| v.as_str()),
            event.payload.get("key").and_then(|v| v.as_str()),
        ) else {
            return; // malformed — tolerant fold, same discipline as every other reducer
        };
        if domain.is_empty() || module_id.is_empty() || key.is_empty() {
            return;
        }

        let value_field = event.payload.get("value");
        let at = event.payload.get("at").and_then(|v| v.as_i64()).unwrap_or(0);

        let domain_data = self.data.entry(domain.to_string()).or_default();
        let module_data = domain_data.entry(module_id.to_string()).or_default();

        match value_field {
            Some(serde_json::Value::Null) => {
                module_data.remove(key); // explicit unpublish
            }
            Some(v) => {
                module_data.insert(key.to_string(), PublishedValue { value: v.clone(), published_at: at });
            }
            None => {
                module_data.insert(key.to_string(), PublishedValue { value: serde_json::Value::Null, published_at: at });
            }
        }
    }

    /// registry(H_d) for published module data — mirror of
    /// materializeModuleRegistry() / materializeFormulas().
    pub fn materialize(ordered_events: &[&Event]) -> PublicProfileState {
        let mut state = PublicProfileState::new();
        for event in ordered_events {
            state.apply_event(event);
        }
        state
    }
}

/// Convenience: everything a given domain's modules have published,
/// flattened for display. Empty if the domain has published nothing —
/// never an error, visiting a domain with no public data is a
/// legitimate, common case.
pub fn published_data_for_domain(state: &PublicProfileState, domain_id: &str) -> HashMap<String, HashMap<String, PublishedValue>> {
    state.data.get(domain_id).cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(id: &str, payload: serde_json::Value) -> Event {
        Event { id: id.to_string(), parents: vec![], payload }
    }
    fn publish_event(id: &str, domain: &str, module_id: &str, key: &str, value: serde_json::Value, at: i64) -> Event {
        event(id, serde_json::json!({"type": "module-data-published", "domain": domain, "moduleId": module_id, "key": key, "value": value, "at": at}))
    }

    #[test]
    fn a_published_value_is_materialized_readable_via_published_data_for_domain() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        let published = published_data_for_domain(&state, "alice");
        assert_eq!(published["status.js"]["mood"].value, serde_json::json!("curious"));
    }

    #[test]
    fn visiting_a_domain_that_has_published_nothing_returns_empty_not_an_error() {
        let state = PublicProfileState::new();
        assert!(published_data_for_domain(&state, "nobody").is_empty());
    }

    #[test]
    fn a_later_publish_to_the_same_key_overwrites_the_earlier_value() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        state.apply_event(&publish_event("e2", "alice", "status.js", "mood", serde_json::json!("busy"), 1));
        assert_eq!(published_data_for_domain(&state, "alice")["status.js"]["mood"].value, serde_json::json!("busy"));
    }

    #[test]
    fn publishing_explicit_null_retracts_the_key() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        state.apply_event(&publish_event("e2", "alice", "status.js", "mood", serde_json::Value::Null, 1));
        assert!(!published_data_for_domain(&state, "alice")["status.js"].contains_key("mood"));
    }

    #[test]
    fn different_modules_on_the_same_domain_have_independent_published_keys() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        state.apply_event(&publish_event("e2", "alice", "chess.js", "rank", serde_json::json!(1500), 1));
        let published = published_data_for_domain(&state, "alice");
        assert_eq!(published["status.js"]["mood"].value, serde_json::json!("curious"));
        assert_eq!(published["chess.js"]["rank"].value, serde_json::json!(1500));
    }

    #[test]
    fn different_domains_never_collide_even_for_the_same_module_and_key() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        state.apply_event(&publish_event("e2", "bob", "status.js", "mood", serde_json::json!("sleepy"), 1));
        assert_eq!(published_data_for_domain(&state, "alice")["status.js"]["mood"].value, serde_json::json!("curious"));
        assert_eq!(published_data_for_domain(&state, "bob")["status.js"]["mood"].value, serde_json::json!("sleepy"));
    }

    #[test]
    fn malformed_publish_events_are_rejected_without_panicking() {
        let mut state = PublicProfileState::new();
        state.apply_event(&event("e1", serde_json::json!({"type": "module-data-published", "domain": "", "moduleId": "x", "key": "y", "value": 1})));
        state.apply_event(&event("e2", serde_json::json!({"type": "module-data-published", "domain": "alice", "moduleId": "", "key": "y", "value": 1})));
        state.apply_event(&event("e3", serde_json::json!({"type": "module-data-published", "domain": "alice", "moduleId": "x", "key": "", "value": 1})));
        assert!(state.data.is_empty());
    }

    #[test]
    fn a_complex_object_value_round_trips_correctly() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "chess.js", "stats", serde_json::json!({"wins": 3, "losses": 1}), 0));
        assert_eq!(published_data_for_domain(&state, "alice")["chess.js"]["stats"].value, serde_json::json!({"wins": 3, "losses": 1}));
    }

    #[test]
    fn a_field_absent_entirely_takes_the_set_branch_not_the_delete_branch_matching_js_exactly() {
        let mut state = PublicProfileState::new();
        state.apply_event(&publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0));
        // 'value' key entirely absent from the payload (not explicit null).
        state.apply_event(&event("e2", serde_json::json!({"type": "module-data-published", "domain": "alice", "moduleId": "status.js", "key": "mood", "at": 1})));
        let published = published_data_for_domain(&state, "alice");
        assert!(published["status.js"].contains_key("mood"), "an absent value field must NOT unpublish — only an explicit null does");
        assert_eq!(published["status.js"]["mood"].value, serde_json::Value::Null);
    }

    #[test]
    fn materialize_folds_a_real_sequence_correctly() {
        let e1 = publish_event("e1", "alice", "status.js", "mood", serde_json::json!("curious"), 0);
        let events: Vec<&Event> = vec![&e1];
        let state = PublicProfileState::materialize(&events);
        assert_eq!(published_data_for_domain(&state, "alice")["status.js"]["mood"].value, serde_json::json!("curious"));
    }
}
