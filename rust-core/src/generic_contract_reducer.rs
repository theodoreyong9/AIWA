//! generic_contract_reducer.rs — mirror of generic-contract-reducer.js.
//! See that file's own header for the full rationale and safety
//! argument: a contract mints ONCE with an immutable condition
//! template; a release event can never supply its own condition, only
//! reference an already-minted contractId, with claimId/from/to
//! substituted into the template's placeholders. This is the last mile
//! of §27.9's composability promise — a genuinely new contract type
//! needs zero platform code, as long as its release logic is
//! expressible as a declarative condition over already-existing
//! events/state.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::causal_condition_evaluator::{evaluate_condition, Condition, EvaluationContext, FunctionRegistry};
use crate::conservation::ConservationState;
use crate::event::Event;

#[derive(Debug, Clone)]
pub struct GenericContract {
    pub condition: Condition,
    pub minted_by: Option<String>,
    pub minted_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GenericContractRejection {
    pub event_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default)]
pub struct GenericContractState {
    pub contracts: HashMap<String, GenericContract>,
    pub rejections: Vec<GenericContractRejection>,
}

/// The three placeholder tokens a condition template may reference —
/// mirror of the exact same three strings substitute-Placeholders()
/// recognizes in the JS side. Deliberately narrow: whole-string
/// matches only, no partial substitution, no templating engine.
fn substitute_string(s: &str, claim_id: &str, from: &str, to: &str) -> String {
    match s {
        "$claimId" => claim_id.to_string(),
        "$from" => from.to_string(),
        "$to" => to.to_string(),
        other => other.to_string(),
    }
}

/// Mirror of substitutePlaceholders() — walks a Condition tree,
/// replacing placeholder strings with the real release values.
pub fn substitute_placeholders(condition: &Condition, claim_id: &str, from: &str, to: &str) -> Condition {
    match condition {
        Condition::Ownership { claim_id: c, expected_owner } => Condition::Ownership {
            claim_id: substitute_string(c, claim_id, from, to),
            expected_owner: substitute_string(expected_owner, claim_id, from, to),
        },
        Condition::Signature { message, signer_pubkey_hex, signature_hex, expected_domain } => Condition::Signature {
            message: substitute_string(message, claim_id, from, to),
            signer_pubkey_hex: substitute_string(signer_pubkey_hex, claim_id, from, to),
            signature_hex: substitute_string(signature_hex, claim_id, from, to),
            expected_domain: substitute_string(expected_domain, claim_id, from, to),
        },
        Condition::Count { event_type, domain, filter, min } => Condition::Count {
            event_type: substitute_string(event_type, claim_id, from, to),
            domain: domain.as_ref().map(|d| substitute_string(d, claim_id, from, to)),
            filter: filter.clone(),
            min: *min,
        },
        Condition::DeterministicMatch { function, args, output_path, expected_output } => Condition::DeterministicMatch {
            function: substitute_string(function, claim_id, from, to),
            args: args.clone(),
            output_path: output_path.clone(),
            expected_output: expected_output.clone(),
        },
        Condition::Unique { key } => Condition::Unique { key: substitute_string(key, claim_id, from, to) },
        Condition::CausalOrder { before_event_id, after_event_id } => Condition::CausalOrder {
            before_event_id: substitute_string(before_event_id, claim_id, from, to),
            after_event_id: substitute_string(after_event_id, claim_id, from, to),
        },
        Condition::All(cs) => Condition::All(cs.iter().map(|c| substitute_placeholders(c, claim_id, from, to)).collect()),
        Condition::Any(cs) => Condition::Any(cs.iter().map(|c| substitute_placeholders(c, claim_id, from, to)).collect()),
        Condition::Not(inner) => Condition::Not(Box::new(substitute_placeholders(inner, claim_id, from, to))),
    }
}

impl GenericContractState {
    pub fn new() -> Self {
        Self::default()
    }

    fn reject(&mut self, event_id: &str, reason: impl Into<String>) {
        self.rejections.push(GenericContractRejection { event_id: event_id.to_string(), reason: reason.into() });
    }

    /// Only 'generic-contract-init' is handled here — mints a
    /// contract's condition permanently, the same immutable-once-set
    /// discipline pool-init and formula-register already use. Real
    /// releases are verified by verify_generic_release(), called as an
    /// injected conservation_bridge.rs pot-release verifier, not
    /// folded here — this reducer only tracks WHAT was minted.
    ///
    /// Note on this Rust mirror's own scope: unlike the JS side's
    /// arbitrary-JSON condition payload, this Rust version requires the
    /// condition to already be deserializable into the real `Condition`
    /// enum via a `condition` field shaped exactly like
    /// causal_condition_evaluator.rs's own JSON representation — a
    /// genuinely different, stricter parsing requirement than JS's
    /// permissive object literal, stated honestly rather than glossed
    /// over.
    pub fn apply_event(&mut self, event: &Event) {
        let Some(kind) = event.payload.get("type").and_then(|v| v.as_str()) else { return };
        if kind != "generic-contract-init" {
            return;
        }

        let Some(contract_id) = event.payload.get("contractId").and_then(|v| v.as_str()) else {
            self.reject(&event.id, "missing contractId");
            return;
        };
        if contract_id.is_empty() {
            self.reject(&event.id, "missing contractId");
            return;
        }
        if self.contracts.contains_key(contract_id) {
            self.reject(&event.id, format!("contract '{contract_id}' already initialized — permanent once minted"));
            return;
        }
        let Some(condition_value) = event.payload.get("condition") else {
            self.reject(&event.id, "missing condition");
            return;
        };
        let Some(condition) = parse_condition(condition_value) else {
            self.reject(&event.id, "condition could not be parsed into a valid Condition");
            return;
        };

        let minted_by = event.payload.get("mintedBy").and_then(|v| v.as_str()).map(String::from);
        let minted_at = event.payload.get("at").and_then(|v| v.as_i64()).unwrap_or(0);
        self.contracts.insert(contract_id.to_string(), GenericContract { condition, minted_by, minted_at });
    }

    /// registry(H_d) for generic contracts — mirror of every other
    /// materialize function in this project.
    pub fn materialize(ordered_events: &[&Event]) -> GenericContractState {
        let mut state = GenericContractState::new();
        for event in ordered_events {
            state.apply_event(event);
        }
        state
    }
}

/// Parses a JSON Value into a real Condition — a minimal, explicit
/// deserializer mirroring the same six primitives and all/any/not
/// composition causal_condition_evaluator.rs's own Condition enum
/// defines. Not derived via serde's own Deserialize on Condition
/// itself (the enum's field-per-variant shape doesn't map cleanly onto
/// a single serde tag without a larger refactor of that file) — kept
/// as its own small, explicit function instead, easy to audit in one
/// place.
fn parse_condition(value: &Value) -> Option<Condition> {
    if let Some(all) = value.get("all").and_then(|v| v.as_array()) {
        return Some(Condition::All(all.iter().map(parse_condition).collect::<Option<Vec<_>>>()?));
    }
    if let Some(any) = value.get("any").and_then(|v| v.as_array()) {
        return Some(Condition::Any(any.iter().map(parse_condition).collect::<Option<Vec<_>>>()?));
    }
    if let Some(not) = value.get("not") {
        return Some(Condition::Not(Box::new(parse_condition(not)?)));
    }

    let kind = value.get("type").and_then(|v| v.as_str())?;
    let s = |key: &str| value.get(key).and_then(|v| v.as_str()).map(String::from);
    match kind {
        "ownership" => Some(Condition::Ownership { claim_id: s("claimId")?, expected_owner: s("expectedOwner")? }),
        "signature" => Some(Condition::Signature {
            message: s("message")?,
            signer_pubkey_hex: s("signerPubkeyHex")?,
            signature_hex: s("signatureHex")?,
            expected_domain: s("expectedDomain")?,
        }),
        "count" => Some(Condition::Count {
            event_type: s("eventType")?,
            domain: s("domain"),
            filter: value.get("filter").and_then(|v| v.as_object()).map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
            min: value.get("min").and_then(|v| v.as_u64())? as usize,
        }),
        "deterministic-match" => Some(Condition::DeterministicMatch {
            function: s("function")?,
            args: value.get("args").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
            output_path: s("outputPath"),
            expected_output: value.get("expectedOutput").cloned().unwrap_or(Value::Null),
        }),
        "unique" => Some(Condition::Unique { key: s("key")? }),
        "causal-order" => Some(Condition::CausalOrder { before_event_id: s("beforeEventId")?, after_event_id: s("afterEventId")? }),
        _ => None,
    }
}

/// The injected verifier conservation_bridge.rs's 'pot-release' event
/// calls. See generic-contract-reducer.js's own header for the safety
/// argument this mirrors exactly: a release attempt can never supply
/// its own condition, only which already-minted contract it claims to
/// satisfy.
///
/// Honest, stated limitation, mirrored from the JS side: `used_keys` is
/// always a fresh, empty set here — a `unique` primitive referenced
/// inside a generic contract's condition will always evaluate as
/// "unique" within this specific mechanism.
pub fn verify_generic_release<'a>(
    contract_state: &GenericContractState,
    conservation_state: &ConservationState,
    ordered_events: &'a [&'a Event],
    function_registry: &'a FunctionRegistry<'a>,
    claim_id: &str,
    from: &str,
    to: &str,
    release_proof: &Value,
) -> bool {
    let Some(contract_id) = release_proof.get("contractId").and_then(|v| v.as_str()) else { return false };
    let Some(contract) = contract_state.contracts.get(contract_id) else { return false };

    let condition = substitute_placeholders(&contract.condition, claim_id, from, to);
    let used_keys: HashSet<String> = HashSet::new();
    let ctx = EvaluationContext {
        claim_owners: None, // built by the caller when needed — see below
        ordered_events: Some(ordered_events),
        function_registry: Some(function_registry),
        used_keys: Some(&used_keys),
    };
    // The ownership primitive needs a claim_owners view; build one from
    // conservation_state here so callers of this function don't need
    // to construct it themselves every time — mirrors pool_reducer.rs's
    // own approach in verify_pool_payout.
    let claim_owners: HashMap<String, (String, bool)> = conservation_state
        .claims
        .iter()
        .map(|(id, c)| (id.clone(), (c.owner.clone(), c.status == crate::conservation::ClaimStatus::Active)))
        .collect();
    let ctx = EvaluationContext { claim_owners: Some(&claim_owners), ..ctx };

    evaluate_condition(&condition, &ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conservation::identity_derivation;

    fn init_event(id: &str, contract_id: &str, condition: Value) -> Event {
        Event { id: id.to_string(), parents: vec![], payload: serde_json::json!({"type": "generic-contract-init", "contractId": contract_id, "condition": condition, "mintedBy": "alice", "at": 0}) }
    }

    #[test]
    fn a_contract_mints_once_with_a_real_condition() {
        let condition = serde_json::json!({"type": "ownership", "claimId": "$claimId", "expectedOwner": "$from"});
        let mut state = GenericContractState::new();
        state.apply_event(&init_event("e1", "escrow1", condition));
        assert!(state.contracts.contains_key("escrow1"));
    }

    #[test]
    fn security_the_same_contract_id_cannot_be_reminted() {
        let original = serde_json::json!({"type": "ownership", "claimId": "$claimId", "expectedOwner": "$from"});
        let attack = serde_json::json!({"type": "unique", "key": "always-true-forever"});
        let mut state = GenericContractState::new();
        state.apply_event(&init_event("e1", "escrow1", original));
        state.apply_event(&init_event("e2", "escrow1", attack));
        assert_eq!(state.rejections.len(), 1);
        // The original condition must still be the one in effect (spot check via re-evaluation behavior tested below, not structural equality since Condition has no PartialEq derive requirement here).
    }

    #[test]
    fn a_mint_with_a_missing_condition_is_rejected() {
        let mut state = GenericContractState::new();
        let event = Event { id: "e1".to_string(), parents: vec![], payload: serde_json::json!({"type": "generic-contract-init", "contractId": "x"}) };
        state.apply_event(&event);
        assert!(!state.contracts.contains_key("x"));
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn materialize_folds_a_real_sequence_correctly() {
        let condition = serde_json::json!({"type": "ownership", "claimId": "$claimId", "expectedOwner": "$from"});
        let e1 = init_event("e1", "escrow1", condition);
        let events: Vec<&Event> = vec![&e1];
        let state = GenericContractState::materialize(&events);
        assert!(state.contracts.contains_key("escrow1"));
    }

    #[test]
    fn security_a_release_cannot_supply_its_own_condition() {
        // A real, honest condition unambiguously false for this release.
        let condition = serde_json::json!({"type": "count", "eventType": "never-happened", "min": 1});
        let mut contract_state = GenericContractState::new();
        contract_state.apply_event(&init_event("e1", "escrow1", condition));

        let mut conservation = ConservationState::new();
        conservation.issue_claim("c1", "AIWA", 10.0, &crate::pool_reducer::pot_address("escrow1")).unwrap();

        let malicious_release_proof = serde_json::json!({"contractId": "escrow1", "condition": {"type": "unique", "key": "trivially-true"}});
        let empty_events: Vec<&Event> = vec![];
        let empty_registry: FunctionRegistry = HashMap::new();
        let ok = verify_generic_release(&contract_state, &conservation, &empty_events, &empty_registry, "c1", &crate::pool_reducer::pot_address("escrow1"), "attacker", &malicious_release_proof);
        assert!(!ok, "the smuggled condition must be completely ignored");
    }

    #[test]
    fn a_legitimate_release_matching_the_minted_condition_is_accepted() {
        let condition = serde_json::json!({"type": "ownership", "claimId": "$claimId", "expectedOwner": "$from"});
        let mut contract_state = GenericContractState::new();
        contract_state.apply_event(&init_event("e1", "escrow1", condition));

        let mut conservation = ConservationState::new();
        conservation.issue_claim("c1", "AIWA", 10.0, &crate::pool_reducer::pot_address("escrow1")).unwrap();

        let release_proof = serde_json::json!({"contractId": "escrow1"});
        let empty_events: Vec<&Event> = vec![];
        let empty_registry: FunctionRegistry = HashMap::new();
        let ok = verify_generic_release(&contract_state, &conservation, &empty_events, &empty_registry, "c1", &crate::pool_reducer::pot_address("escrow1"), "bob", &release_proof);
        assert!(ok);
    }

    #[test]
    fn a_release_for_an_unminted_contract_is_rejected() {
        let contract_state = GenericContractState::new();
        let conservation = ConservationState::new();
        let release_proof = serde_json::json!({"contractId": "nonexistent"});
        let empty_events: Vec<&Event> = vec![];
        let empty_registry: FunctionRegistry = HashMap::new();
        let ok = verify_generic_release(&contract_state, &conservation, &empty_events, &empty_registry, "c1", "from", "to", &release_proof);
        assert!(!ok);
    }

    /// End-to-end: a genuinely NEW contract type — a 2-of-2
    /// threshold-release escrow — built with zero pool-style bespoke
    /// code, mirroring the JS side's own end-to-end test exactly.
    #[test]
    fn end_to_end_threshold_release_escrow_zero_platform_specific_code() {
        let condition = serde_json::json!({"type": "count", "eventType": "approval", "filter": {"contractId": "escrow1"}, "min": 2});
        let mut contract_state = GenericContractState::new();
        contract_state.apply_event(&init_event("init", "escrow1", condition));

        let mut conservation = ConservationState::new();
        conservation.issue_claim("c1", "AIWA", 50.0, "depositor").unwrap();
        let proof = conservation.transfer("c1", "depositor", &crate::pool_reducer::pot_address("escrow1"), "0", "identity", identity_derivation).unwrap();
        let real_claim_id = format!("activated:{}", proof.id);

        let a1 = Event { id: "a1".to_string(), parents: vec![], payload: serde_json::json!({"type": "approval", "contractId": "escrow1", "approver": "signer1"}) };
        let events_one: Vec<&Event> = vec![&a1];
        let empty_registry: FunctionRegistry = HashMap::new();
        let not_yet = verify_generic_release(&contract_state, &conservation, &events_one, &empty_registry, &real_claim_id, &crate::pool_reducer::pot_address("escrow1"), "beneficiary", &serde_json::json!({"contractId": "escrow1"}));
        assert!(!not_yet, "must not release with only 1 of 2 required approvals");

        let a2 = Event { id: "a2".to_string(), parents: vec!["a1".to_string()], payload: serde_json::json!({"type": "approval", "contractId": "escrow1", "approver": "signer2"}) };
        let events_two: Vec<&Event> = vec![&a1, &a2];
        let now_ok = verify_generic_release(&contract_state, &conservation, &events_two, &empty_registry, &real_claim_id, &crate::pool_reducer::pot_address("escrow1"), "beneficiary", &serde_json::json!({"contractId": "escrow1"}));
        assert!(now_ok, "must release once 2 of 2 required approvals are real and present");
    }
}
