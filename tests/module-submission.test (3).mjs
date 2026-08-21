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
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  assert.equal(await verifySubmissionSignature(event), true);
});

test('verifySubmissionSignature rejects a tampered field (e.g. swapped codeUrl) even with a valid-looking signature', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const tampered = { ...event, codeUrl: 'https://evil.example/swapped.js' };
  assert.equal(await verifySubmissionSignature(tampered), false);
});

test('validateSubmission rejects a code fetch that does not match the claimed hash', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const claimedCode = 'const x = 1;';
  const codeHash = await computeModuleHash(claimedCode);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const actuallyFetchedCode = 'const x = 1; exfiltrate();'; // swapped behind the same URL
  const check = await validateSubmission(initialSubmissionState(), event, actuallyFetchedCode);
  assert.equal(check.valid, false);
  assert.match(check.reason, /hash mismatch/);
});

test('validateSubmission accepts a correctly-signed event whose fetched code matches', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

  const check = await validateSubmission(initialSubmissionState(), event, code);
  assert.equal(check.valid, true);
});

test('validateSubmission rejects a replayed nonce', async () => {
  const { seed, pubkeyBytes } = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes, { nonce: 'fixed-nonce-1' });

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
  const event = await buildSubmissionEvent(
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
  const event = await buildSubmissionEvent(baseFields({ codeHash }), seed, pubkeyBytes);

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
  const event1 = await buildSubmissionEvent(baseFields({ codeHash: hashV1 }), seed, pubkeyBytes, { nonce: 'n1' });

  let { registryState, submissionState } = await submitModule(initialModuleRegistryState(), initialSubmissionState(), event1, codeV1, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
  });

  const codeV2 = 'const x = 2;';
  const hashV2 = await computeModuleHash(codeV2);
  const event2 = await buildSubmissionEvent(baseFields({ codeHash: hashV2 }), seed, pubkeyBytes, { nonce: 'n2' });

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
  const event = await buildSubmissionEvent(baseFields({ codeHash }), attacker.seed, victim.pubkeyBytes);
  assert.equal(await verifySubmissionSignature(event), false);
});

// ── checkSubmissionEligibility, actually wired in ────────────────────
// Built and tested in module-rank.js since an earlier phase, never
// actually called from this pipeline until now — these tests exercise
// the real wiring, not module-rank.js's own logic a second time.

import { checkSubmissionEligibility } from '../public/js/core/modules/module-rank.js';

function eligibilityFnFrom(currentRank, currentEpochsElapsed) {
  // Mimics what main.js's real closure does: compute this author's
  // CURRENT rank/epochs (from identity-cost + cadence state, fixed
  // here for the test) and defer the ratio comparison to the real,
  // already-tested checkSubmissionEligibility().
  return (authorPubkey, lastSubmission) => {
    const check = checkSubmissionEligibility(currentRank, currentEpochsElapsed, lastSubmission);
    return { ...check, rank: currentRank, epochsElapsed: currentEpochsElapsed };
  };
}

test('a first-ever submission from an author is always eligible, and records their rank', async () => {
  const signer = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), signer.seed, signer.pubkeyBytes);

  const result = await submitModule(initialModuleRegistryState(), initialSubmissionState(), event, code, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
    checkEligibilityFn: eligibilityFnFrom(100, 5),
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.submissionState.lastSubmissionByAuthor[event.signerPubkey], { rank: 100, epochsElapsed: 5 });
});

test('a second NEW module id from the same author with a declining ratio is rejected', async () => {
  const signer = makeSigner();
  let registryState = initialModuleRegistryState();
  let submissionState = initialSubmissionState();

  // First registration: rank 1000 at epoch 10 -> ratio (1001/11) ≈ 91.
  const code1 = 'const a = 1;';
  const hash1 = await computeModuleHash(code1);
  const event1 = await buildSubmissionEvent(baseFields({ moduleId: 'first.js', codeHash: hash1 }), signer.seed, signer.pubkeyBytes);
  const result1 = await submitModule(registryState, submissionState, event1, code1, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(1000, 10),
  });
  assert.equal(result1.accepted, true);
  registryState = result1.registryState;
  submissionState = result1.submissionState;

  // Second, DIFFERENT new module id, but rank has cratered: ratio (2/11) << 91.
  const code2 = 'const b = 2;';
  const hash2 = await computeModuleHash(code2);
  const event2 = await buildSubmissionEvent(baseFields({ moduleId: 'second.js', codeHash: hash2 }), signer.seed, signer.pubkeyBytes);
  const result2 = await submitModule(registryState, submissionState, event2, code2, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(1, 10),
  });

  assert.equal(result2.accepted, false);
  assert.match(result2.reason, /lower than your last submission/);
  assert.equal(registryState.modules['second.js'], undefined); // never registered
});

test('eligibility does NOT gate an update to a module the author already owns', async () => {
  const signer = makeSigner();
  let registryState = initialModuleRegistryState();
  let submissionState = initialSubmissionState();

  const codeV1 = 'const v = 1;';
  const hashV1 = await computeModuleHash(codeV1);
  const eventV1 = await buildSubmissionEvent(baseFields({ codeHash: hashV1 }), signer.seed, signer.pubkeyBytes);
  const resultV1 = await submitModule(registryState, submissionState, eventV1, codeV1, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(1000, 10),
  });
  registryState = resultV1.registryState;
  submissionState = resultV1.submissionState;

  // Same author updates the SAME module id, rank has since cratered —
  // an eligibility gate on updates would wrongly block improving your
  // own module.
  const codeV2 = 'const v = 2;';
  const hashV2 = await computeModuleHash(codeV2);
  const eventV2 = await buildSubmissionEvent(baseFields({ codeHash: hashV2, nonce: crypto.randomUUID() }), signer.seed, signer.pubkeyBytes);
  const resultV2 = await submitModule(registryState, submissionState, eventV2, codeV2, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(0, 10),
  });

  assert.equal(resultV2.accepted, true);
  assert.equal(resultV2.isUpdate, true);
});

test('omitting checkEligibilityFn skips the check entirely — backward compatible', async () => {
  const signer = makeSigner();
  const code = 'const x = 1;';
  const codeHash = await computeModuleHash(code);
  const event = await buildSubmissionEvent(baseFields({ codeHash }), signer.seed, signer.pubkeyBytes);

  const result = await submitModule(initialModuleRegistryState(), initialSubmissionState(), event, code, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
    // no checkEligibilityFn
  });

  assert.equal(result.accepted, true);
});

test('recordNonce preserves lastSubmissionByAuthor for OTHER authors — a real bug found via end-to-end testing, not by inspection', async () => {
  const alice = makeSigner();
  const bob = makeSigner();
  let submissionState = initialSubmissionState();

  const aliceCode = 'const a = 1;';
  const aliceHash = await computeModuleHash(aliceCode);
  const aliceEvent = await buildSubmissionEvent(baseFields({ moduleId: 'alice-mod.js', codeHash: aliceHash }), alice.seed, alice.pubkeyBytes);
  const aliceResult = await submitModule(initialModuleRegistryState(), submissionState, aliceEvent, aliceCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(500, 20),
  });
  submissionState = aliceResult.submissionState;
  assert.ok(submissionState.lastSubmissionByAuthor[aliceEvent.signerPubkey], 'alice tracked after her own submission');

  // Bob submits next — must NOT wipe alice's tracked entry.
  const bobCode = 'const b = 2;';
  const bobHash = await computeModuleHash(bobCode);
  const bobEvent = await buildSubmissionEvent(baseFields({ moduleId: 'bob-mod.js', codeHash: bobHash }), bob.seed, bob.pubkeyBytes);
  const bobResult = await submitModule(aliceResult.registryState, submissionState, bobEvent, bobCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode, checkEligibilityFn: eligibilityFnFrom(10, 5),
  });
  submissionState = bobResult.submissionState;

  assert.ok(submissionState.lastSubmissionByAuthor[aliceEvent.signerPubkey], 'alice must still be tracked after bob submits');
  assert.ok(submissionState.lastSubmissionByAuthor[bobEvent.signerPubkey], 'bob tracked after his own submission');
});

// ── SECURITY: module hijacking via update, found while answering a
// direct question about how updates actually work ──────────────────

test('SECURITY: a different signer cannot "update" (hijack) a module they did not register — the exact vulnerability found and closed', async () => {
  const alice = makeSigner();
  const attacker = makeSigner();

  const aliceCode = 'const legit = true;';
  const aliceHash = await computeModuleHash(aliceCode);
  const aliceEvent = await buildSubmissionEvent(baseFields({ moduleId: 'weather.js', codeHash: aliceHash }), alice.seed, alice.pubkeyBytes);
  const r1 = await submitModule(initialModuleRegistryState(), initialSubmissionState(), aliceEvent, aliceCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });
  assert.equal(r1.accepted, true);

  const evilCode = 'const malicious = true;';
  const evilHash = await computeModuleHash(evilCode);
  const evilEvent = await buildSubmissionEvent(baseFields({ moduleId: 'weather.js', codeHash: evilHash }), attacker.seed, attacker.pubkeyBytes);
  const r2 = await submitModule(r1.registryState, r1.submissionState, evilEvent, evilCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });

  assert.equal(r2.accepted, false, 'a different signer must never be able to overwrite an existing module\'s code');
  assert.match(r2.reason, /only the original author/);
  // The registry must be completely untouched by the attempt — still alice's original code.
  assert.equal(r2.registryState.modules['weather.js'].codeHash, aliceHash);
  assert.equal(r2.registryState.modules['weather.js'].author, aliceEvent.signerPubkey);
});

test('the original author CAN still update their own module — the fix gates hijacking, not legitimate updates', async () => {
  const alice = makeSigner();

  const codeV1 = 'const v = 1;';
  const hashV1 = await computeModuleHash(codeV1);
  const eventV1 = await buildSubmissionEvent(baseFields({ moduleId: 'weather.js', codeHash: hashV1 }), alice.seed, alice.pubkeyBytes);
  const r1 = await submitModule(initialModuleRegistryState(), initialSubmissionState(), eventV1, codeV1, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });

  const codeV2 = 'const v = 2;';
  const hashV2 = await computeModuleHash(codeV2);
  const eventV2 = await buildSubmissionEvent(baseFields({ moduleId: 'weather.js', codeHash: hashV2, nonce: crypto.randomUUID() }), alice.seed, alice.pubkeyBytes);
  const r2 = await submitModule(r1.registryState, r1.submissionState, eventV2, codeV2, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });

  assert.equal(r2.accepted, true);
  assert.equal(r2.registryState.modules['weather.js'].codeHash, hashV2);
});

test('a NEW module id remains open to any author — the hijack fix applies only to already-registered ids, matching §27.4\'s open-registration design', async () => {
  const alice = makeSigner();
  const bob = makeSigner();

  const aliceCode = 'const a = 1;';
  const aliceHash = await computeModuleHash(aliceCode);
  const aliceEvent = await buildSubmissionEvent(baseFields({ moduleId: 'alice-only.js', codeHash: aliceHash }), alice.seed, alice.pubkeyBytes);
  const r1 = await submitModule(initialModuleRegistryState(), initialSubmissionState(), aliceEvent, aliceCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });

  const bobCode = 'const b = 1;';
  const bobHash = await computeModuleHash(bobCode);
  const bobEvent = await buildSubmissionEvent(baseFields({ moduleId: 'bob-new.js', codeHash: bobHash }), bob.seed, bob.pubkeyBytes);
  const r2 = await submitModule(r1.registryState, r1.submissionState, bobEvent, bobCode, {
    registerModuleFn: registerModule, updateModuleCodeFn: updateModuleCode,
  });

  assert.equal(r2.accepted, true, 'registering a genuinely new, different module id must remain open to anyone');
});
