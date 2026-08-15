import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';
import { materializeConservation } from '../public/js/core/conservation/conservation-bridge.js';

const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: { alice: null, bob: null } };

async function buildAliceWith50(dag) {
  const genesis = await dag.addEvent([], { type: 'genesis' });
  let last = genesis, lastCadence = null;
  for (let e = 1; e <= 5; e++) {
    const parents = [...new Set([lastCadence ?? genesis, last])];
    const id = await dag.addEvent(parents, { type: 'cadence', domain: 'alice', epoch: e });
    lastCadence = id; last = id;
  }
  return dag.addEvent([last], { type: 'accrual', domain: 'alice', b: 10, q0: 0, T: 0 });
}

test('a claim-issue event debits the balance in G and creates a claim in Conservation', async () => {
  const dag = new EventDag();
  const last = await buildAliceWith50(dag);
  await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 20 });

  const gState = materializeG(theta, dag.topoOrder());
  const conState = materializeConservation(dag.topoOrder());
  assert.equal(gState.balances.alice, 30);
  assert.equal(conState.claims.c1.amount, 20);
  assert.equal(conState.claims.c1.owner, 'alice');
  assert.equal(conState.claims.c1.status, 'active');
});

test('claim-issue for more than the current balance is rejected, not clamped', async () => {
  const dag = new EventDag();
  const last = await buildAliceWith50(dag);
  const id = await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 999 });

  const gState = materializeG(theta, dag.topoOrder());
  assert.equal(gState.balances.alice, 50); // unchanged
  assert.equal(gState.accrualRejections.some((r) => r.eventId === id && /insufficient balance/.test(r.reason)), true);
});

test('a full send: alice issues then transfers a claim to bob, real ownership change', async () => {
  const dag = new EventDag();
  let last = await buildAliceWith50(dag);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 20 });
  last = await dag.addEvent([last], { type: 'transfer', claimId: 'c1', from: 'alice', to: 'bob' });

  const gState = materializeG(theta, dag.topoOrder());
  const conState = materializeConservation(dag.topoOrder());
  assert.equal(gState.balances.alice, 30);

  const bobClaims = Object.values(conState.claims).filter((c) => c.owner === 'bob' && c.status === 'active');
  assert.equal(bobClaims.length, 1);
  assert.equal(bobClaims[0].amount, 20);
  assert.equal(conState.claims.c1.status, 'consumed');
});

test('a claim cannot be transferred twice (double-spend rejected during the fold)', async () => {
  const dag = new EventDag();
  let last = await buildAliceWith50(dag);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 20 });
  const t1 = await dag.addEvent([last], { type: 'transfer', claimId: 'c1', from: 'alice', to: 'bob' });
  // A second, conflicting transfer of the same already-consumed claim.
  await dag.addEvent([t1], { type: 'transfer', claimId: 'c1', from: 'alice', to: 'carol' });

  const conState = materializeConservation(dag.topoOrder());
  const carolClaims = Object.values(conState.claims).filter((c) => c.owner === 'carol');
  assert.equal(carolClaims.length, 0); // rejected — carol got nothing
  const bobClaims = Object.values(conState.claims).filter((c) => c.owner === 'bob' && c.status === 'active');
  assert.equal(bobClaims.length, 1); // bob's transfer, which happened first, still stands
});

test('a transfer of a claim not owned by the claimed sender is rejected', async () => {
  const dag = new EventDag();
  let last = await buildAliceWith50(dag);
  last = await dag.addEvent([last], { type: 'claim-issue', domain: 'alice', id: 'c1', amount: 20 });
  // bob never owned c1 — this transfer should be rejected.
  await dag.addEvent([last], { type: 'transfer', claimId: 'c1', from: 'bob', to: 'carol' });

  const conState = materializeConservation(dag.topoOrder());
  assert.equal(conState.claims.c1.owner, 'alice');
  assert.equal(conState.claims.c1.status, 'active');
});

test('malformed claim-issue/transfer events are folded through without throwing', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'claim-issue', domain: '', id: 'x', amount: 10 });
  await dag.addEvent([genesis], { type: 'transfer', claimId: '', from: 'a', to: 'b' });
  const conState = materializeConservation(dag.topoOrder());
  assert.deepEqual(conState.claims, {});
});
