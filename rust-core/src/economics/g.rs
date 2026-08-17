use std::collections::HashMap;

use serde::Deserialize;

use crate::economics::cadence::CadenceState;
use crate::economics::reward::{domain_age, elapsed_epochs, reward, RewardParams};
use crate::economics::scarcity::ScarcityState;
use crate::event::Event;

/// θ for the composed G: reward constants plus per-domain budgets.
/// Mirror of the `Theta` shape in g.js.
pub struct Theta<'a> {
    pub reward: RewardParams,
    pub budgets: &'a [(&'a str, Option<f64>)],
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccrualRejection {
    pub event_id: String,
    pub domain: Option<String>,
    pub reason: String,
}

/// A = G(H_d, θ). Composition of cadence + reward + scarcity — see
/// g.js's module header for the full rationale, including the Lemma 1
/// (§11) note on why this module needs no identity check of its own as
/// long as accrual payloads carry q0.
#[derive(Debug, Clone, Default)]
pub struct GState {
    pub cadence: CadenceState,
    pub scarcity: ScarcityState,
    pub balances: HashMap<String, f64>,
    pub accrual_rejections: Vec<AccrualRejection>,
}

#[derive(Debug, Deserialize)]
struct AccrualPayload {
    domain: Option<String>,
    b: Option<f64>,
    q0: Option<i64>,
    #[serde(rename = "T")]
    t: Option<f64>,
}

impl GState {
    pub fn new(theta: &Theta) -> Self {
        GState {
            cadence: CadenceState::new(),
            scarcity: ScarcityState::new(theta.budgets),
            balances: HashMap::new(),
            accrual_rejections: Vec::new(),
        }
    }

    fn reject_accrual(&mut self, event_id: &str, domain: Option<String>, reason: impl Into<String>) {
        self.accrual_rejections.push(AccrualRejection {
            event_id: event_id.to_string(),
            domain,
            reason: reason.into(),
        });
    }

    /// Applies one event: delegates to the cadence reducer for
    /// 'cadence' events, computes and (scarcity-clamped) applies reward
    /// for 'accrual' events, and passes through anything else (e.g.
    /// 'genesis') unchanged. T (patience rate) defaults to 0 if absent
    /// from the payload — folded through unchanged and clamped inside
    /// reward() itself, matching the real formula's own behavior.
    pub fn apply_event(&mut self, theta: &Theta, event: &Event) {
        let kind = event.payload.get("type").and_then(|v| v.as_str());
        let Some(kind) = kind else { return };

        if kind == "cadence" {
            self.cadence.apply_event(event);
            return;
        }

        if kind == "claim-issue" {
            // Bridges G's fungible balance to Conservation's claims
            // (§6.1/§7) — mirror of the JS reducer's claim-issue
            // handling. Only debits the balance here; the actual Claim
            // record is created by conservation_bridge's independent
            // fold over the same event.
            #[derive(Deserialize)]
            struct ClaimIssuePayload {
                domain: Option<String>,
                amount: Option<f64>,
            }
            let payload: ClaimIssuePayload = match serde_json::from_value(event.payload.clone()) {
                Ok(p) => p,
                Err(_) => {
                    self.reject_accrual(&event.id, None, "invalid claim-issue payload");
                    return;
                }
            };
            let domain = match payload.domain {
                Some(d) if !d.is_empty() => d,
                _ => {
                    self.reject_accrual(&event.id, None, "invalid claim-issue payload");
                    return;
                }
            };
            let amount = match payload.amount {
                Some(a) if a.is_finite() && a > 0.0 => a,
                _ => {
                    self.reject_accrual(&event.id, Some(domain), "invalid claim-issue payload");
                    return;
                }
            };
            let current_balance = *self.balances.get(&domain).unwrap_or(&0.0);
            if amount > current_balance {
                self.reject_accrual(&event.id, Some(domain), format!("insufficient balance: has {current_balance}, tried to issue claim of {amount}"));
                return;
            }
            self.balances.insert(domain, current_balance - amount);
            return;
        }

        if kind != "accrual" {
            return;
        }

        let payload: AccrualPayload = match serde_json::from_value(event.payload.clone()) {
            Ok(p) => p,
            Err(e) => {
                self.reject_accrual(&event.id, None, format!("malformed accrual payload: {e}"));
                return;
            }
        };

        let domain = match payload.domain {
            Some(d) if !d.is_empty() => d,
            _ => {
                self.reject_accrual(&event.id, None, "missing or invalid domain");
                return;
            }
        };

        let q0 = match payload.q0 {
            Some(v) if v >= 0 => v as u64,
            _ => {
                self.reject_accrual(&event.id, Some(domain), "q0 must be a non-negative integer");
                return;
            }
        };

        let b = match payload.b {
            Some(v) => v,
            None => {
                self.reject_accrual(&event.id, Some(domain), "missing b");
                return;
            }
        };

        let q = elapsed_epochs(&self.cadence, &domain, q0) as f64;
        let q_total = domain_age(&self.cadence, &domain) as f64;
        let patience_rate = payload.t.unwrap_or(0.0);

        let requested = match reward(b, q, q_total, patience_rate, theta.reward) {
            Ok(r) => r,
            Err(e) => {
                self.reject_accrual(&event.id, Some(domain), format!("invalid reward inputs: {}", e.0));
                return;
            }
        };

        let issued = self.scarcity.apply_issuance_attempt(&domain, requested);
        *self.balances.entry(domain).or_insert(0.0) += issued;
    }

    /// A = G(H_d, θ): folds a topologically-ordered event list (e.g.
    /// from EventDagCore::topo_order()).
    pub fn materialize(theta: &Theta, ordered_events: &[&Event]) -> GState {
        let mut state = GState::new(theta);
        for event in ordered_events {
            state.apply_event(theta, event);
        }
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_VDF_ITERATIONS: u64 = 50;

    fn cadence_event(id: &str, parents: Vec<String>, domain: &str, epoch: i64, previous_vdf_output: Option<&str>) -> Event {
        let seed = crate::economics::cadence_vdf::vdf_seed(domain, previous_vdf_output.unwrap_or("genesis"));
        let vdf_output = crate::economics::cadence_vdf::compute_vdf_chain(&seed, TEST_VDF_ITERATIONS);
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
    fn accrual_event(id: &str, parents: Vec<String>, domain: &str, b: f64, q0: i64) -> Event {
        Event {
            id: id.to_string(),
            parents,
            payload: serde_json::json!({ "type": "accrual", "domain": domain, "b": b, "q0": q0, "T": 0.0 }),
        }
    }

    // r = b * max(1,q) with these params — see reward.rs's test module
    // header for why (beta=0 nullifies q_total, c=e-1 makes ln(1+c)=1).
    fn theta<'a>(budgets: &'a [(&'a str, Option<f64>)]) -> Theta<'a> {
        Theta {
            reward: RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 },
            budgets,
        }
    }

    #[test]
    fn accrual_before_any_cadence_advance_yields_zero_reward() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        state.apply_event(&t, &accrual_event("e1", vec![], "d1", 10.0, 0));
        assert_eq!(state.balances.get("d1"), Some(&0.0));
    }

    #[test]
    fn accrual_after_cadence_advance_accrues_proportional_reward() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&t, &c1);
        state.apply_event(&t, &cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        // b=10 at q0=0, current epoch=2 -> q=2 -> r = 10 * max(1,2) = 20
        state.apply_event(&t, &accrual_event("a1", vec!["c2".to_string()], "d1", 10.0, 0));
        assert_eq!(state.balances.get("d1"), Some(&20.0));
    }

    #[test]
    fn scarcity_clamp_applies_to_composed_reward() {
        let budgets = [("d1", Some(15.0))];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&t, &c1);
        state.apply_event(&t, &cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        state.apply_event(&t, &accrual_event("a1", vec!["c2".to_string()], "d1", 10.0, 0));
        assert_eq!(state.balances.get("d1"), Some(&15.0));
        assert_eq!(state.scarcity.domains["d1"].used, 15.0);
    }

    #[test]
    fn malformed_accrual_events_are_rejected_without_panicking() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        state.apply_event(&t, &accrual_event("x1", vec![], "", 10.0, 0));
        state.apply_event(&t, &accrual_event("x2", vec![], "d1", -5.0, 0));
        assert!(state.balances.is_empty());
        assert_eq!(state.accrual_rejections.len(), 2);
    }

    #[test]
    fn genesis_and_other_event_types_pass_through_unchanged() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let e = Event { id: "g1".to_string(), parents: vec![], payload: serde_json::json!({"type": "genesis"}) };
        state.apply_event(&t, &e);
        assert!(state.balances.is_empty());
        assert!(state.accrual_rejections.is_empty());
    }

    #[test]
    fn missing_t_defaults_to_patience_rate_zero() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&t, &c1);
        state.apply_event(&t, &cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        let e = Event {
            id: "a1".to_string(),
            parents: vec!["c2".to_string()],
            payload: serde_json::json!({ "type": "accrual", "domain": "d1", "b": 10.0, "q0": 0 }), // no T field
        };
        state.apply_event(&t, &e);
        assert_eq!(state.balances.get("d1"), Some(&20.0));
    }

    #[test]
    fn claim_issue_debits_balance() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&t, &c1);
        state.apply_event(&t, &cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        state.apply_event(&t, &accrual_event("a1", vec!["c2".to_string()], "d1", 10.0, 0)); // balance = 20
        let e = Event {
            id: "ci1".to_string(),
            parents: vec!["a1".to_string()],
            payload: serde_json::json!({ "type": "claim-issue", "domain": "d1", "id": "claim-1", "amount": 5.0 }),
        };
        state.apply_event(&t, &e);
        assert_eq!(state.balances.get("d1"), Some(&15.0));
    }

    #[test]
    fn claim_issue_beyond_balance_is_rejected_not_clamped() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let mut state = GState::new(&t);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        state.apply_event(&t, &c1);
        state.apply_event(&t, &cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)));
        state.apply_event(&t, &accrual_event("a1", vec!["c2".to_string()], "d1", 10.0, 0)); // balance = 20
        let e = Event {
            id: "ci1".to_string(),
            parents: vec!["a1".to_string()],
            payload: serde_json::json!({ "type": "claim-issue", "domain": "d1", "id": "claim-1", "amount": 999.0 }),
        };
        state.apply_event(&t, &e);
        assert_eq!(state.balances.get("d1"), Some(&20.0));
        assert!(state.accrual_rejections.iter().any(|r| r.event_id == "ci1"));
    }

    #[test]
    fn out_of_causal_order_accrual_sees_the_cadence_state_as_folded_so_far() {
        let budgets = [("d1", None)];
        let t = theta(&budgets);
        let c1 = cadence_event("c1", vec![], "d1", 1, None);
        let c1_vdf = vdf_output_of(&c1);
        let events = vec![
            accrual_event("a1", vec!["c2".to_string()], "d1", 10.0, 0), // fed first, out of order
            c1,
            cadence_event("c2", vec!["c1".to_string()], "d1", 2, Some(&c1_vdf)),
        ];
        let refs: Vec<&Event> = events.iter().collect();
        let state = GState::materialize(&t, &refs);
        assert_eq!(state.balances.get("d1"), Some(&0.0));
    }
}
