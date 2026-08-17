use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::economics::cadence_vdf::{verify_vdf_chain, vdf_seed};
use crate::event::Event;

/// Per-domain cadence state: current epoch, the id of the last
/// accepted cadence event (causal chaining / replay- and fork-
/// protection), and the last accepted event's own real vdf_output —
/// the next epoch's VDF chain seeds from THIS value, per R11 below.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainCadenceState {
    pub epoch: u64,
    pub last_id: Option<String>,
    pub vdf_output: Option<String>,
}

impl Default for DomainCadenceState {
    fn default() -> Self {
        DomainCadenceState { epoch: 0, last_id: None, vdf_output: None }
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
/// of CadenceState in public/js/core/economics/cadence.js. Closes R11
/// (§17's matrix — "cadence integrity remains an unverified
/// dependency") — see cadence.js's own header for the full account of
/// how this was found and why a mandatory heartbeat alone never
/// addressed it.
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
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    epoch: Option<i64>,
    #[serde(default, rename = "vdfIterations")]
    vdf_iterations: Option<u64>,
    #[serde(default, rename = "vdfOutput")]
    vdf_output: Option<String>,
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
    /// *transitions* (wrong epoch, wrong causal parent, invalid or
    /// missing VDF proof) are rejected and recorded rather than causing
    /// an error — mirrors applyCadenceEvent() in cadence.js exactly.
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

        // SECURITY/CORRECTNESS: a real, previously-dormant bug — the
        // original `.entry(domain).or_default()` reads the map, but as
        // a documented side effect of Rust's Entry API, ALSO inserts a
        // default entry immediately, even if this transition is then
        // rejected and the function returns early. No test before now
        // ever checked `domains.get(domain).is_none()` after a
        // rejection occurring past this line, so a "rejected" domain
        // could still silently appear in the map with a zombie
        // epoch:0 entry. `.get(...).cloned().unwrap_or_default()` is a
        // pure, non-mutating read — nothing is written to the map
        // unless the transition is genuinely accepted below.
        let current = self.domains.get(&domain).cloned().unwrap_or_default();

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

        // R11: bounds the RATE of advancement, not just its shape. The
        // seed depends on the PREVIOUS epoch's own real vdf_output (or
        // "genesis" for epoch 1), so epoch N's chain cannot even begin
        // — let alone be precomputed — until epoch N-1's chain has
        // genuinely finished. See cadence_vdf.rs's own header.
        let iterations = match payload.vdf_iterations {
            Some(n) if n >= 1 => n,
            _ => {
                self.reject(&event.id, &domain, "vdfIterations must be a positive integer");
                return;
            }
        };
        let claimed_output = match &payload.vdf_output {
            Some(o) => o.clone(),
            None => {
                self.reject(&event.id, &domain, "missing vdfOutput");
                return;
            }
        };
        let seed = vdf_seed(&domain, current.vdf_output.as_deref().unwrap_or("genesis"));
        if !verify_vdf_chain(&seed, iterations, &claimed_output) {
            self.reject(
                &event.id,
                &domain,
                "cadence VDF proof does not verify against the real, recomputed sequential hash chain for this domain and epoch position",
            );
            return;
        }

        self.domains.insert(
            domain,
            DomainCadenceState { epoch, last_id: Some(event.id.clone()), vdf_output: Some(claimed_output) },
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
    use crate::economics::cadence_vdf::compute_vdf_chain;

    const TEST_VDF_ITERATIONS: u64 = 50;

    /// Builds a real, verifiable cadence event payload — the Rust
    /// mirror of tests/helpers/cadence-vdf-helper.mjs's cadencePayload().
    fn cadence_event(id: &str, parents: Vec<String>, domain: &str, epoch: i64, previous_vdf_output: Option<&str>) -> Event {
        let seed = vdf_seed(domain, previous_vdf_output.unwrap_or("genesis"));
        let vdf_output = compute_vdf_chain(&seed, TEST_VDF_ITERATIONS);
        Event {
            id: id.to_string(),
            parents,
            payload: serde_json::json!({
                "type": "cadence", "domain": domain, "epoch": epoch,
                "vdfIterations": TEST_VDF_ITERATIONS, "vdfOutput": vdf_output,
            }),
        }
    }

    fn vdf_output_of(event: &Event) -> String {
        event.payload["vdfOutput"].as_str().unwrap().to_string()
    }

    #[test]
    fn first_cadence_transition_is_accepted() {
        let mut state = CadenceState::new();
        let e = cadence_event("c1", vec![], "d1", 1, None);
        let expected_vdf = vdf_output_of(&e);
        state.apply_event(&e);

        assert_eq!(
            state.domains["d1"],
            DomainCadenceState { epoch: 1, last_id: Some("c1".to_string()), vdf_output: Some(expected_vdf) }
        );
        assert!(state.rejections.is_empty());
    }

    #[test]
    fn skipping_an_epoch_is_rejected() {
        let mut state = CadenceState::new();
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&c1);
        state.apply_event(&cadence_event("c2", vec!["c1".to_string()], "d1", 3, Some(&c1_vdf))); // skip 2

        assert_eq!(state.domains["d1"].epoch, 1); // unchanged
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn transition_not_chained_to_last_accepted_is_rejected() {
        let mut state = CadenceState::new();
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&c1);
        // c2 claims epoch 2 but doesn't reference c1 as a parent.
        state.apply_event(&cadence_event("c2", vec![], "d1", 2, Some(&c1_vdf)));

        assert_eq!(state.domains["d1"].epoch, 1);
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn forked_competing_transition_at_same_epoch_is_rejected() {
        let mut state = CadenceState::new();
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&c1);
        state.apply_event(&cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        // c2b also claims epoch 2, chained from c1 — a fork attempt.
        state.apply_event(&cadence_event("c2b", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));

        assert_eq!(state.domains["d1"].last_id, Some("c2".to_string()));
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn independent_domains_advance_independently() {
        let mut state = CadenceState::new();
        let a1 = cadence_event("a1", vec![], "domain-a", 1, None);
        let a1_vdf = vdf_output_of(&a1);
        state.apply_event(&a1);
        state.apply_event(&cadence_event("b1", vec![], "domain-b", 1, None));
        state.apply_event(&cadence_event("a2", vec!["a1".to_string()], "domain-a", 2, Some(&a1_vdf)));

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
        let a1 = cadence_event("a1", vec![], "domain-a", 1, None);
        let a1_vdf = vdf_output_of(&a1);
        let a2 = cadence_event("a2", vec!["a1".to_string()], "domain-a", 2, Some(&a1_vdf));
        let b1 = cadence_event("b1", vec![], "domain-b", 1, None);
        let b1_vdf = vdf_output_of(&b1);
        let b2 = cadence_event("b2", vec!["b1".to_string()], "domain-b", 2, Some(&b1_vdf));

        let order1 = CadenceState::materialize(&[&a1, &b1, &a2, &b2]);
        let order2 = CadenceState::materialize(&[&b1, &a1, &b2, &a2]);

        assert_eq!(order1.domains, order2.domains);
        assert!(order1.rejections.is_empty());
        assert!(order2.rejections.is_empty());
    }

    #[test]
    fn invalid_domain_and_epoch_shapes_are_rejected_without_panicking() {
        let mut state = CadenceState::new();
        state.apply_event(&cadence_event("x1", vec![], "", 1, None));
        state.apply_event(&cadence_event("x2", vec![], "d1", 0, None));
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

    // ── R11: cadence VDF (closes the rate-of-advancement gap a
    // mandatory heartbeat alone never addressed) ────────────────────

    #[test]
    fn security_r11_a_cadence_transition_with_no_vdf_proof_at_all_is_rejected() {
        let mut state = CadenceState::new();
        let e = Event {
            id: "c1".to_string(), parents: vec![],
            payload: serde_json::json!({ "type": "cadence", "domain": "d1", "epoch": 1 }),
        };
        state.apply_event(&e);
        assert!(state.domains.get("d1").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_r11_a_fabricated_vdf_output_is_rejected() {
        let mut state = CadenceState::new();
        let e = Event {
            id: "c1".to_string(), parents: vec![],
            payload: serde_json::json!({
                "type": "cadence", "domain": "d1", "epoch": 1,
                "vdfIterations": TEST_VDF_ITERATIONS, "vdfOutput": "0".repeat(64),
            }),
        };
        state.apply_event(&e);
        assert!(state.domains.get("d1").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_r11_a_real_chain_for_fewer_iterations_than_claimed_is_rejected() {
        let mut state = CadenceState::new();
        let short_output = compute_vdf_chain(&vdf_seed("d1", "genesis"), TEST_VDF_ITERATIONS);
        let e = Event {
            id: "c1".to_string(), parents: vec![],
            payload: serde_json::json!({
                "type": "cadence", "domain": "d1", "epoch": 1,
                "vdfIterations": TEST_VDF_ITERATIONS * 100, "vdfOutput": short_output,
            }),
        };
        state.apply_event(&e);
        assert!(state.domains.get("d1").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn security_r11_epoch_2_depends_on_epoch_1_real_output() {
        let mut state = CadenceState::new();
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&c1);

        // A "epoch 2" proof computed against the WRONG previous output.
        let wrong_previous_output = compute_vdf_chain(&vdf_seed("d1", "a-guessed-or-wrong-previous-output"), TEST_VDF_ITERATIONS);
        let forged = Event {
            id: "c2-forged".to_string(), parents: vec!["c1".to_string()],
            payload: serde_json::json!({
                "type": "cadence", "domain": "d1", "epoch": 2,
                "vdfIterations": TEST_VDF_ITERATIONS, "vdfOutput": wrong_previous_output,
            }),
        };
        let mut forged_state = state.clone();
        forged_state.apply_event(&forged);
        assert_eq!(forged_state.domains["d1"].epoch, 1, "the forged epoch-2 attempt must not be accepted");
        assert_eq!(forged_state.rejections.len(), 1);

        // The REAL epoch 2, chained to the actual epoch 1 output, is accepted.
        let real = cadence_event("c2-real", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf));
        state.apply_event(&real);
        assert_eq!(state.domains["d1"].epoch, 2);
        assert_eq!(state.rejections.len(), 0);
    }

    #[test]
    fn security_r11_a_vdf_proof_for_a_different_domain_cannot_be_reused() {
        let mut state = CadenceState::new();
        let alice_output = compute_vdf_chain(&vdf_seed("alice", "genesis"), TEST_VDF_ITERATIONS);
        let e = Event {
            id: "c1".to_string(), parents: vec![],
            payload: serde_json::json!({
                "type": "cadence", "domain": "bob", "epoch": 1,
                "vdfIterations": TEST_VDF_ITERATIONS, "vdfOutput": alice_output,
            }),
        };
        state.apply_event(&e);
        assert!(state.domains.get("bob").is_none());
        assert_eq!(state.rejections.len(), 1);
    }

    #[test]
    fn a_real_honestly_computed_sequence_of_several_epochs_is_accepted_end_to_end() {
        let mut state = CadenceState::new();
        let mut previous_output: Option<String> = None;
        for epoch in 1..=5 {
            let parent = if epoch == 1 { vec![] } else { vec![format!("c{}", epoch - 1)] };
            let e = cadence_event(&format!("c{epoch}"), parent, "d1", epoch, previous_output.as_deref());
            previous_output = Some(vdf_output_of(&e));
            state.apply_event(&e);
        }
        assert_eq!(state.domains["d1"].epoch, 5);
        assert_eq!(state.rejections.len(), 0);
    }
}
