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

test('Result 2, re-derived under the real slot-indexed cost curve (§24, identity-cost.js): the exploit is real at t≈genesis, exactly reproducing the un-curved finding, but is dampened and then reversed as real deployment time passes', async () => {
  const { linearCostCurve, requiredBurnLamports } = await import('../public/js/core/identity/identity-cost.js');
  const B = 1000, q = 50, T = 0;
  const genesisSlot = 0;
  const slotsPerRound = 2000;
  const N = 4;
  // baseLamports=5 matches the un-curved test's flat cId=5 exactly, so
  // round 0 (near genesis, negligible real time elapsed) must reproduce
  // that exact finding — this curve does not retroactively penalize an
  // attacker for time that hasn't passed yet.
  const curve = linearCostCurve({ baseLamports: 5, lamportsPerSlot: 0.01 });

  let cumStayOld = -requiredBurnLamports(0, genesisSlot, curve); // one-time registration near genesis
  let cumChurn = 0;
  const rounds = [];
  for (let round = 0; round < 40; round++) {
    const age = 5000 + round * 50; // the old domain keeps aging from the original test's oldA=5000
    cumStayOld += reward(B, q, age, T, REAL_PARAMS);

    const slot = genesisSlot + round * slotsPerRound;
    cumChurn -= N * requiredBurnLamports(slot, genesisSlot, curve);
    cumChurn += N * reward(B / N, q, 1, T, REAL_PARAMS); // still resets to young=1 every round — the curve never touches the reward formula itself

    rounds.push({ round, cumStayOld, cumChurn });
  }

  const round0 = rounds[0];
  // Round 0 must reproduce the un-curved Result 2 finding closely — this
  // curve doesn't change history, only the future cost of registering.
  assert.ok(round0.cumChurn > round0.cumStayOld, `round 0 (negligible real time elapsed) should still show churn ahead, matching the un-curved baseline: stayOld=${round0.cumStayOld}, churn=${round0.cumChurn}`);

  const finalRound = rounds[rounds.length - 1];
  assert.ok(finalRound.cumChurn < finalRound.cumStayOld, `after real deployment time has genuinely passed, cumulative churn must fall behind staying: stayOld=${finalRound.cumStayOld}, churn=${finalRound.cumChurn}`);

  // A real crossover must exist somewhere in between — the mechanism
  // dampens over TIME, not by simply always losing outright.
  const crossoverRound = rounds.find((r) => r.cumChurn < r.cumStayOld);
  assert.ok(crossoverRound && crossoverRound.round > 0 && crossoverRound.round < rounds.length - 1, 'a genuine crossover point should exist strictly between the first and last simulated round');
});

test('Result 2 (H.22) is real decay, not a modeling artifact: reward strictly decreases as domain age A grows, all else equal', () => {
  const B = 1000, q = 50, T = 0;
  const ages = [1, 10, 100, 1000, 10000];
  const rewards = ages.map((A) => reward(B, q, A, T, REAL_PARAMS));
  for (let i = 1; i < rewards.length; i++) {
    assert.ok(rewards[i] < rewards[i - 1], `reward should strictly decrease with age A=${ages[i]} vs A=${ages[i - 1]}, got ${rewards[i]} >= ${rewards[i - 1]}`);
  }
});
