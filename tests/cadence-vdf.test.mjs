import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vdfSeed, computeVdfChain, verifyVdfChain } from '../public/js/core/economics/cadence-vdf.js';

test('vdfSeed binds a chain to exactly one domain and one position in its history', () => {
  assert.equal(vdfSeed('alice', 'genesis'), 'alice:genesis');
  assert.notEqual(vdfSeed('alice', 'genesis'), vdfSeed('bob', 'genesis'));
  assert.notEqual(vdfSeed('alice', 'genesis'), vdfSeed('alice', 'some-prior-output'));
});

test('computeVdfChain is deterministic — the identical seed and iteration count always produce the identical output', () => {
  const out1 = computeVdfChain('alice:genesis', 1000);
  const out2 = computeVdfChain('alice:genesis', 1000);
  assert.equal(out1, out2);
});

test('computeVdfChain output is a real 64-character hex SHA-256 digest', () => {
  const out = computeVdfChain('alice:genesis', 100);
  assert.match(out, /^[0-9a-f]{64}$/);
});

test('a different seed produces a completely different chain, even for the identical iteration count', () => {
  const out1 = computeVdfChain('alice:genesis', 500);
  const out2 = computeVdfChain('bob:genesis', 500);
  assert.notEqual(out1, out2);
});

test('a different iteration count produces a different output for the identical seed — the chain is genuinely sequential, not just seed-dependent', () => {
  const out500 = computeVdfChain('alice:genesis', 500);
  const out501 = computeVdfChain('alice:genesis', 501);
  assert.notEqual(out500, out501);
});

test('the real cost is measurable and scales with iteration count — this is the actual property the whole mechanism depends on', () => {
  const start1 = process.hrtime.bigint();
  computeVdfChain('timing-test', 200_000);
  const elapsed1 = Number(process.hrtime.bigint() - start1);

  const start2 = process.hrtime.bigint();
  computeVdfChain('timing-test', 20_000);
  const elapsed2 = Number(process.hrtime.bigint() - start2);

  assert.ok(elapsed1 > elapsed2, `10x more iterations must take measurably longer: ${elapsed1}ns vs ${elapsed2}ns`);
});

test('verifyVdfChain accepts a genuinely, honestly computed chain', () => {
  const seed = 'alice:genesis';
  const iterations = 5000;
  const output = computeVdfChain(seed, iterations);
  assert.equal(verifyVdfChain(seed, iterations, output), true);
});

test('SECURITY: verifyVdfChain rejects a fabricated output with no real computation behind it', () => {
  const seed = 'alice:genesis';
  const iterations = 5000;
  const fabricated = '0'.repeat(64); // plausible-looking hex, zero real work
  assert.equal(verifyVdfChain(seed, iterations, fabricated), false);
});

test('SECURITY: verifyVdfChain rejects a real chain computed for FEWER iterations than claimed — cannot shortcut the count', () => {
  const seed = 'alice:genesis';
  const shortcut = computeVdfChain(seed, 100); // really computed, but not for the claimed 5000
  assert.equal(verifyVdfChain(seed, 5000, shortcut), false);
});

test('SECURITY: verifyVdfChain rejects a chain computed under the wrong seed — cannot reuse work done for a different domain or a different epoch position', () => {
  const output = computeVdfChain('alice:genesis', 5000);
  assert.equal(verifyVdfChain('bob:genesis', 5000, output), false);
  assert.equal(verifyVdfChain('alice:some-other-prior-output', 5000, output), false);
});

test('verifyVdfChain rejects malformed claimed-output strings without throwing', () => {
  assert.equal(verifyVdfChain('alice:genesis', 100, 'not-a-real-hex-digest'), false);
  assert.equal(verifyVdfChain('alice:genesis', 100, ''), false);
  assert.equal(verifyVdfChain('alice:genesis', 100, null), false);
  assert.equal(verifyVdfChain('alice:genesis', 100, undefined), false);
  assert.equal(verifyVdfChain('alice:genesis', 100, 123456), false);
});

test('epoch-to-epoch chaining: a later epoch\u2019s seed genuinely depends on the earlier epoch\u2019s real output, not just its existence', () => {
  const epoch1Output = computeVdfChain(vdfSeed('alice', 'genesis'), 1000);
  const epoch2SeedReal = vdfSeed('alice', epoch1Output);
  const epoch2SeedFaked = vdfSeed('alice', 'a-guessed-or-precomputed-output');
  const epoch2Real = computeVdfChain(epoch2SeedReal, 1000);
  const epoch2Faked = computeVdfChain(epoch2SeedFaked, 1000);
  assert.notEqual(epoch2Real, epoch2Faked, 'epoch 2 cannot be precomputed without genuinely knowing epoch 1\u2019s real output first');
});
