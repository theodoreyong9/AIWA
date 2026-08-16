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
