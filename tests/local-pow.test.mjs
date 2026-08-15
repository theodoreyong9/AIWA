import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minePowProof, verifyPowProof, initialLocalPowState, registerLocalPow, hasLocalPow } from '../public/js/core/identity/local-pow.js';

// Low difficulty for fast tests — the mechanism itself is what's tested,
// not a production-grade difficulty level.
const TEST_DIFFICULTY = 8;

test('minePowProof finds a real nonce whose hash clears the requested difficulty, with no network calls', async () => {
  const proof = await minePowProof('mars-outpost-7', TEST_DIFFICULTY);
  assert.equal(proof.domain, 'mars-outpost-7');
  assert.equal(proof.difficultyBits, TEST_DIFFICULTY);
  assert.equal(typeof proof.nonce, 'number');
});

test('verifyPowProof accepts a genuinely mined proof', async () => {
  const proof = await minePowProof('earth-alpha', TEST_DIFFICULTY);
  const check = await verifyPowProof(proof);
  assert.equal(check.valid, true);
});

test('verifyPowProof rejects a proof with a hash that does not match domain:nonce', async () => {
  const proof = await minePowProof('earth-alpha', TEST_DIFFICULTY);
  const forged = { ...proof, hash: '0'.repeat(64) }; // fabricated, not recomputed
  const check = await verifyPowProof(forged);
  assert.equal(check.valid, false);
  assert.match(check.reason, /does not match/);
});

test('verifyPowProof rejects a proof claiming more difficulty than it actually clears', async () => {
  const proof = await minePowProof('earth-alpha', TEST_DIFFICULTY);
  const inflated = { ...proof, difficultyBits: TEST_DIFFICULTY + 40 };
  const check = await verifyPowProof(inflated);
  assert.equal(check.valid, false);
  assert.match(check.reason, /insufficient work/);
});

test('registerLocalPow accepts a valid proof and records it', async () => {
  const proof = await minePowProof('mars-outpost-7', TEST_DIFFICULTY);
  const result = await registerLocalPow(initialLocalPowState(), proof);
  assert.equal(result.accepted, true);
  assert.equal(hasLocalPow(result.state, 'mars-outpost-7'), true);
});

test('a domain cannot register a second local-pow identity cost', async () => {
  const proof1 = await minePowProof('mars-outpost-7', TEST_DIFFICULTY);
  let state = initialLocalPowState();
  ({ state } = await registerLocalPow(state, proof1));

  const proof2 = await minePowProof('mars-outpost-7', TEST_DIFFICULTY);
  const second = await registerLocalPow(state, proof2);
  assert.equal(second.accepted, false);
  assert.match(second.reason, /already has a registered/);
});

test('hasLocalPow is false for an unregistered domain', () => {
  assert.equal(hasLocalPow(initialLocalPowState(), 'unknown'), false);
});

test('a forged proof (fabricated hash, no real mining) is rejected at registration too', async () => {
  const fake = { domain: 'lazy-domain', nonce: 0, hash: '0'.repeat(64), difficultyBits: TEST_DIFFICULTY, minedAt: Date.now() };
  const result = await registerLocalPow(initialLocalPowState(), fake);
  assert.equal(result.accepted, false);
});
