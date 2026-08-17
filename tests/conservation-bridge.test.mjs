import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';
import { materializeConservation, buildSignedTransferEvent } from '../public/js/core/conservation/conservation-bridge.js';
import { deriveDomainId } from '../public/js/core/identity/domain-id.js';

const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: {} };

function makeSigner() {
  const seed = ed25519.utils.randomPrivateKey();
  const pubkeyBytes = ed25519.getPublicKey(seed);
  return { seed, pubkeyBytes };
}

async function buildDomainWith50(dag, domainId) {
  const genesis = await dag.addEvent([], { type: 'genesis' });
  let last = genesis, lastCadence = null;
  for (let e = 1; e <= 5; e++) {
    const parents = [...new Set([lastCadence ?? genesis, last])];
    const id = await dag.addEvent(parents, { type: 'cadence', domain: domainId, epoch: e });
    lastCadence = id; last = id;
  }
  return dag.addEvent([last], { type: 'accrual', domain: domainId, b: 10, q0: 0, T: 0 });
}

test('a claim-issue event debits the balance in G and creates a claim in Conservation', async () => {
  const alice = makeSigner();
  const aliceId = await deriveDomainId(alice.pubkeyBytes);
  const dag = new EventDag();
  const last = await buildDomainWith50(dag, aliceId);
  await dag.addEvent([last], { type: 'claim-issue', domain: aliceId, id: 'c1', amount: 20 });

  const gState = materializeG(theta, dag.topoOrder());
  const conState = await materializeConservation(dag.topoOrder());
  assert.equal(gState.balances[aliceId], 30);
  assert.equal(conState.conservation.claims.c1.amount, 20);
  assert.equal(conState.conservation.claims.c1.owner, aliceId);
});

test('a signed transfer moves real ownership from alice to bob, verified for real', async () => {
  const alice = makeSigner();
  const aliceId = await deriveDomainId(alice.pubkeyBytes);
  const bobId = 'bob-domain-id-placeholder';

  const dag = new EventDag();
  let last = await buildDomainWith50(dag, aliceId);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: aliceId, id: 'c1', amount: 20 });

  const transferEvent = buildSignedTransferEvent({ claimId: 'c1', from: aliceId, to: bobId }, alice.seed, alice.pubkeyBytes);
  await dag.addEvent([last], { type: 'transfer', ...transferEvent });

  const gState = materializeG(theta, dag.topoOrder());
  const conState = await materializeConservation(dag.topoOrder());
  assert.equal(gState.balances[aliceId], 30);
  const bobClaims = Object.values(conState.conservation.claims).filter((c) => c.owner === bobId && c.status === 'active');
  assert.equal(bobClaims.length, 1);
  assert.equal(bobClaims[0].amount, 20);
});

test('SECURITY: a forged transfer (attacker claims a from they do not control) is rejected — the vulnerability this file was built to close', async () => {
  const alice = makeSigner();
  const aliceId = await deriveDomainId(alice.pubkeyBytes);
  const attacker = makeSigner(); // a real key, but NOT alice's

  const dag = new EventDag();
  let last = await buildDomainWith50(dag, aliceId);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: aliceId, id: 'c1', amount: 20 });

  // Attacker signs with their OWN key, but claims `from: aliceId` — exactly
  // the forgery the string-comparison-only version of this code allowed.
  const forgedEvent = buildSignedTransferEvent({ claimId: 'c1', from: aliceId, to: 'attacker-domain' }, attacker.seed, attacker.pubkeyBytes);
  await dag.addEvent([last], { type: 'transfer', ...forgedEvent });

  const conState = await materializeConservation(dag.topoOrder());
  assert.equal(conState.conservation.claims.c1.owner, aliceId); // untouched
  assert.equal(conState.conservation.claims.c1.status, 'active'); // never consumed
  const attackerClaims = Object.values(conState.conservation.claims).filter((c) => c.owner === 'attacker-domain');
  assert.equal(attackerClaims.length, 0);
});

test('SECURITY: a real signature over tampered fields (wrong claimId) is rejected', async () => {
  const alice = makeSigner();
  const aliceId = await deriveDomainId(alice.pubkeyBytes);
  const dag = new EventDag();
  let last = await buildDomainWith50(dag, aliceId);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: aliceId, id: 'c1', amount: 20 });

  const legitEvent = buildSignedTransferEvent({ claimId: 'c1', from: aliceId, to: 'bob' }, alice.seed, alice.pubkeyBytes);
  const tampered = { ...legitEvent, claimId: 'c1-different' }; // signature no longer matches this field set
  await dag.addEvent([last], { type: 'transfer', ...tampered });

  const conState = await materializeConservation(dag.topoOrder());
  assert.equal(conState.conservation.claims.c1.status, 'active');
});

test('a replayed transfer nonce is rejected — cannot re-apply the same signed transfer twice', async () => {
  const alice = makeSigner();
  const aliceId = await deriveDomainId(alice.pubkeyBytes);
  const dag = new EventDag();
  let last = await buildDomainWith50(dag, aliceId);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: aliceId, id: 'c1', amount: 20 });

  const event1 = buildSignedTransferEvent({ claimId: 'c1', from: aliceId, to: 'bob' }, alice.seed, alice.pubkeyBytes, { nonce: 'fixed-nonce' });
  last = await dag.addEvent([last], { type: 'transfer', ...event1 });
  // A second event reusing the exact same signed payload/nonce.
  await dag.addEvent([last], { type: 'transfer', ...event1 });

  const conState = await materializeConservation(dag.topoOrder());
  // Only ever consumed once — the second application is a no-op replay.
  const activated = Object.values(conState.conservation.claims).filter((c) => c.owner === 'bob' && c.status === 'active');
  assert.equal(activated.length, 1);
});

test('an old-format (unsigned) transfer payload is rejected, not crashed on', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'transfer', claimId: 'c1', from: 'alice', to: 'bob' }); // no signature fields at all
  const conState = await materializeConservation(dag.topoOrder());
  assert.deepEqual(conState.conservation.claims, {});
});

test('malformed claim-issue events are folded through without throwing', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'claim-issue', domain: '', id: 'x', amount: 10 });
  const conState = await materializeConservation(dag.topoOrder());
  assert.deepEqual(conState.conservation.claims, {});
});

// ── SECURITY: over-issuance found while wiring the jackpot module ───

test('SECURITY REGRESSION: a domain with zero real balance cannot create a real, spendable claim via claim-issue — Conservation must defer to G\'s own verdict', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis', domain: 'alice' });
  // alice has never accrued anything, tries to issue a claim of 1000 anyway.
  const badEvent = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 1000, kind: 'AIWA' });

  const events = dag.topoOrder();
  const gState = materializeG(theta, events);
  assert.equal(gState.balances.alice ?? 0, 0, 'G correctly has no balance for alice');
  assert.ok(gState.accrualRejections.some((r) => r.eventId === badEvent), 'G correctly rejected the over-issuance');

  const rejectedIds = new Set(gState.accrualRejections.map((r) => r.eventId));
  const conState = await materializeConservation(events, undefined, rejectedIds);
  assert.equal(conState.conservation.claims.c1, undefined, 'Conservation must NOT create a claim G already rejected — this was the real bug found and fixed');
});

test('a real, sufficiently-funded claim-issue is unaffected by the gRejectedEventIds cross-check', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis', domain: 'alice' });
  let last = genesis;
  let lastCadence = null;
  for (let e = 1; e <= 5; e++) {
    const parents = [...new Set([lastCadence ?? last, last])];
    const id = await dag.addEvent(parents, { type: 'cadence', domain: 'alice', epoch: e });
    lastCadence = id; last = id;
  }
  last = await dag.addEvent([last], { type: 'accrual', domain: 'alice', b: 10, q0: 0, T: 0 });
  await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 20, kind: 'AIWA' });

  const events = dag.topoOrder();
  const gState = materializeG(theta, events);
  const rejectedIds = new Set(gState.accrualRejections.map((r) => r.eventId));
  const conState = await materializeConservation(events, undefined, rejectedIds);
  assert.equal(conState.conservation.claims.c1.amount, 20, 'a real, funded claim-issue must still work exactly as before');
});

test('materializeConservation without gRejectedEventIds at all (omitted entirely) behaves exactly as before this fix — fully backward compatible', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis', domain: 'alice' });
  await dag.addEvent([genesis], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 1000, kind: 'AIWA' });
  const conState = await materializeConservation(dag.topoOrder()); // no verifier, no rejected-ids set at all
  // Documents the exact prior (vulnerable) behavior when the fix is not opted into — main.js always opts in now, but this confirms the parameter is additive, not a silent behavior change for any caller that doesn't pass it.
  assert.equal(conState.conservation.claims.c1.amount, 1000);
});

// ── 'pot-release': signature-free but recomputation-verified ────────

test('a pot-release event is rejected outright when no verifier is supplied — safe by default', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const issueId = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'jackpot-pot:my-pot', id: 'c1', amount: 10, kind: 'AIWA' });
  await dag.addEvent([issueId], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'alice', nonce: 'n1', releaseProof: {} });
  const conState = await materializeConservation(dag.topoOrder()); // no verifyPotRelease at all
  assert.equal(conState.conservation.claims.c1.owner, 'jackpot-pot:my-pot', 'must remain unreleased with no verifier wired in');
});

test('a pot-release event is accepted when the injected verifier approves it', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const issueId = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'jackpot-pot:my-pot', id: 'c1', amount: 10, kind: 'AIWA' });
  await dag.addEvent([issueId], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'alice', nonce: 'n1', releaseProof: {} });
  const alwaysApprove = () => true;
  const conState = await materializeConservation(dag.topoOrder(), alwaysApprove);
  const aliceClaims = Object.values(conState.conservation.claims).filter((c) => c.owner === 'alice' && c.status === 'active');
  assert.equal(aliceClaims.length, 1);
  assert.equal(aliceClaims[0].amount, 10);
});

test('a pot-release event is rejected when the injected verifier disapproves it', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const issueId = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'jackpot-pot:my-pot', id: 'c1', amount: 10, kind: 'AIWA' });
  await dag.addEvent([issueId], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'alice', nonce: 'n1', releaseProof: {} });
  const alwaysReject = () => false;
  const conState = await materializeConservation(dag.topoOrder(), alwaysReject);
  assert.equal(conState.conservation.claims.c1.owner, 'jackpot-pot:my-pot');
});

test('a pot-release replaying the same nonce is rejected, the same replay protection ordinary transfers already get', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const issueId = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'jackpot-pot:my-pot', id: 'c1', amount: 10, kind: 'AIWA' });
  const alwaysApprove = () => true;
  let last = await dag.addEvent([issueId], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'alice', nonce: 'fixed-nonce', releaseProof: {} });
  await dag.addEvent([last], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'bob', nonce: 'fixed-nonce', releaseProof: {} });
  const conState = await materializeConservation(dag.topoOrder(), alwaysApprove);
  const bobClaims = Object.values(conState.conservation.claims).filter((c) => c.owner === 'bob');
  assert.equal(bobClaims.length, 0, 'the replayed nonce must not let a second release through');
});

test('a throwing verifier is treated as a rejection, not a crash', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const issueId = await dag.addEvent([genesis], { type: 'claim-issue', domain: 'jackpot-pot:my-pot', id: 'c1', amount: 10, kind: 'AIWA' });
  await dag.addEvent([issueId], { type: 'pot-release', claimId: 'c1', from: 'jackpot-pot:my-pot', to: 'alice', nonce: 'n1', releaseProof: {} });
  const throwingVerifier = () => { throw new Error('boom'); };
  const conState = await materializeConservation(dag.topoOrder(), throwingVerifier);
  assert.equal(conState.conservation.claims.c1.owner, 'jackpot-pot:my-pot');
});
