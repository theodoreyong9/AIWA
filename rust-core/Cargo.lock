use crate::economics::cadence::CadenceState;

/// Deployment-chosen constants for the reward function, per §10.
#[derive(Debug, Clone, Copy)]
pub struct RewardParams {
    pub k: f64,
    pub alpha: f64,
    pub beta: f64,
}

#[derive(Debug, PartialEq)]
pub struct RewardError(pub String);

/// Pure reward function r(b, q) = K · b^α · q^β. Mirror of reward() in
/// public/js/core/economics/reward.js — see that file for the full
/// rationale (q is cadence-epoch elapsed time, Definition 10.1, never a
/// wall clock).
///
/// b and q must be finite and >= 0. 0^0 = 1 by convention (both f64::powf
/// and JS's `**` agree on this), so no special case is needed to keep the
/// two implementations aligned.
pub fn reward(b: f64, q: f64, params: RewardParams) -> Result<f64, RewardError> {
    if !b.is_finite() || b < 0.0 {
        return Err(RewardError(format!("b must be a finite number >= 0, got {b}")));
    }
    if !q.is_finite() || q < 0.0 {
        return Err(RewardError(format!("q must be a finite number >= 0, got {q}")));
    }
    if !params.k.is_finite() || !params.alpha.is_finite() || !params.beta.is_finite() {
        return Err(RewardError("K, alpha, and beta must all be finite numbers".to_string()));
    }

    Ok(params.k * b.powf(params.alpha) * q.powf(params.beta))
}

/// Derives q (elapsed economic epochs, Definition 10.1) for an accrual
/// event from the domain's current cadence state and the event's
/// acceptance epoch q_0. Never negative — an event cannot have negative
/// economic age.
pub fn elapsed_epochs(cadence_state: &CadenceState, domain: &str, q0: u64) -> u64 {
    let current_epoch = cadence_state.domains.get(domain).map(|d| d.epoch).unwrap_or(0);
    current_epoch.saturating_sub(q0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economics::cadence::DomainCadenceState;

    fn params(k: f64, alpha: f64, beta: f64) -> RewardParams {
        RewardParams { k, alpha, beta }
    }

    #[test]
    fn matches_hand_computed_value() {
        // r = 2 * 3^2 * 4^1 = 2 * 9 * 4 = 72
        let r = reward(3.0, 4.0, params(2.0, 2.0, 1.0)).unwrap();
        assert!((r - 72.0).abs() < 1e-9);
    }

    #[test]
    fn cross_checked_against_appendix_d2_magnitude() {
        // Appendix D.2: K=1, B=1000, t=1, alpha=0.5 -> K*B^alpha*t^beta
        // reduces to 1000^0.5 regardless of beta since t=1. The paper
        // reports this intermediate value as ~31.6227766 (used inside
        // its N* formula, not r itself, but the sub-expression is
        // identical to our r(b, q) with q=t=1).
        let r = reward(1000.0, 1.0, params(1.0, 0.5, 0.7)).unwrap();
        assert!((r - 1000f64.powf(0.5)).abs() < 1e-9);
        assert!((r - 31.6227766).abs() < 1e-6);
    }

    #[test]
    fn zero_elapsed_epochs_yields_zero_reward_when_beta_positive() {
        let r = reward(10.0, 0.0, params(5.0, 1.0, 1.0)).unwrap();
        assert_eq!(r, 0.0);
    }

    #[test]
    fn zero_elapsed_epochs_with_beta_zero_yields_base_reward() {
        // Time-insensitive reward per §11: r(b) = K * b^alpha when beta=0,
        // since q^0 = 1 for any q >= 0, including q = 0.
        let r = reward(10.0, 0.0, params(5.0, 1.0, 0.0)).unwrap();
        assert_eq!(r, 50.0);
    }

    #[test]
    fn negative_b_is_rejected() {
        assert!(reward(-1.0, 1.0, params(1.0, 1.0, 1.0)).is_err());
    }

    #[test]
    fn negative_q_is_rejected() {
        assert!(reward(1.0, -1.0, params(1.0, 1.0, 1.0)).is_err());
    }

    #[test]
    fn non_finite_params_are_rejected() {
        assert!(reward(1.0, 1.0, params(f64::NAN, 1.0, 1.0)).is_err());
        assert!(reward(1.0, 1.0, params(1.0, f64::INFINITY, 1.0)).is_err());
    }

    #[test]
    fn elapsed_epochs_reads_current_domain_epoch() {
        let mut state = CadenceState::new();
        state.domains.insert(
            "d1".to_string(),
            DomainCadenceState { epoch: 7, last_id: Some("c7".to_string()) },
        );
        assert_eq!(elapsed_epochs(&state, "d1", 3), 4);
    }

    #[test]
    fn elapsed_epochs_never_goes_negative() {
        let mut state = CadenceState::new();
        state.domains.insert(
            "d1".to_string(),
            DomainCadenceState { epoch: 2, last_id: Some("c2".to_string()) },
        );
        // q0 = 5 is "in the future" relative to current epoch 2.
        assert_eq!(elapsed_epochs(&state, "d1", 5), 0);
    }

    #[test]
    fn elapsed_epochs_for_unknown_domain_is_zero() {
        let state = CadenceState::new();
        assert_eq!(elapsed_epochs(&state, "unknown", 0), 0);
    }
}
