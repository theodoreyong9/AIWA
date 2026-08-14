// module-submission.test.mjs — tests against REAL Ed25519 signing via
// @noble/curves (installed as a test-only devDependency, see
// package.json), not a hand-rolled fake — the same real primitive
// @solana/web3.js itself uses. Requires `npm install` first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import * as solanaWeb3 from '@solana/web3.js';
import {
  buildSubmissionEvent,
  verifySubmissionSignature,
  initialSubmissionState,
  validateSubmission,
  recordNonce,
  submitModule,
} from '../public/js/core/modules/module-submission.js';
import { computeModuleHash } from '../public/js/core/modules/module-hash.js';
import { initialModuleRegistryState, registerModule, updateModuleCode } from '../public/js/core/modules/module-registry.js';

function makeSigner() {
  const kp = solanaWeb3.Keypair.generate();
  return { seed: kp.secretKey.slice(0, 32), pubkeyBytes: kp.publicKey.toBytes() };
}

function baseFields(overrides = {}) {
  return {
    moduleId: 'mymodule.js',
    codeHash: 'placeholder', // overwritten in most tests once code is known
    codeUrl: 'https://example.com/mymodule.js',
    name: 'My Module',
    icon: '🔮',
    category: 'Tools',
    description: 'Does a thing.',
    isIssuing: false,
    timeSensitive: null,
    economicConfig: null,
    ...overrides,
  };
}

test('buildSubmissionEvent produces a real, independently-verifiable Ed25519 signature', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'window.YM_S["mymodule.js"] = { name: "M" };';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  assert.equal(verifySubmissionSignature(event), true);
});

test('verifySubmissionSignature rejects a tampered field (e.g. swapped codeUrl) even with a valid-looking signature', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const tampered = { ...event, codeUrl: 'https://evil.example/swapped.js' };
  assert.equal(verifySubmissionSignature(tampered), false);
});

test('validateSubmission rejects a code fetch that does not match the claimed hash', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const claimedCode = 'const x = 1;';
  const codeHash = await computeModuleHash(claimedCode);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const actuallyFetchedCode = 'const x = 1; exfiltrate();'; // swapped behind the same URL
  const check = await validateSubmission(initialSubmissionState(), event, actuallyFetchedCode);
  assert.equal(check.valid, false);
  assert.match(check.reason, /hash mismatch/);
});

test('validateSubmission accepts a correctly-signed event whose fetched code matches', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const check = await validateSubmission(initialSubmissionState(), event, code);
  assert.equal(check.valid, true);
});

test('validateSubmission rejects a replayed nonce', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes, { nonce: 'fixed-nonce-1' });

  let state = initialSubmissionState();
  state = recordNonce(state, 'fixed-nonce-1');

  const check = await validateSubmission(state, event, code);
  assert.equal(check.valid, false);
  assert.match(check.reason, /already used/);
});

test('validateSubmission enforces §24.1 economic consistency for issuing modules, same as direct registration', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(
    baseFields({ codeHash, isIssuing: true, timeSensitive: true, economicConfig: { alpha: 1, identityCostMechanism: null, scarcityPolicy: 'preallocated' } }),
    seed,
    pubkeyBytes
  );

  const check = await validateSubmission(initialSubmissionState(), event, code);
  assert.equal(check.valid, false);
  assert.match(check.reason, /unbounded splitting/);
});

test('submitModule end to end: valid new submission registers the module and consumes the nonce', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const result = await submitModule(initialModuleRegistryState(), initialSubmissionState(), event, code, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.isUpdate, false);
  assert.equal(result.registryState.modules['mymodule.js'].codeHash, codeHash);
  assert.equal(result.submissionState.usedNonces[event.nonce], true);
});

test('submitModule end to end: a second submission for the same id updates rather than duplicates, and resets audit status', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const codeV1 = 'const x = 1;';
  const hashV1 = await computeModuleHash(codeV1);
  const event1 = buildSubmissionEvent(baseFields({ codeHash: hashV1 }), seed, pubkeyBytes, { nonce: 'n1' });

  let { registryState, submissionState } = await submitModule(initialModuleRegistryState(), initialSubmissionState(), event1, codeV1, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
  });

  const codeV2 = 'const x = 2;';
  const hashV2 = await computeModuleHash(codeV2);
  const event2 = buildSubmissionEvent(baseFields({ codeHash: hashV2 }), seed, pubkeyBytes, { nonce: 'n2' });

  const result2 = await submitModule(registryState, submissionState, event2, codeV2, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
  });

  assert.equal(result2.accepted, true);
  assert.equal(result2.isUpdate, true);
  assert.equal(result2.registryState.modules['mymodule.js'].codeHash, hashV2);
  assert.equal(result2.registryState.modules['mymodule.js'].auditStatus, 'unaudited');
});

test('a forged signature (wrong signer claiming another pubkey) is rejected', async () => {
  const attacker = makeSigner();
  const victim = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);

  // Attacker signs with their own key but claims the victim's pubkey.
  const event = buildSubmissionEvent(baseFields({ codeHash }), attacker.seed, victim.pubkeyBytes);
  assert.equal(verifySubmissionSignature(event), false);
});
