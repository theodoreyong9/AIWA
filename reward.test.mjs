use wasm_bindgen::prelude::*;

use crate::core::EventDagCore;

/// Thin wasm-bindgen wrapper around EventDagCore. Its only job is
/// converting between JsValue and serde_json::Value at the JS/Rust
/// boundary — all actual logic lives in core.rs, where it is unit
/// tested natively. This wrapper is intentionally untested here: it has
/// no logic of its own, and JsValue calls require a real JS/wasm host to
/// run, which is not available in a plain `cargo test`.
///
/// Must remain interchangeable with the pure JavaScript EventDag
/// (public/js/core/event-dag.js): same API contract, same
/// content-addressed id for the same inputs.
#[wasm_bindgen]
pub struct EventDag {
    inner: EventDagCore,
}

#[wasm_bindgen]
impl EventDag {
    #[wasm_bindgen(constructor)]
    pub fn new() -> EventDag {
        EventDag { inner: EventDagCore::new() }
    }

    #[wasm_bindgen(js_name = addEvent)]
    pub fn add_event(&mut self, parents: Vec<String>, payload: JsValue) -> Result<String, JsValue> {
        let payload_json: serde_json::Value = serde_wasm_bindgen::from_value(payload)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.inner
            .add_event(parents, payload_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn merge(&mut self, other: &EventDag) {
        self.inner.merge(&other.inner);
    }

    pub fn size(&self) -> usize {
        self.inner.size()
    }

    #[wasm_bindgen(js_name = topoOrderJson)]
    pub fn topo_order_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.topo_order()).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

impl Default for EventDag {
    fn default() -> Self {
        Self::new()
    }
}
