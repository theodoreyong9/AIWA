use std::collections::{BTreeMap, HashSet};

use crate::event::Event;

/// Pure Rust core of H_d — no wasm-bindgen, no JsValue. This is what gets
/// tested natively (`cargo test`, no wasm32 target required). The
/// wasm-bindgen-facing `EventDag` in dag.rs is a thin wrapper around this
/// struct that only converts JsValue <-> serde_json::Value at the
/// JS/Rust boundary; all actual logic lives here.
#[derive(Debug, Default, Clone)]
pub struct EventDagCore {
    events: BTreeMap<String, Event>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct UnknownParentError(pub String);

impl std::fmt::Display for UnknownParentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Unknown parent: {} — an event can only reference parents already present locally.",
            self.0
        )
    }
}

impl EventDagCore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds an event. Returns its id. Errors if a referenced parent is not
    /// known locally (same rules as the JS side).
    pub fn add_event(
        &mut self,
        parents: Vec<String>,
        payload: serde_json::Value,
    ) -> Result<String, UnknownParentError> {
        for p in &parents {
            if !self.events.contains_key(p) {
                return Err(UnknownParentError(p.clone()));
            }
        }

        let id = Event::compute_id(&parents, &payload);
        self.events.entry(id.clone()).or_insert(Event {
            id: id.clone(),
            parents,
            payload,
        });

        Ok(id)
    }

    /// Merges another DAG into this one. Pure, commutative, idempotent
    /// union — identical to EventDag.merge() on the JS side.
    pub fn merge(&mut self, other: &EventDagCore) {
        for (id, ev) in other.events.iter() {
            self.events.entry(id.clone()).or_insert_with(|| ev.clone());
        }
    }

    pub fn size(&self) -> usize {
        self.events.len()
    }

    /// Deterministic topological order (parents before children, then by
    /// id). The economic reducer stays out of this core — see the
    /// replicated-state / economic-meaning separation, §3.1.
    pub fn topo_order(&self) -> Vec<&Event> {
        let mut visited: HashSet<String> = HashSet::new();
        let mut order: Vec<&Event> = Vec::new();

        fn visit<'a>(
            id: &str,
            events: &'a BTreeMap<String, Event>,
            visited: &mut HashSet<String>,
            order: &mut Vec<&'a Event>,
        ) {
            if visited.contains(id) {
                return;
            }
            visited.insert(id.to_string());
            if let Some(ev) = events.get(id) {
                let mut parents = ev.parents.clone();
                parents.sort();
                for p in &parents {
                    visit(p, events, visited, order);
                }
                order.push(ev);
            }
        }

        let mut ids: Vec<&String> = self.events.keys().collect();
        ids.sort();
        for id in ids {
            visit(id, &self.events, &mut visited, &mut order);
        }
        order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn genesis_event_has_no_parents_and_is_accepted() {
        let mut dag = EventDagCore::new();
        let id = dag.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        assert_eq!(dag.size(), 1);
        assert!(!id.is_empty());
    }

    #[test]
    fn unknown_parent_is_rejected() {
        let mut dag = EventDagCore::new();
        let err = dag.add_event(vec!["nonexistent".to_string()], payload("{}"));
        assert_eq!(err, Err(UnknownParentError("nonexistent".to_string())));
        assert_eq!(dag.size(), 0);
    }

    #[test]
    fn adding_the_same_event_twice_is_idempotent() {
        let mut dag = EventDagCore::new();
        let id1 = dag.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        let id2 = dag.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        assert_eq!(id1, id2);
        assert_eq!(dag.size(), 1);
    }

    #[test]
    fn same_id_for_same_parents_and_payload_regardless_of_key_order() {
        // Content-addressing must not depend on JSON key order.
        let id_a = Event::compute_id(&[], &serde_json::json!({"type": "genesis", "amount": 10}));
        let id_b = Event::compute_id(&[], &serde_json::json!({"amount": 10, "type": "genesis"}));
        assert_eq!(id_a, id_b, "top-level key order must not affect the id");
    }

    #[test]
    fn different_payloads_produce_different_ids() {
        let id_a = Event::compute_id(&[], &serde_json::json!({"type": "genesis"}));
        let id_b = Event::compute_id(&[], &serde_json::json!({"type": "other"}));
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn merge_is_commutative_and_idempotent() {
        let mut a = EventDagCore::new();
        let root_a = a.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        a.add_event(vec![root_a], payload(r#"{"type":"a"}"#)).unwrap();

        let mut b = EventDagCore::new();
        let root_b = b.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        b.add_event(vec![root_b], payload(r#"{"type":"b"}"#)).unwrap();

        let mut merged_ab = EventDagCore::new();
        merged_ab.merge(&a);
        merged_ab.merge(&b);

        let mut merged_ba = EventDagCore::new();
        merged_ba.merge(&b);
        merged_ba.merge(&a);

        // Same root (identical payload → identical content-addressed id),
        // so union size must match regardless of merge order.
        assert_eq!(merged_ab.size(), merged_ba.size());
        assert_eq!(merged_ab.size(), 3); // shared genesis + "a" + "b"

        // Merging twice must not change the size (idempotence).
        merged_ab.merge(&a);
        assert_eq!(merged_ab.size(), 3);
    }

    #[test]
    fn topo_order_places_parents_before_children() {
        let mut dag = EventDagCore::new();
        let root = dag.add_event(vec![], payload(r#"{"type":"genesis"}"#)).unwrap();
        let child = dag
            .add_event(vec![root.clone()], payload(r#"{"type":"child"}"#))
            .unwrap();
        dag.add_event(vec![child.clone()], payload(r#"{"type":"grandchild"}"#))
            .unwrap();

        let order = dag.topo_order();
        let pos = |id: &str| order.iter().position(|e| e.id == id).unwrap();

        assert!(pos(&root) < pos(&child));
        assert_eq!(order.len(), 3);
    }
}
