use crate::economics::cadence::CadenceState;
use crate::economics::reward::{reward, RewardParams};
use crate::identity::IdentityCostState;

/// The module list's sort key — reuses the real reward() function
/// directly. Mirror of computeModuleRank() in module-rank.js. Uses
/// epochs_elapsed as both q and q_total (see rank_from_identity_and_cadence's
/// documented simplification below), patience rate 0.
pub fn compute_module_rank(burned_lamports: f64, epochs_elapsed: f64, reward_params: RewardParams) -> f64 {
    reward(burned_lamports, epochs_elapsed, epochs_elapsed, 0.0, reward_params).unwrap_or(0.0)
}

/// Mirror of rankFromIdentityAndCadence() in module-rank.js — found
/// missing entirely during a direct, systematic JS-vs-Rust sweep, not
/// by anyone specifically asking for this one function. A real
/// capability gap, not itself a new security check: composes two
/// already-correct pieces (a domain's real registered burn, and its
/// real current cadence epoch) that were already independently
/// mirrored; this function's own logic is a thin composition, not new
/// verification. Returns 0 for a domain with no registered identity
/// cost, matching the JS mirror's own explicit default rather than
/// panicking on a missing entry.
pub fn rank_from_identity_and_cadence(identity_state: &IdentityCostState, cadence_state: &CadenceState, domain: &str, reward_params: RewardParams) -> f64 {
    let Some(identity) = identity_state.registered.get(domain) else { return 0.0 };
    let current_epoch = cadence_state.domains.get(domain).map(|d| d.epoch as f64).unwrap_or(0.0);
    compute_module_rank(identity.burned_lamports as f64, current_epoch, reward_params)
}

#[derive(Debug, Clone, Copy)]
pub struct LastSubmission {
    pub rank: f64,
    pub epochs_elapsed: f64,
}

#[derive(Debug, PartialEq)]
pub struct EligibilityResult {
    pub eligible: bool,
    pub reason: Option<String>,
}

/// Mirror of checkSubmissionEligibility() in module-rank.js: the ratio
/// test from a real reference implementation's checkScoreEligibility,
/// using this project's cadence epochs as both q and "laps" — one
/// elapsed-time measure, not two to keep in sync.
pub fn check_submission_eligibility(new_rank: f64, new_epochs_elapsed: f64, last_submission: Option<LastSubmission>) -> EligibilityResult {
    let Some(last) = last_submission else {
        return EligibilityResult { eligible: true, reason: None };
    };
    let last_ratio = (last.rank + 1.0) / (last.epochs_elapsed + 1.0);
    let new_ratio = (new_rank + 1.0) / (new_epochs_elapsed + 1.0);
    if new_ratio < last_ratio {
        return EligibilityResult {
            eligible: false,
            reason: Some(format!(
                "ratio {new_ratio:.6} is lower than your last submission's {last_ratio:.6} — score must not decline to register a new module id"
            )),
        };
    }
    EligibilityResult { eligible: true, reason: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theta() -> RewardParams {
        RewardParams { alpha: 1.0, beta: 0.0, gamma: 1.0, c: std::f64::consts::E - 1.0, min_q: 1.0 }
    }

    #[test]
    fn compute_module_rank_reuses_real_reward_formula() {
        assert_eq!(compute_module_rank(100.0, 5.0, theta()), 500.0);
    }

    #[test]
    fn rank_from_identity_and_cadence_returns_zero_for_a_domain_with_no_registered_identity_cost() {
        let identity_state = IdentityCostState::new();
        let cadence_state = CadenceState::new();
        assert_eq!(rank_from_identity_and_cadence(&identity_state, &cadence_state, "earth", theta()), 0.0);
    }

    #[test]
    fn rank_from_identity_and_cadence_combines_a_domains_real_burn_and_current_epoch() {
        let mut identity_state = IdentityCostState::new();
        identity_state.registered.insert(
            "earth".to_string(),
            crate::identity::RegisteredIdentity { domain: "earth".to_string(), signature: "sig1".to_string(), burned_lamports: 500, registered_at: 0, slot: None },
        );
        let mut cadence_state = CadenceState::new();
        cadence_state.domains.insert("earth".to_string(), crate::economics::cadence::DomainCadenceState { epoch: 4, last_id: Some("x".to_string()), vdf_output: None });
        // Same as compute_module_rank(500, 4, theta()) = 500 * 4 = 2000
        assert_eq!(rank_from_identity_and_cadence(&identity_state, &cadence_state, "earth", theta()), 2000.0);
    }

    #[test]
    fn rank_is_zero_with_zero_elapsed_epochs() {
        assert_eq!(compute_module_rank(1_000_000.0, 0.0, theta()), 0.0);
    }

    #[test]
    fn first_submission_always_eligible() {
        let check = check_submission_eligibility(1.0, 1.0, None);
        assert!(check.eligible);
    }

    #[test]
    fn improved_ratio_is_eligible() {
        let last = LastSubmission { rank: 100.0, epochs_elapsed: 10.0 };
        let check = check_submission_eligibility(200.0, 10.0, Some(last));
        assert!(check.eligible);
    }

    #[test]
    fn declined_ratio_is_rejected() {
        let last = LastSubmission { rank: 1000.0, epochs_elapsed: 10.0 };
        let check = check_submission_eligibility(1.0, 10.0, Some(last));
        assert!(!check.eligible);
    }

    #[test]
    fn equal_ratio_is_eligible() {
        let last = LastSubmission { rank: 100.0, epochs_elapsed: 10.0 };
        let check = check_submission_eligibility(100.0, 10.0, Some(last));
        assert!(check.eligible);
    }

    #[test]
    fn larger_burn_ranks_higher_at_equal_age() {
        assert!(compute_module_rank(10_000.0, 10.0, theta()) > compute_module_rank(100.0, 10.0, theta()));
    }

    #[test]
    fn same_burn_aged_longer_ranks_higher() {
        assert!(compute_module_rank(1000.0, 20.0, theta()) > compute_module_rank(1000.0, 2.0, theta()));
    }
}
