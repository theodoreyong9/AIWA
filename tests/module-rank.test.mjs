import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeModuleRank, checkSubmissionEligibility } from '../public/js/core/modules/module-rank.js';

const theta = { K: 1, alpha: 1, beta: 1 };

test('computeModuleRank reuses the real reward formula directly', () => {
  // r = K * b^alpha * q^beta = 1 * 100^1 * 5^1 = 500
  assert.equal(computeModuleRank(100, 5, theta), 500);
});

test('computeModuleRank is 0 with zero elapsed epochs (beta > 0) — matches §10, no instant rank', () => {
  assert.equal(computeModuleRank(1_000_000, 0, theta), 0);
});

test('a first-ever submission by an author is always eligible', () => {
  const check = checkSubmissionEligibility(1, 1, null);
  assert.equal(check.eligible, true);
});

test('a submission with an improved or equal ratio is eligible', () => {
  const last = { rank: 100, epochsElapsed: 10 }; // ratio = 101/11 ≈ 9.18
  const check = checkSubmissionEligibility(200, 10, last); // ratio = 201/11 ≈ 18.27, improved
  assert.equal(check.eligible, true);
});

test('a submission with a declined ratio is rejected', () => {
  const last = { rank: 1000, epochsElapsed: 10 }; // ratio = 1001/11 ≈ 91
  const check = checkSubmissionEligibility(1, 10, last); // ratio = 2/11 ≈ 0.18, much worse
  assert.equal(check.eligible, false);
  assert.match(check.reason, /must not decline/);
});

test('an exactly-equal ratio is eligible (not strictly required to improve)', () => {
  const last = { rank: 100, epochsElapsed: 10 };
  const check = checkSubmissionEligibility(100, 10, last); // identical ratio
  assert.equal(check.eligible, true);
});

test('rank sorts higher for a larger burn aged the same amount of time', () => {
  const smallBurnRank = computeModuleRank(100, 10, theta);
  const largeBurnRank = computeModuleRank(10_000, 10, theta);
  assert.ok(largeBurnRank > smallBurnRank);
});

test('rank sorts higher for the same burn aged longer', () => {
  const youngRank = computeModuleRank(1000, 2, theta);
  const agedRank = computeModuleRank(1000, 20, theta);
  assert.ok(agedRank > youngRank);
});
