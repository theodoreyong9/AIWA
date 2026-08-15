use crate::event::Event;
use crate::modules::module_registry::{EconomicConfig, ModuleRegistryState, NewModule};

/// Mirror of applyModuleEvent()/materializeModuleRegistry() in
/// module-registry-reducer.js — see that file's header for the full
/// rationale: this makes the module registry a materialized view over
/// H_d, like every other durable state in this project, instead of a
/// standalone object with no cross-domain propagation mechanism.

#[derive(serde::Deserialize)]
struct RegisterPayload {
    id: String,
    name: String,
    icon: String,
    category: String,
    description: String,
    #[serde(rename = "codeHash")]
    code_hash: String,
    #[serde(rename = "codeUrl")]
    code_url: String,
    author: String,
    #[serde(rename = "isIssuing")]
    is_issuing: bool,
    #[serde(rename = "timeSensitive")]
    time_sensitive: Option<bool>,
    #[serde(rename = "economicConfig")]
    economic_config: Option<EconomicConfigPayload>,
    at: Option<i64>,
}

#[derive(serde::Deserialize)]
struct EconomicConfigPayload {
    alpha: f64,
    #[serde(rename = "identityCostMechanism")]
    identity_cost_mechanism: Option<String>,
    #[serde(rename = "scarcityPolicy")]
    scarcity_policy: String,
}

#[derive(serde::Deserialize)]
struct UpdatePayload {
    id: String,
    #[serde(rename = "codeHash")]
    code_hash: String,
    #[serde(rename = "codeUrl")]
    code_url: String,
}

#[derive(serde::Deserialize)]
struct AuditPayload {
    id: String,
    status: String,
}

fn parse_audit_status(s: &str) -> Option<crate::modules::module_registry::AuditStatus> {
    use crate::modules::module_registry::AuditStatus;
    match s {
        "unaudited" => Some(AuditStatus::Unaudited),
        "passed" => Some(AuditStatus::Passed),
        "red-listed" => Some(AuditStatus::RedListed),
        _ => None,
    }
}

/// Folds one event into the registry. Non-module event types pass
/// through unchanged. Rejections (duplicate id, inconsistent economic
/// config) leave state unchanged rather than erroring — the same
/// tolerant-fold pattern as cadence.rs and g.rs.
pub fn apply_module_event(state: &mut ModuleRegistryState, event: &Event) {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    let Some(kind) = kind else { return };

    match kind {
        "module-register" => {
            let Ok(p) = serde_json::from_value::<RegisterPayload>(event.payload.clone()) else { return };
            let economic_config = p.economic_config.map(|c| EconomicConfig {
                alpha: c.alpha,
                identity_cost_mechanism: c.identity_cost_mechanism,
                scarcity_policy: c.scarcity_policy,
            });
            state.register_module(
                NewModule {
                    id: p.id,
                    name: p.name,
                    icon: p.icon,
                    category: p.category,
                    description: p.description,
                    code_hash: p.code_hash,
                    code_url: p.code_url,
                    author: p.author,
                    is_issuing: p.is_issuing,
                    time_sensitive: p.time_sensitive,
                    economic_config,
                },
                p.at.unwrap_or(0),
            );
        }
        "module-update" => {
            let Ok(p) = serde_json::from_value::<UpdatePayload>(event.payload.clone()) else { return };
            state.update_module_code(&p.id, p.code_hash, p.code_url);
        }
        "module-audit" => {
            let Ok(p) = serde_json::from_value::<AuditPayload>(event.payload.clone()) else { return };
            if let Some(status) = parse_audit_status(&p.status) {
                state.set_audit_status(&p.id, status);
            }
        }
        _ => {}
    }
}

/// A = registry(H_d): folds a topologically-ordered event list — mirror
/// of materializeModuleRegistry().
pub fn materialize_module_registry(ordered_events: &[&Event]) -> ModuleRegistryState {
    let mut state = ModuleRegistryState::new();
    for event in ordered_events {
        apply_module_event(&mut state, event);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::EventDagCore;

    #[test]
    fn module_registered_on_one_replica_is_invisible_on_another_before_merge() {
        let mut earth = EventDagCore::new();
        let genesis = earth.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        earth
            .add_event(
                vec![genesis.clone()],
                serde_json::json!({
                    "type": "module-register", "id": "weather.js", "name": "Weather", "icon": "☀️",
                    "category": "Tools", "description": "Shows the weather.", "codeHash": "hash1",
                    "codeUrl": "https://example.com/weather.js", "author": "earth-domain",
                    "isIssuing": false, "timeSensitive": null, "economicConfig": null, "at": 1000
                }),
            )
            .unwrap();

        let mut mars = EventDagCore::new();
        mars.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();

        let earth_registry = materialize_module_registry(&earth.topo_order());
        let mars_registry = materialize_module_registry(&mars.topo_order());

        assert!(earth_registry.modules.contains_key("weather.js"));
        assert!(!mars_registry.modules.contains_key("weather.js"));
    }

    #[test]
    fn after_merge_both_replicas_converge_regardless_of_merge_order() {
        let mut earth = EventDagCore::new();
        let genesis = earth.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        earth
            .add_event(
                vec![genesis.clone()],
                serde_json::json!({
                    "type": "module-register", "id": "weather.js", "name": "Weather", "icon": "☀️",
                    "category": "Tools", "description": "Shows the weather.", "codeHash": "hash1",
                    "codeUrl": "https://example.com/weather.js", "author": "earth-domain",
                    "isIssuing": false, "timeSensitive": null, "economicConfig": null, "at": 1000
                }),
            )
            .unwrap();

        let mut mars = EventDagCore::new();
        let mars_genesis = mars.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        mars.add_event(
            vec![mars_genesis],
            serde_json::json!({
                "type": "module-register", "id": "rover-cam.js", "name": "Rover Cam", "icon": "📷",
                "category": "Media", "description": "Live rover feed.", "codeHash": "hash2",
                "codeUrl": "https://example.com/rover-cam.js", "author": "mars-domain",
                "isIssuing": false, "timeSensitive": null, "economicConfig": null, "at": 2000
            }),
        )
        .unwrap();

        let mut merged_forward = EventDagCore::new();
        merged_forward.merge(&earth);
        merged_forward.merge(&mars);

        let mut merged_backward = EventDagCore::new();
        merged_backward.merge(&mars);
        merged_backward.merge(&earth);

        let registry_forward = materialize_module_registry(&merged_forward.topo_order());
        let registry_backward = materialize_module_registry(&merged_backward.topo_order());

        assert!(registry_forward.modules.contains_key("weather.js"));
        assert!(registry_forward.modules.contains_key("rover-cam.js"));
        assert_eq!(registry_forward.modules.len(), registry_backward.modules.len());
        assert_eq!(registry_forward.modules["weather.js"].code_hash, registry_backward.modules["weather.js"].code_hash);
        assert_eq!(registry_forward.modules["rover-cam.js"].code_hash, registry_backward.modules["rover-cam.js"].code_hash);
    }

    #[test]
    fn update_and_audit_events_fold_correctly() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        let reg = dag
            .add_event(
                vec![genesis],
                serde_json::json!({
                    "type": "module-register", "id": "weather.js", "name": "Weather", "icon": "☀️",
                    "category": "Tools", "description": "Shows the weather.", "codeHash": "hash1",
                    "codeUrl": "https://example.com/weather.js", "author": "earth-domain",
                    "isIssuing": false, "timeSensitive": null, "economicConfig": null, "at": 1000
                }),
            )
            .unwrap();
        let audited = dag
            .add_event(vec![reg], serde_json::json!({"type": "module-audit", "id": "weather.js", "status": "passed"}))
            .unwrap();
        dag.add_event(
            vec![audited],
            serde_json::json!({"type": "module-update", "id": "weather.js", "codeHash": "hash2", "codeUrl": "https://example.com/weather.js"}),
        )
        .unwrap();

        let registry = materialize_module_registry(&dag.topo_order());
        assert_eq!(registry.modules["weather.js"].code_hash, "hash2");
        assert_eq!(registry.modules["weather.js"].audit_status, crate::modules::module_registry::AuditStatus::Unaudited);
    }
}
