// sybil-reward-splitting.test.mjs — permanent executable evidence for
// Appendix H.22's two results, not a one-off script whose numbers only
// ever existed in a terminal. Re-derives §24.1's Sybil-profit analysis
// against the CURRENT reference formula (§10, reward.js), closing the
// gap a direct critique named: the old power-law analysis (b^α) does
// not carry over to the current formula (b enters linearly, α governs
// q instead) and needed to be redone from scratch, not merely flagged
// as a conjecture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reward } from '../public/js/core/economics/reward.js';

// The real reference implementation's own constants (mine.js's
// calcClaimable(): alpha=1.1, beta=2.2, gamma=3, C=33^3) — the same
// ones Appendix H.14 cross-checks JS against Rust with.
const REAL_PARAMS = { alpha: 1.1, beta: 2.2, gamma: 3, C: 33 ** 3, minQ: 1 };

test('Result 1 (H.22): splitting a fixed capital across N equally-aged identities is exactly reward-neutral before identity cost', () => {
  const B = 1000, q = 50, A = 50, T = 0;

  const r1 = reward(B, q, A, T, REAL_PARAMS);
  const N = 4;
  const rN = reward(B / N, q, A, T, REAL_PARAMS);
  const totalRN = N * rN;

  // Exact cancellation, not approximation: N * (B/N) * q^alpha / D = B * q^alpha / D.
  assert.ok(Math.abs(r1 - totalRN) < 1e-9, `expected exact cancellation, got r1=${r1}, N*rN=${totalRN}`);
});

test('Result 1 (H.22): any positive identity cost makes N*=1 strictly optimal, unconditionally on alpha/beta/gamma/T', () => {
  const B = 1000, q = 50, A = 50, T = 0, cId = 5;

  const profitAt = (N) => N * reward(B / N, q, A, T, REAL_PARAMS) - N * cId;

  const profits = [1, 2, 4, 8, 16].map(profitAt);
  // Strictly decreasing in N — no local maximum at any N > 1.
  for (let i = 1; i < profits.length; i++) {
    assert.ok(profits[i] < profits[i - 1], `profit should strictly decrease with N, but profit(${[1, 2, 4, 8, 16][i]})=${profits[i]} >= profit(${[1, 2, 4, 8, 16][i - 1]})=${profits[i - 1]}`);
  }
});

test('Result 1 (H.22) holds across a spread of parameter choices, not only the one worked example — still no constraint on alpha/beta/gamma/T needed', () => {
  const B = 1000, cId = 5;
  const paramSets = [
    { alpha: 1.1, beta: 2.2, gamma: 3, C: 33 ** 3, minQ: 1 }, // real reference constants
    { alpha: 0.5, beta: 1, gamma: 2, C: 100, minQ: 1 },
    { alpha: 2, beta: 0.5, gamma: 1, C: 10, minQ: 1 },
  ];
  for (const params of paramSets) {
    for (const [q, A, T] of [[10, 10, 0], [100, 5, 0.3], [50, 200, 0.1]]) {
      const profit1 = reward(B, q, A, T, params) - cId;
      const profit4 = 4 * reward(B / 4, q, A, T, params) - 4 * cId;
      assert.ok(profit4 < profit1, `splitting should never beat N=1 under this idealization, for params=${JSON.stringify(params)}, q=${q}, A=${A}, T=${T}`);
    }
  }
});

test('Result 2 (H.22): identity churn — abandoning an aged domain for fresh young ones can beat staying, a genuinely new attack shape the power-law formula never had', () => {
  const B = 1000, q = 50, T = 0, cId = 5;

  const oldA = 5000;
  const profitStayOld = reward(B, q, oldA, T, REAL_PARAMS) - 1 * cId;

  const N = 4, youngA = 1;
  const profitChurnYoung = N * reward(B / N, q, youngA, T, REAL_PARAMS) - N * cId;

  // The specific, reproducible case Appendix H.22 cites: churning to
  // young domains decisively beats staying on one aged domain, despite
  // quadrupling the identity-cost outlay.
  assert.ok(profitChurnYoung > profitStayOld, `expected churning to young domains to beat staying old: stayOld=${profitStayOld}, churnYoung=${profitChurnYoung}`);
});

test('Result 2 (H.22) is real decay, not a modeling artifact: reward strictly decreases as domain age A grows, all else equal', () => {
  const B = 1000, q = 50, T = 0;
  const ages = [1, 10, 100, 1000, 10000];
  const rewards = ages.map((A) => reward(B, q, A, T, REAL_PARAMS));
  for (let i = 1; i < rewards.length; i++) {
    assert.ok(rewards[i] < rewards[i - 1], `reward should strictly decrease with age A=${ages[i]} vs A=${ages[i - 1]}, got ${rewards[i]} >= ${rewards[i - 1]}`);
  }
});
