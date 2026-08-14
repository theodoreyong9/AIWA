// scarcity.js — scarcity policies over issuance, per §13. This module
// implements the two simplest of the four policies discussed in the
// paper (§13.1 and its "Unbounded" control from Appendix D.1 / H.4):
//
//   - unbounded  (budget = null): no clamp, issuance grows without bound
//     as T -> infinity. This is the control case the paper uses to show
//     what §13.1 is protecting against, not a recommended policy.
//   - preallocated budget (§13.1): B_d(epoch); a domain issues freely
//     until its allocation is exhausted, then stops. Autonomy holds
//     until exhaustion — after that, this specific domain can no longer
//     autonomously issue, which is the trade-off §13.1 states plainly.
//
// Rate limits (§13.2) and expiring rights (§13.3) are out of scope here
// (v2, per the README's development plan).

/**
 * @typedef {{ used: number, budget: number | null }} DomainScarcityState
 * @typedef {{ domains: Record<string, DomainScarcityState>, totalIssuance: number }} ScarcityState
 */

/**
 * @param {Record<string, number | null>} domainBudgets domain name -> budget, or null for unbounded
 * @returns {ScarcityState}
 */
export function initialScarcityState(domainBudgets) {
  const domains = {};
  for (const [name, budget] of Object.entries(domainBudgets)) {
    domains[name] = { used: 0, budget: budget ?? null };
  }
  return { domains, totalIssuance: 0 };
}

/**
 * Attempts to issue `amount` for `domain`. Clamped to the domain's
 * remaining budget if it has one; unclamped (full amount always granted)
 * if its budget is null. Returns the new state and the amount actually
 * issued — the caller (e.g. the reward reducer, once composed in Phase
 * 4) uses `issued`, not the requested `amount`, as the real accrual.
 *
 * Mirrors the exact clamping logic of Appendix H.4's reference Python
 * simulation (`add_e = min(rho_e, budget_e-used_e) if used_e < budget_e
 * else 0.0`), generalized from two hardcoded domains to any number.
 *
 * @param {ScarcityState} state
 * @param {string} domain
 * @param {number} amount
 * @returns {{ state: ScarcityState, issued: number }}
 */
export function applyIssuanceAttempt(state, domain, amount) {
  const current = state.domains[domain] ?? { used: 0, budget: null };
  const remaining = current.budget === null ? Infinity : current.budget - current.used;
  const issued = current.budget === null ? amount : Math.max(0, Math.min(amount, remaining));

  const newState = {
    domains: {
      ...state.domains,
      [domain]: { ...current, used: current.used + issued },
    },
    totalIssuance: state.totalIssuance + issued,
  };
  return { state: newState, issued };
}

/**
 * Reproduces Appendix H.4's simulation loop generically: for each
 * domain, attempts to issue `rho` once per hour, for `hours` hours,
 * recording total and per-domain issuance at each hour in
 * `snapshotHours`. Used to cross-check this implementation against the
 * paper's own worked numbers (Appendix D.1, Appendix H.4) — not merely
 * asserted to match, but actually recomputed and diffed.
 *
 * @param {{ name: string, rho: number, budget: number | null }[]} domains
 * @param {number} hours
 * @param {number[]} snapshotHours
 * @returns {Record<number, { total: number, perDomain: Record<string, number> }>}
 */
export function simulateHourlyIssuance(domains, hours, snapshotHours) {
  let state = initialScarcityState(Object.fromEntries(domains.map((d) => [d.name, d.budget])));
  const snapshots = {};
  const snapshotSet = new Set(snapshotHours);

  for (let hour = 1; hour <= hours; hour++) {
    for (const d of domains) {
      ({ state } = applyIssuanceAttempt(state, d.name, d.rho));
    }
    if (snapshotSet.has(hour)) {
      const perDomain = {};
      for (const d of domains) perDomain[d.name] = state.domains[d.name].used;
      snapshots[hour] = { total: state.totalIssuance, perDomain };
    }
  }
  return snapshots;
}
