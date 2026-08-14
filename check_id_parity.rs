use std::collections::{BTreeMap, HashMap};

/// Per-domain scarcity state: cumulative used issuance and its budget
/// (None = unbounded / Policy A control case).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DomainScarcityState {
    pub used: f64,
    pub budget: Option<f64>,
}

/// Scarcity state across all domains. Mirror of ScarcityState in
/// public/js/core/economics/scarcity.js.
#[derive(Debug, Clone, Default)]
pub struct ScarcityState {
    pub domains: HashMap<String, DomainScarcityState>,
    pub total_issuance: f64,
}

impl ScarcityState {
    pub fn new(domain_budgets: &[(&str, Option<f64>)]) -> Self {
        let mut domains = HashMap::new();
        for (name, budget) in domain_budgets {
            domains.insert(name.to_string(), DomainScarcityState { used: 0.0, budget: *budget });
        }
        ScarcityState { domains, total_issuance: 0.0 }
    }

    /// Attempts to issue `amount` for `domain`. Clamped to the domain's
    /// remaining budget if it has one; unclamped if its budget is None.
    /// Returns the amount actually issued — mirrors
    /// applyIssuanceAttempt() in scarcity.js, including its exact
    /// clamping logic from Appendix H.4's reference simulation.
    pub fn apply_issuance_attempt(&mut self, domain: &str, amount: f64) -> f64 {
        let current = self
            .domains
            .entry(domain.to_string())
            .or_insert(DomainScarcityState { used: 0.0, budget: None });

        let issued = match current.budget {
            None => amount,
            Some(budget) => {
                let remaining = budget - current.used;
                amount.min(remaining).max(0.0)
            }
        };

        current.used += issued;
        self.total_issuance += issued;
        issued
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub total: f64,
    pub per_domain: BTreeMap<String, f64>,
}

/// Domain configuration for the hourly issuance simulation, per
/// Appendix H.4: an issuance rate `rho` per hour and an optional budget.
pub struct DomainConfig<'a> {
    pub name: &'a str,
    pub rho: f64,
    pub budget: Option<f64>,
}

/// Reproduces Appendix H.4's simulation loop generically. Mirror of
/// simulateHourlyIssuance() in scarcity.js.
pub fn simulate_hourly_issuance(
    domains: &[DomainConfig],
    hours: u64,
    snapshot_hours: &[u64],
) -> BTreeMap<u64, Snapshot> {
    let budgets: Vec<(&str, Option<f64>)> = domains.iter().map(|d| (d.name, d.budget)).collect();
    let mut state = ScarcityState::new(&budgets);
    let snapshot_set: std::collections::HashSet<u64> = snapshot_hours.iter().copied().collect();
    let mut snapshots = BTreeMap::new();

    for hour in 1..=hours {
        for d in domains {
            state.apply_issuance_attempt(d.name, d.rho);
        }
        if snapshot_set.contains(&hour) {
            let per_domain: BTreeMap<String, f64> = domains
                .iter()
                .map(|d| (d.name.to_string(), state.domains[d.name].used))
                .collect();
            snapshots.insert(hour, Snapshot { total: state.total_issuance, per_domain });
        }
    }
    snapshots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unbounded_issuance_never_clamps() {
        let mut state = ScarcityState::new(&[("d1", None)]);
        let issued = state.apply_issuance_attempt("d1", 1.0);
        assert_eq!(issued, 1.0);
        assert_eq!(state.domains["d1"].used, 1.0);
    }

    #[test]
    fn budget_clamps_once_exhausted() {
        let mut state = ScarcityState::new(&[("d1", Some(2.5))]);
        assert_eq!(state.apply_issuance_attempt("d1", 1.0), 1.0);
        assert_eq!(state.apply_issuance_attempt("d1", 1.0), 1.0);
        assert_eq!(state.apply_issuance_attempt("d1", 1.0), 0.5); // clamped
        assert_eq!(state.apply_issuance_attempt("d1", 1.0), 0.0); // exhausted
        assert_eq!(state.domains["d1"].used, 2.5);
        assert_eq!(state.total_issuance, 2.5);
    }

    #[test]
    fn appendix_d1_unbounded_policy_matches_paper_numbers() {
        // Appendix D.1: "With rho_E = rho_M = 1 unit/hour: after T=1000h,
        // I_global=2000; after T=10000h, I_global=20000."
        let domains = [
            DomainConfig { name: "E", rho: 1.0, budget: None },
            DomainConfig { name: "M", rho: 1.0, budget: None },
        ];
        let snaps = simulate_hourly_issuance(&domains, 10_000, &[1000, 10_000]);

        assert_eq!(snaps[&1000].total, 2000.0);
        assert_eq!(snaps[&10_000].total, 20_000.0);
    }

    #[test]
    fn appendix_d1_and_h4_preallocated_budget_policy_matches_paper_numbers() {
        // Appendix D.1 / H.4 Policy B: "With B_E = B_M = 5000, I_global <=
        // 10000 — but once one domain exhausts its allocation, autonomous
        // issuance from that domain stops."
        let domains = [
            DomainConfig { name: "E", rho: 1.0, budget: Some(5000.0) },
            DomainConfig { name: "M", rho: 1.0, budget: Some(5000.0) },
        ];
        let snaps = simulate_hourly_issuance(&domains, 100_000, &[1000, 10_000, 50_000, 100_000]);

        // Before exhaustion (hour 1000 < budget 5000), behaves exactly
        // like the unbounded case.
        assert_eq!(snaps[&1000].total, 2000.0);
        // After exhaustion (hour 10000 > budget 5000 per domain), total
        // saturates at the combined budget and stays there — this is the
        // steady state the paper's I(T) <= 10000 bound describes.
        assert_eq!(snaps[&10_000].total, 10_000.0);
        assert_eq!(snaps[&50_000].total, 10_000.0);
        assert_eq!(snaps[&100_000].total, 10_000.0);
        assert_eq!(snaps[&100_000].per_domain["E"], 5000.0);
        assert_eq!(snaps[&100_000].per_domain["M"], 5000.0);
    }

    #[test]
    fn one_domain_exhausting_does_not_stop_the_other() {
        // §13.1's trade-off stated precisely: exhaustion is per-domain,
        // autonomy is per-domain, so one domain running out must not
        // affect another domain's still-remaining budget.
        let domains = [
            DomainConfig { name: "fast", rho: 10.0, budget: Some(50.0) }, // exhausts at hour 5
            DomainConfig { name: "slow", rho: 1.0, budget: Some(50.0) },  // still has budget left
        ];
        let snaps = simulate_hourly_issuance(&domains, 20, &[20]);

        assert_eq!(snaps[&20].per_domain["fast"], 50.0); // exhausted, capped
        assert_eq!(snaps[&20].per_domain["slow"], 20.0); // unaffected, still accruing
    }
}
