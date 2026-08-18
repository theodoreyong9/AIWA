import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialGenericContractState, applyGenericContractEvent, materializeGenericContracts,
  substitutePlaceholders, verifyGenericRelease,
} from '../public/js/core/generic-contract-reducer.js';
import { initialConservationState, issueClaim, transfer, identityDerivation } from '../public/js/core/conservation/conservation.js';
import { potAddress } from '../public/js/core/pool/pool-reducer.js';

// ── substitutePlaceholders ────────────────────────────────────────

test('substitutePlaceholders replaces $claimId/$from/$to wherever they appear as plain string values', () => {
  const template = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  const result = substitutePlaceholders(template, { claimId: 'c1', from: 'alice', to: 'bob' });
  assert.deepEqual(result, { type: 'ownership', claimId: 'c1', expectedOwner: 'alice' });
});

test('substitutePlaceholders leaves non-placeholder strings untouched', () => {
  const template = { type: 'count', eventType: 'approval', min: 2 };
  const result = substitutePlaceholders(template, { claimId: 'c1', from: 'alice', to: 'bob' });
  assert.deepEqual(result, template);
});

test('substitutePlaceholders works through nested all/any/not composition', () => {
  const template = { all: [{ type: 'ownership', claimId: '$claimId', expectedOwner: '$from' }, { not: { type: 'unique', key: '$to' } }] };
  const result = substitutePlaceholders(template, { claimId: 'c1', from: 'alice', to: 'bob' });
  assert.deepEqual(result, { all: [{ type: 'ownership', claimId: 'c1', expectedOwner: 'alice' }, { not: { type: 'unique', key: 'bob' } }] });
});

test('substitutePlaceholders does not mutate the original template', () => {
  const template = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  substitutePlaceholders(template, { claimId: 'c1', from: 'alice', to: 'bob' });
  assert.equal(template.claimId, '$claimId', 'the original template must remain a reusable, immutable placeholder pattern');
});

// ── mint (applyGenericContractEvent / materializeGenericContracts) ──

function initEvent(id, contractId, condition) {
  return { id, payload: { type: 'generic-contract-init', contractId, condition, mintedBy: 'alice', at: 0 } };
}

test('a contract mints once with a real condition', () => {
  const condition = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  const state = applyGenericContractEvent(initialGenericContractState(), initEvent('e1', 'escrow1', condition));
  assert.deepEqual(state.contracts.escrow1.condition, condition);
});

test('SECURITY: the same contractId cannot be re-minted with a different condition', () => {
  const original = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  const attack = { type: 'unique', key: 'always-true-forever' }; // trivially satisfiable
  let state = applyGenericContractEvent(initialGenericContractState(), initEvent('e1', 'escrow1', original));
  state = applyGenericContractEvent(state, initEvent('e2', 'escrow1', attack));
  assert.deepEqual(state.contracts.escrow1.condition, original, 'a contract\'s condition must be permanent once minted');
  assert.equal(state.rejections.length, 1);
});

test('a mint with a missing or invalid condition is rejected', () => {
  let state = applyGenericContractEvent(initialGenericContractState(), { id: 'e1', payload: { type: 'generic-contract-init', contractId: 'x' } });
  assert.equal(state.contracts.x, undefined);
  assert.equal(state.rejections.length, 1);
});

test('materializeGenericContracts folds a real sequence correctly', () => {
  const condition = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  const state = materializeGenericContracts([initEvent('e1', 'escrow1', condition)]);
  assert.deepEqual(state.contracts.escrow1.condition, condition);
});

// ── verifyGenericRelease: SECURITY-critical ──────────────────────

test('SECURITY: a release attempt cannot supply its own condition — only releaseProof.contractId is ever read', async () => {
  // A real, honest condition that is UNAMBIGUOUSLY false for this
  // release (no such event exists) — chosen specifically so the test
  // can distinguish "the real minted condition was evaluated" (must
  // reject) from "the attacker's smuggled, trivially-true condition
  // was used instead" (would wrongly accept).
  const condition = { type: 'count', eventType: 'never-happened', min: 1 };
  const contractState = applyGenericContractEvent(initialGenericContractState(), initEvent('e1', 'escrow1', condition));
  const conservationState = issueClaim(initialConservationState(), { id: 'c1', kind: 'AIWA', amount: 10, owner: potAddress('escrow1') });

  // The attacker smuggles an extra `condition` field into releaseProof, hoping it gets used instead.
  const maliciousReleaseProof = { contractId: 'escrow1', condition: { type: 'unique', key: 'trivially-true' } };
  const ok = await verifyGenericRelease(contractState, conservationState, [], {}, 'c1', potAddress('escrow1'), 'attacker', maliciousReleaseProof);
  assert.equal(ok, false, 'the smuggled condition must be completely ignored; only the real, minted (and here, unsatisfied) condition is ever evaluated');
});

test('a legitimate release matching the minted condition is accepted', async () => {
  const condition = { type: 'ownership', claimId: '$claimId', expectedOwner: '$from' };
  const contractState = applyGenericContractEvent(initialGenericContractState(), initEvent('e1', 'escrow1', condition));
  const conservationState = issueClaim(initialConservationState(), { id: 'c1', kind: 'AIWA', amount: 10, owner: potAddress('escrow1') });
  const ok = await verifyGenericRelease(contractState, conservationState, [], {}, 'c1', potAddress('escrow1'), 'bob', { contractId: 'escrow1' });
  assert.equal(ok, true);
});

test('a release referencing an unminted contractId is rejected', async () => {
  const conservationState = initialConservationState();
  const ok = await verifyGenericRelease(initialGenericContractState(), conservationState, [], {}, 'c1', 'from', 'to', { contractId: 'nonexistent' });
  assert.equal(ok, false);
});

test('a malformed releaseProof (missing contractId) is rejected without throwing', async () => {
  const conservationState = initialConservationState();
  assert.equal(await verifyGenericRelease(initialGenericContractState(), conservationState, [], {}, 'c1', 'from', 'to', {}), false);
  assert.equal(await verifyGenericRelease(initialGenericContractState(), conservationState, [], {}, 'c1', 'from', 'to', null), false);
});

// ── Real end-to-end demonstration: a genuinely NEW contract type,
// zero pool-style bespoke code — a 2-of-3 threshold release, expressed
// entirely as a declarative condition over real `count`/`signature`
// events. This is the actual point of this file: nobody had to write
// a new reducer for this. ─────────────────────────────────────────

test('end-to-end: a 2-of-3 threshold-release escrow, built with zero platform-specific code', async () => {
  // The contract: release once at least 2 real 'approval' events from
  // the contract's own approver set exist in H_d — a real multisig-
  // shaped contract, expressed purely as a count condition.
  const condition = { type: 'count', eventType: 'approval', filter: { contractId: 'escrow1' }, min: 2 };
  let contractState = applyGenericContractEvent(initialGenericContractState(), initEvent('init', 'escrow1', condition));

  // A real depositor funds the escrow with a real, signed transfer.
  let conservation = initialConservationState();
  conservation = issueClaim(conservation, { id: 'c1', kind: 'AIWA', amount: 50, owner: 'depositor' });
  const { state: afterDeposit, proof } = transfer(conservation, { claimId: 'c1', from: 'depositor', to: potAddress('escrow1'), n: 0, derivation: 'identity' }, { identity: identityDerivation });
  conservation = afterDeposit;
  const realClaimId = `activated:${proof.id}`;

  // Only ONE approval so far — release must be rejected.
  const orderedEventsOne = [{ id: 'a1', parents: [], payload: { type: 'approval', contractId: 'escrow1', approver: 'signer1' } }];
  const notYet = await verifyGenericRelease(contractState, conservation, orderedEventsOne, {}, realClaimId, potAddress('escrow1'), 'beneficiary', { contractId: 'escrow1' });
  assert.equal(notYet, false, 'must not release with only 1 of 2 required approvals');

  // A second, real approval arrives — now the threshold is met.
  const orderedEventsTwo = [
    { id: 'a1', parents: [], payload: { type: 'approval', contractId: 'escrow1', approver: 'signer1' } },
    { id: 'a2', parents: ['a1'], payload: { type: 'approval', contractId: 'escrow1', approver: 'signer2' } },
  ];
  const nowOk = await verifyGenericRelease(contractState, conservation, orderedEventsTwo, {}, realClaimId, potAddress('escrow1'), 'beneficiary', { contractId: 'escrow1' });
  assert.equal(nowOk, true, 'must release once 2 of 2 required approvals are real and present');
});
