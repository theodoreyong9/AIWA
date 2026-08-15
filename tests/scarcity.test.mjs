// scarcity.test.mjs — mirrors rust-core/src/economics/scarcity.rs's
// test suite case for case, cross-checking against the same paper
// numbers (Appendix D.1, Appendix H.4).
//
// Run: node --test tests/scarcity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialScarcityState, applyIssuanceAttempt, simulateHourlyIssuance } from '../public/js/core/economics/scarcity.js';

test('unbounded issuance never clamps', () => {
  const { state, issued } = applyIssuanceAttempt(initialScarcityState({ d1: null }), 'd1', 1);
  assert.equal(issued, 1);
  assert.equal(state.domains.d1.used, 1);
});

test('budget clamps once exhausted', () => {
  let state = initialScarcityState({ d1: 2.5 });
  let issued;

  ({ state, issued } = applyIssuanceAttempt(state, 'd1', 1));
  assert.equal(issued, 1);
  ({ state, issued } = applyIssuanceAttempt(state, 'd1', 1));
  assert.equal(issued, 1);
  ({ state, issued } = applyIssuanceAttempt(state, 'd1', 1));
  assert.equal(issued, 0.5); // clamped
  ({ state, issued } = applyIssuanceAttempt(state, 'd1', 1));
  assert.equal(issued, 0); // exhausted

  assert.equal(state.domains.d1.used, 2.5);
  assert.equal(state.totalIssuance, 2.5);
});

test('Appendix D.1 unbounded policy matches paper numbers', () => {
  // "With rho_E = rho_M = 1 unit/hour: after T=1000h, I_global=2000;
  // after T=10000h, I_global=20000."
  const domains = [
    { name: 'E', rho: 1, budget: null },
    { name: 'M', rho: 1, budget: null },
  ];
  const snaps = simulateHourlyIssuance(domains, 10_000, [1000, 10_000]);

  assert.equal(snaps[1000].total, 2000);
  assert.equal(snaps[10_000].total, 20_000);
});

test('Appendix D.1 / H.4 preallocated budget policy matches paper numbers', () => {
  // "With B_E = B_M = 5000, I_global <= 10000 — but once one domain
  // exhausts its allocation, autonomous issuance from that domain stops."
  const domains = [
    { name: 'E', rho: 1, budget: 5000 },
    { name: 'M', rho: 1, budget: 5000 },
  ];
  const snaps = simulateHourlyIssuance(domains, 100_000, [1000, 10_000, 50_000, 100_000]);

  assert.equal(snaps[1000].total, 2000); // pre-exhaustion, matches the unbounded case
  assert.equal(snaps[10_000].total, 10_000); // saturated
  assert.equal(snaps[50_000].total, 10_000);
  assert.equal(snaps[100_000].total, 10_000);
  assert.equal(snaps[100_000].perDomain.E, 5000);
  assert.equal(snaps[100_000].perDomain.M, 5000);
});

test('one domain exhausting does not stop the other', () => {
  // §13.1's trade-off is per-domain: one domain running out must not
  // affect another domain's still-remaining budget.
  const domains = [
    { name: 'fast', rho: 10, budget: 50 }, // exhausts at hour 5
    { name: 'slow', rho: 1, budget: 50 },  // still has budget left
  ];
  const snaps = simulateHourlyIssuance(domains, 20, [20]);

  assert.equal(snaps[20].perDomain.fast, 50); // exhausted, capped
  assert.equal(snaps[20].perDomain.slow, 20); // unaffected, still accruing
});
