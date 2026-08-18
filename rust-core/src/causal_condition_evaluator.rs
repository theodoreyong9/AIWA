//! causal_condition_evaluator.rs — mirror of
//! causal-condition-evaluator.js. See that file's own header for the
//! full rationale (§27.8): a small, fixed, non-Turing-complete
//! vocabulary of verification primitives, composed as plain data
//! (AND/OR/NOT), so a genuinely new causal contract can compose
//! EXISTING, already-audited checks without a new reducer file or a
//! change to the module bridge's own security boundary. Deliberately
//! NOT a general-purpose interpreter — every primitive here
//! generalizes a check some already-shipped reducer already performs
//! by hand.
//!
//! Honest, stated gap: there is currently no Rust mirror of
//! pool-reducer.js (jackpot/pool was only ever built in JS this
//! session) — so unlike the JS side, this file cannot yet be validated
//! by replacing a real, already-shipped Rust contract's own
//! verification logic the way pool-reducer.js's verifyPoolPayout was.
//! This file is real and independently tested against its own
//! six-primitive contract; the "prototype against a real contract"
//! validation step remains JS-only until a Rust pool mirror exists.

use std::collections::{HashMap, HashSet};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::Value;

use crate::event::Event;
use crate::identity::derive_domain_id;

/// A named, platform-registered pure function a `DeterministicMatch`
/// condition may recompute against. Mirrors functionRegistry in the JS
/// evaluator — a fixed, platform-maintained set; a genuinely new pure
/// computation still needs a platform update to register it here,
/// stated honestly as this primitive's own scope boundary.
pub type FunctionRegistry<'a> = HashMap<&'a str, Box<dyn Fn(&[Value]) -> Option<Value> + 'a>>;

#[derive(Default)]
pub struct EvaluationContext<'a> {
    pub claim_owners: Option<&'a HashMap<String, (String, bool)>>, // claimId -> (owner, is_active) — a minimal, crate-agnostic ownership view, deliberately not coupled to any one conservation module's own struct shape
    pub ordered_events: Option<&'a [&'a Event]>,
    pub function_registry: Option<&'a FunctionRegistry<'a>>,
    pub used_keys: Option<&'a HashSet<String>>,
}

/// Mirror of the Condition union in causal-condition-evaluator.js.
#[derive(Debug, Clone)]
pub enum Condition {
    Ownership { claim_id: String, expected_owner: String },
    Signature { message: String, signer_pubkey_hex: String, signature_hex: String, expected_domain: String },
    Count { event_type: String, domain: Option<String>, filter: Option<HashMap<String, Value>>, min: usize },
    DeterministicMatch { function: String, args: Vec<Value>, output_path: Option<String>, expected_output: Value },
    Unique { key: String },
    CausalOrder { before_event_id: String, after_event_id: String },
    All(Vec<Condition>),
    Any(Vec<Condition>),
    Not(Box<Condition>),
}

fn get_path<'a>(value: &'a Value, path: &Option<String>) -> Option<&'a Value> {
    match path {
        None => Some(value),
        Some(p) => p.split('.').try_fold(value, |acc, key| acc.get(key)),
    }
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}

/// "claim X is currently owned by domain Y, active." Generalizes the
/// real ownership check verifyPoolPayout/prove_transfer already
/// perform by hand.
fn eval_ownership(claim_id: &str, expected_owner: &str, ctx: &EvaluationContext) -> bool {
    match ctx.claim_owners {
        None => false,
        Some(owners) => match owners.get(claim_id) {
            Some((owner, is_active)) => owner == expected_owner && *is_active,
            None => false,
        },
    }
}

/// "this exact message was signed by domain Y's real key." Generalizes
/// verify_transfer_authorization (conservation_bridge.rs).
fn eval_signature(message: &str, signer_pubkey_hex: &str, signature_hex: &str, expected_domain: &str) -> bool {
    let (Some(pubkey_bytes), Some(sig_bytes)) = (from_hex(signer_pubkey_hex), from_hex(signature_hex)) else { return false };
    let Ok(pubkey_arr): Result<[u8; 32], _> = pubkey_bytes.try_into() else { return false };
    let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else { return false };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pubkey_arr) else { return false };
    let signature = Signature::from_bytes(&sig_arr);
    if verifying_key.verify(message.as_bytes(), &signature).is_err() {
        return false;
    }
    derive_domain_id(&pubkey_arr) == expected_domain
}

/// "at least N real events of type T (optionally: domain D, optionally:
/// a flat field filter) exist." Deliberately flat, exact-equality-only
/// filtering, same discipline as the JS mirror — this primitive never
/// grows into its own mini-language.
fn eval_count(event_type: &str, domain: &Option<String>, filter: &Option<HashMap<String, Value>>, min: usize, ctx: &EvaluationContext) -> bool {
    let Some(events) = ctx.ordered_events else { return false };
    let count = events.iter().filter(|e| {
        let Some(t) = e.payload.get("type").and_then(|v| v.as_str()) else { return false };
        if t != event_type { return false; }
        if let Some(d) = domain {
            if e.payload.get("domain").and_then(|v| v.as_str()) != Some(d.as_str()) { return false; }
        }
        if let Some(f) = filter {
            for (key, expected) in f {
                if e.payload.get(key) != Some(expected) { return false; }
            }
        }
        true
    }).count();
    count >= min
}

/// "recomputing a named, registered pure function over given inputs
/// produces the claimed output." Generalizes the recompute-don't-trust
/// pattern already used throughout this project.
fn eval_deterministic_match(function: &str, args: &[Value], output_path: &Option<String>, expected_output: &Value, ctx: &EvaluationContext) -> bool {
    let Some(registry) = ctx.function_registry else { return false };
    let Some(f) = registry.get(function) else { return false };
    let Some(result) = f(args) else { return false }; // a function returning None is treated as a rejection, the Rust mirror of a throwing JS function
    match get_path(&result, output_path) {
        Some(actual) => actual == expected_output,
        None => false,
    }
}

/// "this key has never been set before." Read-only from this
/// evaluator's perspective — the wrapping reducer owns and updates the
/// real used-keys set as its own state.
fn eval_unique(key: &str, ctx: &EvaluationContext) -> bool {
    match ctx.used_keys {
        None => true, // an absent context treats every key as unique, matching the JS mirror
        Some(used) => !used.contains(key),
    }
}

/// "event A causally precedes event B." A real DAG-parent-chain walk,
/// bounded by the same fixed safety bound as the JS mirror — a
/// deliberate DoS guard, not a claim that this bound is always
/// sufficient for every deployment.
fn eval_causal_order(before_event_id: &str, after_event_id: &str, ctx: &EvaluationContext) -> bool {
    const SAFETY_BOUND: usize = 10_000;
    let Some(events) = ctx.ordered_events else { return false };
    let by_id: HashMap<&str, &Event> = events.iter().map(|e| (e.id.as_str(), *e)).collect();
    let Some(target) = by_id.get(after_event_id) else { return false };

    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: Vec<String> = target.parents.clone();
    while let Some(id) = queue.pop() {
        if visited.len() >= SAFETY_BOUND { break; }
        if id == before_event_id { return true; }
        if visited.contains(&id) { continue; }
        visited.insert(id.clone());
        if let Some(event) = by_id.get(id.as_str()) {
            queue.extend(event.parents.clone());
        }
    }
    false
}

/// Evaluates one condition, recursively composing All/Any/Not over the
/// six primitives above. Never executes submitted code — every branch
/// is a fixed, platform-authored check; only the DATA comes from the
/// caller.
pub fn evaluate_condition(condition: &Condition, ctx: &EvaluationContext) -> bool {
    match condition {
        Condition::Ownership { claim_id, expected_owner } => eval_ownership(claim_id, expected_owner, ctx),
        Condition::Signature { message, signer_pubkey_hex, signature_hex, expected_domain } => {
            eval_signature(message, signer_pubkey_hex, signature_hex, expected_domain)
        }
        Condition::Count { event_type, domain, filter, min } => eval_count(event_type, domain, filter, *min, ctx),
        Condition::DeterministicMatch { function, args, output_path, expected_output } => {
            eval_deterministic_match(function, args, output_path, expected_output, ctx)
        }
        Condition::Unique { key } => eval_unique(key, ctx),
        Condition::CausalOrder { before_event_id, after_event_id } => eval_causal_order(before_event_id, after_event_id, ctx),
        Condition::All(conditions) => conditions.iter().all(|c| evaluate_condition(c, ctx)),
        Condition::Any(conditions) => conditions.iter().any(|c| evaluate_condition(c, ctx)),
        Condition::Not(inner) => !evaluate_condition(inner, ctx),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn event(id: &str, parents: Vec<&str>, payload: Value) -> Event {
        Event { id: id.to_string(), parents: parents.into_iter().map(String::from).collect(), payload }
    }

    // ── ownership ─────────────────────────────────────────────────

    #[test]
    fn ownership_accepts_a_real_active_claim_owned_by_expected_domain() {
        let mut owners = HashMap::new();
        owners.insert("c1".to_string(), ("alice".to_string(), true));
        let ctx = EvaluationContext { claim_owners: Some(&owners), ..Default::default() };
        assert!(eval_ownership("c1", "alice", &ctx));
    }

    #[test]
    fn ownership_rejects_a_claim_owned_by_someone_else() {
        let mut owners = HashMap::new();
        owners.insert("c1".to_string(), ("alice".to_string(), true));
        let ctx = EvaluationContext { claim_owners: Some(&owners), ..Default::default() };
        assert!(!eval_ownership("c1", "bob", &ctx));
    }

    #[test]
    fn ownership_rejects_a_nonexistent_claim() {
        let owners = HashMap::new();
        let ctx = EvaluationContext { claim_owners: Some(&owners), ..Default::default() };
        assert!(!eval_ownership("nope", "alice", &ctx));
    }

    #[test]
    fn ownership_rejects_an_inactive_claim() {
        let mut owners = HashMap::new();
        owners.insert("c1".to_string(), ("alice".to_string(), false));
        let ctx = EvaluationContext { claim_owners: Some(&owners), ..Default::default() };
        assert!(!eval_ownership("c1", "alice", &ctx));
    }

    // ── count ─────────────────────────────────────────────────────

    #[test]
    fn count_accepts_when_at_least_min_matching_events_exist() {
        let e1 = event("e1", vec![], serde_json::json!({"type": "donate", "domain": "alice"}));
        let e2 = event("e2", vec!["e1"], serde_json::json!({"type": "donate", "domain": "bob"}));
        let events: Vec<&Event> = vec![&e1, &e2];
        let ctx = EvaluationContext { ordered_events: Some(&events), ..Default::default() };
        assert!(eval_count("donate", &None, &None, 2, &ctx));
        assert!(!eval_count("donate", &None, &None, 3, &ctx));
    }

    #[test]
    fn count_domain_filter_narrows_the_match() {
        let e1 = event("e1", vec![], serde_json::json!({"type": "donate", "domain": "alice"}));
        let e2 = event("e2", vec!["e1"], serde_json::json!({"type": "donate", "domain": "bob"}));
        let events: Vec<&Event> = vec![&e1, &e2];
        let ctx = EvaluationContext { ordered_events: Some(&events), ..Default::default() };
        assert!(eval_count("donate", &Some("alice".to_string()), &None, 1, &ctx));
        assert!(!eval_count("donate", &Some("alice".to_string()), &None, 2, &ctx));
    }

    // ── deterministic-match ──────────────────────────────────────

    #[test]
    fn deterministic_match_accepts_when_recomputed_output_matches() {
        let mut registry: FunctionRegistry = HashMap::new();
        registry.insert("double", Box::new(|args: &[Value]| {
            let n = args[0].as_i64()?;
            Some(Value::from(n * 2))
        }));
        let ctx = EvaluationContext { function_registry: Some(&registry), ..Default::default() };
        assert!(eval_deterministic_match("double", &[Value::from(21)], &None, &Value::from(42), &ctx));
        assert!(!eval_deterministic_match("double", &[Value::from(21)], &None, &Value::from(999), &ctx));
    }

    #[test]
    fn deterministic_match_output_path_extracts_one_field() {
        let mut registry: FunctionRegistry = HashMap::new();
        registry.insert("draw", Box::new(|_args: &[Value]| Some(serde_json::json!({"winnerDomain": "alice", "totalAmount": 25}))));
        let ctx = EvaluationContext { function_registry: Some(&registry), ..Default::default() };
        assert!(eval_deterministic_match("draw", &[], &Some("winnerDomain".to_string()), &Value::from("alice"), &ctx));
        assert!(!eval_deterministic_match("draw", &[], &Some("winnerDomain".to_string()), &Value::from("bob"), &ctx));
    }

    #[test]
    fn deterministic_match_unregistered_function_is_rejected_not_a_panic() {
        let registry: FunctionRegistry = HashMap::new();
        let ctx = EvaluationContext { function_registry: Some(&registry), ..Default::default() };
        assert!(!eval_deterministic_match("nonexistent", &[], &None, &Value::from(1), &ctx));
    }

    #[test]
    fn deterministic_match_a_none_returning_function_is_a_rejection() {
        let mut registry: FunctionRegistry = HashMap::new();
        registry.insert("boom", Box::new(|_args: &[Value]| None));
        let ctx = EvaluationContext { function_registry: Some(&registry), ..Default::default() };
        assert!(!eval_deterministic_match("boom", &[], &None, &Value::from(1), &ctx));
    }

    // ── unique ────────────────────────────────────────────────────

    #[test]
    fn unique_accepts_a_key_not_present() {
        let mut used = HashSet::new();
        used.insert("formula-y".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        assert!(eval_unique("formula-x", &ctx));
    }

    #[test]
    fn unique_rejects_a_key_already_present() {
        let mut used = HashSet::new();
        used.insert("formula-x".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        assert!(!eval_unique("formula-x", &ctx));
    }

    // ── causal-order ──────────────────────────────────────────────

    #[test]
    fn causal_order_accepts_a_real_ancestor() {
        let a = event("a", vec![], serde_json::json!({}));
        let b = event("b", vec!["a"], serde_json::json!({}));
        let c = event("c", vec!["b"], serde_json::json!({}));
        let events: Vec<&Event> = vec![&a, &b, &c];
        let ctx = EvaluationContext { ordered_events: Some(&events), ..Default::default() };
        assert!(eval_causal_order("a", "c", &ctx));
    }

    #[test]
    fn causal_order_rejects_a_non_ancestor() {
        let a = event("a", vec![], serde_json::json!({}));
        let b = event("b", vec![], serde_json::json!({}));
        let events: Vec<&Event> = vec![&a, &b];
        let ctx = EvaluationContext { ordered_events: Some(&events), ..Default::default() };
        assert!(!eval_causal_order("a", "b", &ctx));
    }

    #[test]
    fn causal_order_works_through_a_merged_multi_parent_shape() {
        let a = event("a", vec![], serde_json::json!({}));
        let b = event("b", vec![], serde_json::json!({}));
        let merged = event("merge", vec!["a", "b"], serde_json::json!({}));
        let events: Vec<&Event> = vec![&a, &b, &merged];
        let ctx = EvaluationContext { ordered_events: Some(&events), ..Default::default() };
        assert!(eval_causal_order("a", "merge", &ctx));
        assert!(eval_causal_order("b", "merge", &ctx));
    }

    // ── signature ─────────────────────────────────────────────────

    #[test]
    fn signature_accepts_a_real_valid_signature_matching_expected_domain() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let pubkey_bytes = signing_key.verifying_key().to_bytes();
        let message = "hello";
        let signature = signing_key.sign(message.as_bytes());
        let expected_domain = derive_domain_id(&pubkey_bytes);

        assert!(eval_signature(message, &to_hex(&pubkey_bytes), &to_hex(&signature.to_bytes()), &expected_domain));
    }

    #[test]
    fn security_signature_rejects_a_signature_over_a_different_message() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let pubkey_bytes = signing_key.verifying_key().to_bytes();
        let signature = signing_key.sign(b"real message");
        let expected_domain = derive_domain_id(&pubkey_bytes);

        assert!(!eval_signature("forged message", &to_hex(&pubkey_bytes), &to_hex(&signature.to_bytes()), &expected_domain));
    }

    #[test]
    fn security_signature_rejects_wrong_expected_domain() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let pubkey_bytes = signing_key.verifying_key().to_bytes();
        let message = "hello";
        let signature = signing_key.sign(message.as_bytes());

        assert!(!eval_signature(message, &to_hex(&pubkey_bytes), &to_hex(&signature.to_bytes()), "not-the-real-domain"));
    }

    // ── composition ───────────────────────────────────────────────

    #[test]
    fn all_accepted_only_when_every_sub_condition_is_accepted() {
        let mut used = HashSet::new();
        used.insert("b".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        let cond = Condition::All(vec![Condition::Unique { key: "a".to_string() }, Condition::Unique { key: "b".to_string() }]);
        assert!(!evaluate_condition(&cond, &ctx));
    }

    #[test]
    fn any_accepted_when_at_least_one_sub_condition_is_accepted() {
        let mut used = HashSet::new();
        used.insert("a".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        let cond = Condition::Any(vec![Condition::Unique { key: "a".to_string() }, Condition::Unique { key: "b".to_string() }]);
        assert!(evaluate_condition(&cond, &ctx));
    }

    #[test]
    fn not_inverts_the_inner_condition() {
        let mut used = HashSet::new();
        used.insert("a".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        let cond = Condition::Not(Box::new(Condition::Unique { key: "a".to_string() }));
        assert!(evaluate_condition(&cond, &ctx));
    }

    #[test]
    fn nested_composition_evaluates_correctly() {
        let mut used = HashSet::new();
        used.insert("taken".to_string());
        let ctx = EvaluationContext { used_keys: Some(&used), ..Default::default() };
        let cond = Condition::All(vec![
            Condition::Any(vec![Condition::Unique { key: "taken".to_string() }, Condition::Unique { key: "free".to_string() }]),
            Condition::Not(Box::new(Condition::Unique { key: "taken".to_string() })),
        ]);
        assert!(evaluate_condition(&cond, &ctx));
    }
}
