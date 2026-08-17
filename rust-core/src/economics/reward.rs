use crate::economics::cadence::CadenceState;

/// Deployment-chosen constants for the reward function — mirror of
/// RewardParams in reward.js. See that file's header for the full
/// rationale: this is the real Proof-of-Will formula the project's
/// reference implementation uses, not the earlier power-law form.
#[derive(Debug, Clone, Copy)]
pub struct RewardParams {
    pub alpha: f64,
    pub beta: f64,
    pub gamma: f64,
    pub c: f64,
    pub min_q: f64,
}

#[derive(Debug, PartialEq)]
pub struct RewardError(pub String);

/// Pure reward function, standard form:
///
///   r(b, q, q_total, T) = (b · q^α) / [ln(q_total^(β(1−T)) + C)]^γ
///
/// Mirror of reward() in public/js/core/economics/reward.js — see that
/// file's header for the two deliberate adaptations from the original
/// formula (q_total is domain-local, not a shared global "protocol
/// age"; min_q replaces a Solana-slot-specific minimum wait with a
/// deployment-chosen epoch count).
pub fn reward(b: f64, q: f64, q_total: f64, patience_rate: f64, params: RewardParams) -> Result<f64, RewardError> {
    if !b.is_finite() || b < 0.0 {
        return Err(RewardError(format!("b must be a finite number >= 0, got {b}")));
    }
    if !q.is_finite() || q < 0.0 {
        return Err(RewardError(format!("q must be a finite number >= 0, got {q}")));
    }
    if !q_total.is_finite() || q_total < 0.0 {
        return Err(RewardError(format!("q_total must be a finite number >= 0, got {q_total}")));
    }
    if ![params.alpha, params.beta, params.gamma, params.c, params.min_q].iter().all(|v| v.is_finite()) {
        return Err(RewardError("alpha, beta, gamma, C, and min_q must all be finite numbers".to_string()));
    }

    if q < params.min_q {
        return Ok(0.0);
    }

    let t = patience_rate.max(0.0).min(0.4);
    let eff_q = q.max(1.0);
    let eff_q_total = q_total.max(1.0);

    let numerator = eff_q.powf(params.alpha) * b;
    let inner = eff_q_total.powf(params.beta * (1.0 - t)) + params.c;
    if inner <= 1.0 {
        return Ok(0.0);
    }

    let denominator = inner.ln().powf(params.gamma);
    if !(denominator > 0.0) || !denominator.is_finite() || !numerator.is_finite() {
        return Ok(0.0);
    }

    let r = numerator / denominator;
    if r < 0.0 || !r.is_finite() || r > 1e12 {
        return Ok(0.0);
    }
    Ok(r)
}

/// Derives q (elapsed economic epochs, Definition 10.1) for an accrual
/// event from the domain's current cadence state and the event's
/// acceptance epoch q_0. Unchanged from the prior revision.
pub fn elapsed_epochs(cadence_state: &CadenceState, domain: &str, q0: u64) -> u64 {
    let current_epoch = cadence_state.domains.get(domain).map(|d| d.epoch).unwrap_or(0);
    current_epoch.saturating_sub(q0)
}

/// q_total — this domain's own total cadence epoch count right now, as
/// folded so far. Mirror of domainAge() in reward.js: stands in for
/// the original formula's global "protocol age," deliberately made
/// domain-local.
pub fn domain_age(cadence_state: &CadenceState, domain: &str) -> u64 {
    cadence_state.domains.get(domain).map(|d| d.epoch).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economics::cadence::DomainCadenceState;

    // The real reference implementation's actual constants
    // (mine.js's calcClaimable(): alpha=1.1, beta=2.2, gamma=3, C=33^3).
    fn real_params() -> RewardParams {
        RewardParams { alpha: 1.1, beta: 2.2, gamma: 3.0, c: 33f64.powi(3), min_q: 1.0 }
    }

    #[test]
    fn matches_hand_computed_value_using_real_formula_constants() {
        // b=1, q=100, q_total=100, T=0 — see reward.test.mjs for the
        // independently-verified expected value.
        let r = reward(1.0, 100.0, 100.0, 0.0, real_params()).unwrap();
        assert!((r - 0.11844290947765648).abs() < 1e-9);
    }

    #[test]
    fn larger_b_scales_numerator_linearly() {
        let r1 = reward(1.0, 100.0, 100.0, 0.0, real_params()).unwrap();
        let r10 = reward(10.0, 100.0, 100.0, 0.0, real_params()).unwrap();
        assert!((r10 - r1 * 10.0).abs() < 1e-6);
    }

    #[test]
    fn q_below_min_q_yields_zero_reward() {
        let r = reward(10.0, 0.0, 100.0, 0.0, real_params()).unwrap();
        assert_eq!(r, 0.0);
    }

    #[test]
    fn q_at_or_above_min_q_yields_positive_reward() {
        let r = reward(10.0, 1.0, 1.0, 0.0, real_params()).unwrap();
        assert!(r > 0.0);
    }

    #[test]
    fn higher_patience_rate_changes_the_reward() {
        let r_no_patience = reward(10.0, 100.0, 100.0, 0.0, real_params()).unwrap();
        let r_max_patience = reward(10.0, 100.0, 100.0, 0.4, real_params()).unwrap();
        assert_ne!(r_no_patience, r_max_patience);
    }

    #[test]
    fn patience_rate_clamped_to_0_4() {
        let r_clamped = reward(10.0, 100.0, 100.0, 0.4, real_params()).unwrap();
        let r_overclaimed = reward(10.0, 100.0, 100.0, 0.9, real_params()).unwrap();
        assert_eq!(r_clamped, r_overclaimed);
    }

    #[test]
    fn negative_patience_rate_clamped_to_0() {
        let r_zero = reward(10.0, 100.0, 100.0, 0.0, real_params()).unwrap();
        let r_negative = reward(10.0, 100.0, 100.0, -5.0, real_params()).unwrap();
        assert_eq!(r_zero, r_negative);
    }

    #[test]
    fn negative_b_is_rejected() {
        assert!(reward(-1.0, 1.0, 1.0, 0.0, real_params()).is_err());
    }

    #[test]
    fn negative_q_is_rejected() {
        assert!(reward(1.0, -1.0, 1.0, 0.0, real_params()).is_err());
    }

    #[test]
    fn negative_q_total_is_rejected() {
        assert!(reward(1.0, 1.0, -1.0, 0.0, real_params()).is_err());
    }

    #[test]
    fn non_finite_params_are_rejected() {
        let mut p = real_params();
        p.alpha = f64::NAN;
        assert!(reward(1.0, 1.0, 1.0, 0.0, p).is_err());
        let mut p2 = real_params();
        p2.gamma = f64::INFINITY;
        assert!(reward(1.0, 1.0, 1.0, 0.0, p2).is_err());
    }

    #[test]
    fn reward_never_negative_or_non_finite_for_valid_inputs() {
        let r = reward(1e6, 5000.0, 5000.0, 0.2, real_params()).unwrap();
        assert!(r.is_finite() && r >= 0.0);
    }

    #[test]
    fn elapsed_epochs_reads_current_domain_epoch() {
        let mut state = CadenceState::new();
        state.domains.insert("d1".to_string(), DomainCadenceState { epoch: 7, last_id: Some("c7".to_string()), vdf_output: None });
        assert_eq!(elapsed_epochs(&state, "d1", 3), 4);
    }

    #[test]
    fn elapsed_epochs_never_goes_negative() {
        let mut state = CadenceState::new();
        state.domains.insert("d1".to_string(), DomainCadenceState { epoch: 2, last_id: Some("c2".to_string()), vdf_output: None });
        assert_eq!(elapsed_epochs(&state, "d1", 5), 0);
    }

    #[test]
    fn elapsed_epochs_for_unknown_domain_is_zero() {
        let state = CadenceState::new();
        assert_eq!(elapsed_epochs(&state, "unknown", 0), 0);
    }

    #[test]
    fn domain_age_reads_current_epoch() {
        let mut state = CadenceState::new();
        state.domains.insert("d1".to_string(), DomainCadenceState { epoch: 42, last_id: Some("c42".to_string()), vdf_output: None });
        assert_eq!(domain_age(&state, "d1"), 42);
    }

    #[test]
    fn domain_age_for_unknown_domain_is_zero() {
        let state = CadenceState::new();
        assert_eq!(domain_age(&state, "unknown"), 0);
    }
}
