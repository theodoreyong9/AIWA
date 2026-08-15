// reward.test.mjs — mirrors rust-core/src/economics/reward.rs's test
// suite case for case. Now tests the real Proof-of-Will formula
// (b·q^α)/[ln(qTotal^(β(1−T))+C)]^γ, adopted from the user's own real
// mining formula (mine.js's calcClaimable()), not the earlier simpler
// power-law form.
//
// Run: node --test tests/reward.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reward, elapsedEpochs, domainAge, RewardError } from '../public/js/core/economics/reward.js';
import { initialCadenceState } from '../public/js/core/economics/cadence.js';

// The real reference implementation's actual constants (mine.js's
// calcClaimable(): α=1.1, β=2.2, γ=3, C=33³=35937), used here so this
// test suite cross-checks against a computation traceable to the real
// formula, not an arbitrary parameter set.
const REAL_PARAMS = { alpha: 1.1, beta: 2.2, gamma: 35937 === 33 ** 3 ? 3 : 3, C: 33 ** 3, minQ: 1 };

test('matches a hand-computed value using the real formula\'s own constants', () => {
  // b=1, q=100, qTotal=100, T=0: r = (100^1.1 * 1) / [ln(100^2.2 + 35937)]^3
  const r = reward(1, 100, 100, 0, REAL_PARAMS);
  assert.ok(Math.abs(r - 0.11844290947765648) < 1e-9);
});

test('larger b scales the numerator linearly, all else equal', () => {
  const r1 = reward(1, 100, 100, 0, REAL_PARAMS);
  const r10 = reward(10, 100, 100, 0, REAL_PARAMS);
  assert.ok(Math.abs(r10 - r1 * 10) < 1e-6);
});

test('q below minQ yields zero reward — no instant reward', () => {
  assert.equal(reward(10, 0, 100, 0, { ...REAL_PARAMS, minQ: 1 }), 0);
});

test('q at or above minQ yields a positive reward for positive b', () => {
  const r = reward(10, 1, 1, 0, REAL_PARAMS);
  assert.ok(r > 0);
});

test('a higher patience rate T changes the reward (denominator depends on T via beta(1-T))', () => {
  const rNoPatience = reward(10, 100, 100, 0, REAL_PARAMS);
  const rMaxPatience = reward(10, 100, 100, 0.4, REAL_PARAMS);
  assert.notEqual(rNoPatience, rMaxPatience);
});

test('patience rate is clamped to [0, 0.4] exactly as the real formula does (Math.min(tr,40)/100)', () => {
  const rClamped = reward(10, 100, 100, 0.4, REAL_PARAMS);
  const rOverClaimed = reward(10, 100, 100, 0.9, REAL_PARAMS); // should behave identically to 0.4
  assert.equal(rClamped, rOverClaimed);
});

test('negative T is clamped to 0, not rejected', () => {
  const rZero = reward(10, 100, 100, 0, REAL_PARAMS);
  const rNegative = reward(10, 100, 100, -5, REAL_PARAMS);
  assert.equal(rZero, rNegative);
});

test('negative b is rejected', () => {
  assert.throws(() => reward(-1, 1, 1, 0, REAL_PARAMS), RewardError);
});

test('negative q is rejected', () => {
  assert.throws(() => reward(1, -1, 1, 0, REAL_PARAMS), RewardError);
});

test('negative qTotal is rejected', () => {
  assert.throws(() => reward(1, 1, -1, 0, REAL_PARAMS), RewardError);
});

test('non-finite params are rejected', () => {
  assert.throws(() => reward(1, 1, 1, 0, { ...REAL_PARAMS, alpha: NaN }), RewardError);
  assert.throws(() => reward(1, 1, 1, 0, { ...REAL_PARAMS, gamma: Infinity }), RewardError);
});

test('reward never returns a negative or non-finite number for valid finite inputs', () => {
  const r = reward(1e6, 5000, 5000, 0.2, REAL_PARAMS);
  assert.ok(Number.isFinite(r) && r >= 0);
});

test('elapsedEpochs reads current domain epoch', () => {
  const state = { ...initialCadenceState(), domains: { d1: { epoch: 7, lastId: 'c7' } } };
  assert.equal(elapsedEpochs(state, 'd1', 3), 4);
});

test('elapsedEpochs never goes negative', () => {
  const state = { ...initialCadenceState(), domains: { d1: { epoch: 2, lastId: 'c2' } } };
  assert.equal(elapsedEpochs(state, 'd1', 5), 0);
});

test('elapsedEpochs for unknown domain is zero', () => {
  assert.equal(elapsedEpochs(initialCadenceState(), 'unknown', 0), 0);
});

test('domainAge reads the domain\'s own current epoch — the formula\'s domain-local stand-in for global "protocol age"', () => {
  const state = { ...initialCadenceState(), domains: { d1: { epoch: 42, lastId: 'c42' } } };
  assert.equal(domainAge(state, 'd1'), 42);
});

test('domainAge for unknown domain is zero', () => {
  assert.equal(domainAge(initialCadenceState(), 'unknown'), 0);
});
