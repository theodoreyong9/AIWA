use std::collections::HashMap;

use serde::Deserialize;

use crate::event::Event;

pub const GENESIS_FORMULA_ID: &str = "genesis";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FormulaParams {
    pub alpha: f64,
    pub beta: f64,
    pub gamma: f64,
    pub c: f64,
    pub min_q: f64,
}

pub const GENESIS_FORMULA_PARAMS: FormulaParams =
    FormulaParams { alpha: 1.1, beta: 2.2, gamma: 3.0, c: 35937.0, min_q: 1.0 };

#[derive(Debug, Clone, PartialEq)]
pub struct MintedFormula {
    pub params: FormulaParams,
    pub minted_by: Option<String>,
    pub minted_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FormulaRejection {
    pub event_id: String,
    pub id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct FormulaRegistryState {
    pub formulas: HashMap<String, MintedFormula>,
    pub rejections: Vec<FormulaRejection>,
}

impl Default for FormulaRegistryState {
    fn default() -> Self {
        Self::new()
    }
}

impl FormulaRegistryState {
    /// Mirror of initialFormulaRegistryState() — genesis is always
    /// present, no event or burn required, avoiding the bootstrapping
    /// paradox: a domain needs SOME formula before it could ever mint a
    /// new one under real economic rules.
    pub fn new() -> Self {
        let mut formulas = HashMap::new();
        formulas.insert(
            GENESIS_FORMULA_ID.to_string(),
            MintedFormula { params: GENESIS_FORMULA_PARAMS, minted_by: None, minted_at: 0 },
        );
        FormulaRegistryState { formulas, rejections: Vec::new() }
    }
}

#[derive(Deserialize)]
struct FormulaRegisterPayload {
    id: Option<String>,
    alpha: Option<f64>,
    beta: Option<f64>,
    gamma: Option<f64>,
    #[serde(rename = "C")]
    c: Option<f64>,
    #[serde(rename = "minQ")]
    min_q: Option<f64>,
    #[serde(rename = "mintedBy")]
    minted_by: Option<String>,
    at: Option<i64>,
}

/// Mirror of applyFormulaEvent() in formula-registry-reducer.js — see
/// that file's header for the full rationale: a minted formula's
/// parameters are permanent from the moment they're registered, no
/// update path exists, and the same id can never be reused.
pub fn apply_formula_event(state: &FormulaRegistryState, event: &Event) -> FormulaRegistryState {
    let kind = event.payload.get("type").and_then(|v| v.as_str());
    if kind != Some("formula-register") {
        return state.clone();
    }

    let Ok(p) = serde_json::from_value::<FormulaRegisterPayload>(event.payload.clone()) else {
        return state.clone();
    };

    let mut new_state = state.clone();
    let reject = |state: &mut FormulaRegistryState, id: Option<String>, reason: &str| {
        state.rejections.push(FormulaRejection { event_id: event.id.clone(), id, reason: reason.to_string() });
    };

    let Some(id) = p.id.filter(|s| !s.is_empty()) else {
        reject(&mut new_state, None, "missing or invalid formula id");
        return new_state;
    };
    if id == GENESIS_FORMULA_ID {
        reject(&mut new_state, Some(id), "'genesis' is reserved for the protocol default and cannot be re-minted");
        return new_state;
    }
    if new_state.formulas.contains_key(&id) {
        reject(&mut new_state, Some(id.clone()), &format!("formula id '{id}' is already minted — parameters are permanent once registered"));
        return new_state;
    }
    let (Some(alpha), Some(beta), Some(gamma), Some(c), Some(min_q)) = (p.alpha, p.beta, p.gamma, p.c, p.min_q) else {
        reject(&mut new_state, Some(id), "alpha, beta, gamma, C, and minQ must all be present and finite");
        return new_state;
    };
    if ![alpha, beta, gamma, c, min_q].iter().all(|v| v.is_finite()) {
        reject(&mut new_state, Some(id), "alpha, beta, gamma, C, and minQ must all be finite numbers");
        return new_state;
    }

    new_state.formulas.insert(
        id,
        MintedFormula { params: FormulaParams { alpha, beta, gamma, c, min_q }, minted_by: p.minted_by, minted_at: p.at.unwrap_or(0) },
    );
    new_state
}

/// registry(H_d) for minted formulas — mirror of materializeFormulas().
pub fn materialize_formulas(ordered_events: &[&Event]) -> FormulaRegistryState {
    let mut state = FormulaRegistryState::new();
    for event in ordered_events {
        state = apply_formula_event(&state, event);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::EventDagCore;

    #[test]
    fn genesis_always_present_even_over_empty_events() {
        let state = FormulaRegistryState::new();
        assert_eq!(state.formulas[GENESIS_FORMULA_ID].params, GENESIS_FORMULA_PARAMS);
    }

    #[test]
    fn a_real_mint_registers_a_new_permanent_formula() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(
            vec![genesis],
            serde_json::json!({"type": "formula-register", "id": "my-formula", "alpha": 1.0, "beta": 0.0, "gamma": 1.0, "C": 5.0, "minQ": 2.0, "mintedBy": "alice", "at": 0}),
        )
        .unwrap();

        let state = materialize_formulas(&dag.topo_order());
        assert_eq!(state.formulas["my-formula"].params.alpha, 1.0);
        assert_eq!(state.formulas["my-formula"].minted_by, Some("alice".to_string()));
    }

    #[test]
    fn exactly_one_registration_wins_deterministically() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(
            vec![genesis.clone()],
            serde_json::json!({"type": "formula-register", "id": "my-formula", "alpha": 1.0, "beta": 0.0, "gamma": 1.0, "C": 5.0, "minQ": 2.0, "mintedBy": "alice", "at": 0}),
        )
        .unwrap();
        dag.add_event(
            vec![genesis],
            serde_json::json!({"type": "formula-register", "id": "my-formula", "alpha": 99.0, "beta": 99.0, "gamma": 99.0, "C": 99.0, "minQ": 99.0, "mintedBy": "attacker", "at": 1}),
        )
        .unwrap();

        let events = dag.topo_order();
        let state_a = materialize_formulas(&events);
        let state_b = materialize_formulas(&events);
        assert_eq!(state_a.formulas.len(), state_b.formulas.len());
        assert_eq!(state_a.formulas["my-formula"], state_b.formulas["my-formula"]);
        assert_eq!(state_a.rejections.len(), 1);
    }

    #[test]
    fn genesis_id_itself_cannot_be_re_minted() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(
            vec![genesis],
            serde_json::json!({"type": "formula-register", "id": GENESIS_FORMULA_ID, "alpha": 0.0, "beta": 0.0, "gamma": 0.0, "C": 0.0, "minQ": 0.0, "mintedBy": "attacker", "at": 0}),
        )
        .unwrap();

        let state = materialize_formulas(&dag.topo_order());
        assert_eq!(state.formulas[GENESIS_FORMULA_ID].params, GENESIS_FORMULA_PARAMS);
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn two_domains_mint_independently_then_converge_after_merge() {
        let mut earth = EventDagCore::new();
        let e_genesis = earth.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        earth
            .add_event(vec![e_genesis], serde_json::json!({"type": "formula-register", "id": "earth-formula", "alpha": 1.0, "beta": 1.0, "gamma": 1.0, "C": 1.0, "minQ": 1.0, "mintedBy": "earth", "at": 0}))
            .unwrap();

        let mut mars = EventDagCore::new();
        let m_genesis = mars.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        mars.add_event(vec![m_genesis], serde_json::json!({"type": "formula-register", "id": "mars-formula", "alpha": 2.0, "beta": 2.0, "gamma": 2.0, "C": 2.0, "minQ": 2.0, "mintedBy": "mars", "at": 0}))
            .unwrap();

        let mut forward = EventDagCore::new();
        forward.merge(&earth);
        forward.merge(&mars);
        let mut backward = EventDagCore::new();
        backward.merge(&mars);
        backward.merge(&earth);

        let state_forward = materialize_formulas(&forward.topo_order());
        let state_backward = materialize_formulas(&backward.topo_order());
        assert_eq!(state_forward.formulas.len(), state_backward.formulas.len());
        assert!(state_forward.formulas.contains_key("earth-formula"));
        assert!(state_forward.formulas.contains_key("mars-formula"));
    }

    #[test]
    fn malformed_events_rejected_without_panicking() {
        let mut dag = EventDagCore::new();
        let genesis = dag.add_event(vec![], serde_json::json!({"type": "genesis"})).unwrap();
        dag.add_event(vec![genesis.clone()], serde_json::json!({"type": "formula-register", "id": "", "alpha": 1.0, "beta": 1.0, "gamma": 1.0, "C": 1.0, "minQ": 1.0}))
            .unwrap();
        dag.add_event(vec![genesis], serde_json::json!({"type": "formula-register", "id": "bad", "alpha": f64::NAN, "beta": 1.0, "gamma": 1.0, "C": 1.0, "minQ": 1.0}))
            .unwrap();

        let state = materialize_formulas(&dag.topo_order());
        assert!(!state.formulas.contains_key("bad"));
    }
}
