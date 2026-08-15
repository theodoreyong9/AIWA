use crate::economics::reward::{reward, RewardParams};

/// The module list's sort key — reuses the real reward() function
/// directly. Mirror of computeModuleRank() in module-rank.js. Uses
/// epochs_elapsed as both q and q_total (see rankFromIdentityAndCadence's
/// documented simplification in module-rank.js), patience rate 0.
pub fn compute_module_rank(burned_lamports: f64, epochs_elapsed: f64, reward_params: RewardParams) -> f64 {
    reward(burned_lamports, epochs_elapsed, epochs_elapsed, 0.0, reward_params).unwrap_or(0.0)
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
