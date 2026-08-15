use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// An event in the DAG H_d: uniquely identified, immutable, referencing
/// its causal parents. Exact mirror of the structure defined on the JS
/// side in public/js/core/event-dag.js.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub parents: Vec<String>,
    pub payload: serde_json::Value,
}

impl Event {
    /// Content-addressed identifier (SHA-256), derived from the (sorted)
    /// parents and the payload — never from a local counter or a wall
    /// clock. Must produce exactly the same id as EventDag.computeId()
    /// on the JS side for a given (parents, payload), so both
    /// implementations remain interchangeable.
    pub fn compute_id(parents: &[String], payload: &serde_json::Value) -> String {
        let mut sorted_parents = parents.to_vec();
        sorted_parents.sort();

        let canonical = serde_json::json!({
            "parents": sorted_parents,
            "payload": payload,
        });
        let bytes = canonical.to_string().into_bytes();

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let digest = hasher.finalize();

        digest.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
