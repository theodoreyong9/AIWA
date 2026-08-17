import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialConservationState, issueClaim, transfer, identityDerivation } from '../public/js/core/conservation/conservation.js';
import {
  potAddress, initialPoolState, applyPoolEvent, materializePool, computeWeightedDraw, verifyPoolPayout,
} from '../public/js/core/pool/pool-reducer.js';

/**
 * Builds a real Conservation state where `contributorDomain` has
 * ALREADY really transferred a real claim to the pool — exactly what a
 * legitimate contribution requires to exist first. Returns the REAL
 * final claim id the pool now owns (transfer() activates a NEW claim
 * id, `activated:${proof.id}` — the original claimId is left Consumed,
 * not reusable), since that is what a real pool-contribute event must
 * reference, not the pre-transfer id.
 */
function conservationWithRealContribution(poolId, contributorDomain, preTransferClaimId, amount) {
  let state = initialConservationState();
  state = issueClaim(state, { id: preTransferClaimId, kind: 'AIWA', amount, owner: contributorDomain });
  const { state: afterTransfer, proof } = transfer(state, { claimId: preTransferClaimId, from: contributorDomain, to: potAddress(poolId), n: 0, derivation: 'identity' }, { identity: identityDerivation });
  return { conservation: afterTransfer, realClaimId: `activated:${proof.id}` };
}

function initEvent(id, poolId, cycleLengthContributions) {
  return { id, payload: { type: 'pool-init', poolId, cycleLengthContributions, mintedBy: 'alice', at: 0 } };
}
function contributeEvent(id, poolId, contributorDomain, claimId) {
  return { id, payload: { type: 'pool-contribute', poolId, contributorDomain, claimId } };
}

test('potAddress never collides with a real domain id — it is a distinguishable, structured string', () => {
  assert.equal(potAddress('my-pool'), 'jackpot-pot:my-pool');
  assert.notEqual(potAddress('my-pool'), 'my-pool');
});

test('pool-init mints a real, usable pool', () => {
  const state = applyPoolEvent(initialPoolState(), initEvent('e1', 'pool1', 5), {});
  assert.ok(state.pools.pool1);
  assert.equal(state.pools.pool1.cycleLengthContributions, 5);
});

test('the same poolId cannot be re-initialized — permanent once minted, same discipline as a minted formula', () => {
  let state = applyPoolEvent(initialPoolState(), initEvent('e1', 'pool1', 5), {});
  state = applyPoolEvent(state, initEvent('e2', 'pool1', 999), {});
  assert.equal(state.pools.pool1.cycleLengthContributions, 5); // untouched by the second attempt
  assert.equal(state.rejections.length, 1);
});

test('pool-init rejects a non-positive or non-integer cycle length', () => {
  let state = applyPoolEvent(initialPoolState(), initEvent('e1', 'pool1', 0), {});
  assert.equal(state.pools.pool1, undefined);
  state = applyPoolEvent(initialPoolState(), initEvent('e1', 'pool1', 2.5), {});
  assert.equal(state.pools.pool1, undefined);
});

test('a real contribution (claim genuinely transferred to the pool first) is recorded', () => {
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {});
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', realClaimId), conservation);
  assert.equal(state.cycles.pool1[0].contributions.length, 1);
  assert.equal(state.cycles.pool1[0].contributions[0].amount, 10);
});

test('SECURITY: a contribution referencing a claim never actually transferred to the pool is rejected', () => {
  // alice really owns c1, but never transferred it to the pool — a
  // forged pool-contribute event claiming otherwise.
  let conservation = initialConservationState();
  conservation = issueClaim(conservation, { id: 'c1', kind: 'AIWA', amount: 10, owner: 'alice' });

  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {});
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', 'c1'), conservation);
  assert.equal(state.cycles.pool1, undefined);
  assert.equal(state.rejections.length, 1);
});

test('SECURITY: the original pre-transfer claim id no longer refers to a pool-owned claim once consumed — using it in a contribute event is rejected', () => {
  const { conservation } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {});
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', 'c1'), conservation); // stale, pre-transfer id
  assert.equal(state.cycles.pool1, undefined);
  assert.equal(state.rejections.length, 1);
});

test('SECURITY: a contribution claiming a bigger amount than the real transferred claim is impossible — amount is read from the real claim, never trusted from the event', () => {
  // The event payload itself doesn't even carry an amount field — this
  // test confirms the recorded amount always matches the REAL claim.
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 7);
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {});
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', realClaimId), conservation);
  assert.equal(state.cycles.pool1[0].contributions[0].amount, 7);
});

test('SECURITY: the same real claim cannot back two separate contributions', () => {
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {});
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', realClaimId), conservation);
  state = applyPoolEvent(state, contributeEvent('d2', 'pool1', 'alice', realClaimId), conservation); // same claimId again
  assert.equal(state.cycles.pool1[0].contributions.length, 1); // only counted once
});

test('a contribution for an unknown pool is rejected without throwing', () => {
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  const state = applyPoolEvent(initialPoolState(), contributeEvent('d1', 'nonexistent-pool', 'alice', realClaimId), conservation);
  assert.equal(state.rejections.length, 1);
});

test('cycle assignment is computed from the real fold, never self-declared — contributions fill cycle 0 before cycle 1 opens', () => {
  let conservation = initialConservationState();
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 2), {}); // 2 contributions per cycle

  for (let i = 0; i < 3; i++) {
    const preId = `c${i}`;
    conservation = issueClaim(conservation, { id: preId, kind: 'AIWA', amount: 5, owner: 'alice' });
    const { state: afterTransfer, proof } = transfer(conservation, { claimId: preId, from: 'alice', to: potAddress('pool1'), n: 0, derivation: 'identity' }, { identity: identityDerivation });
    conservation = afterTransfer;
    state = applyPoolEvent(state, contributeEvent(`d${i}`, 'pool1', 'alice', `activated:${proof.id}`), conservation);
  }

  assert.equal(state.cycles.pool1[0].contributions.length, 2, 'cycle 0 fills up to its configured length');
  assert.equal(state.cycles.pool1[1].contributions.length, 1, 'the third contribution spills into cycle 1');
});

test('materializePool folds a real sequence exactly like applyPoolEvent called in a loop', () => {
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  const events = [initEvent('i', 'pool1', 5), contributeEvent('d1', 'pool1', 'alice', realClaimId)];
  const state = materializePool(events, conservation);
  assert.equal(state.cycles.pool1[0].contributions.length, 1);
});

test('computeWeightedDraw is deterministic — the identical contribution history always produces the identical winner', async () => {
  const contributions = [{ contributorDomain: 'alice', claimId: 'c1', amount: 10 }, { contributorDomain: 'bob', claimId: 'c2', amount: 5 }];
  const draw1 = await computeWeightedDraw('pool1', 0, contributions);
  const draw2 = await computeWeightedDraw('pool1', 0, contributions);
  assert.deepEqual(draw1, draw2);
});

test('computeWeightedDraw weights by real ticket count — a much larger contributor wins far more often across many simulated draws', async () => {
  let aliceWins = 0;
  const trials = 60;
  for (let i = 0; i < trials; i++) {
    // Vary claimId per trial so the hash input — and therefore the
    // draw — differs each time, simulating many independent cycles.
    const contributions = [{ contributorDomain: 'alice', claimId: `big-${i}`, amount: 95 }, { contributorDomain: 'bob', claimId: `small-${i}`, amount: 5 }];
    const draw = await computeWeightedDraw('pool1', i, contributions);
    if (draw.winnerDomain === 'alice') aliceWins++;
  }
  assert.ok(aliceWins > trials * 0.8, `alice (95% of tickets) should win the large majority of trials, won ${aliceWins}/${trials}`);
});

test('computeWeightedDraw returns null for an empty contribution list rather than throwing', async () => {
  const draw = await computeWeightedDraw('pool1', 0, []);
  assert.equal(draw, null);
});

test('computeWeightedDraw returns null when every contribution rounds down to zero tickets', async () => {
  const draw = await computeWeightedDraw('pool1', 0, [{ contributorDomain: 'alice', claimId: 'c1', amount: 0.4 }]);
  assert.equal(draw, null);
});

test('computeWeightedDraw totalAmount sums every real contribution amount exactly', async () => {
  const draw = await computeWeightedDraw('pool1', 0, [{ contributorDomain: 'alice', claimId: 'c1', amount: 10 }, { contributorDomain: 'bob', claimId: 'c2', amount: 15 }]);
  assert.equal(draw.totalAmount, 25);
});

// ── verifyPoolPayout — the security-critical function ───────────────

async function setupClosedCycle(poolId = 'pool1', cycleLength = 2) {
  let conservation = initialConservationState();
  let state = applyPoolEvent(initialPoolState(), initEvent('i', poolId, cycleLength), {});
  const claimIds = [];
  for (let i = 0; i < cycleLength; i++) {
    const preId = `c${i}`;
    conservation = issueClaim(conservation, { id: preId, kind: 'AIWA', amount: 10 + i, owner: `contributor${i}` });
    const { state: afterTransfer, proof } = transfer(conservation, { claimId: preId, from: `contributor${i}`, to: potAddress(poolId), n: 0, derivation: 'identity' }, { identity: identityDerivation });
    conservation = afterTransfer;
    const realClaimId = `activated:${proof.id}`;
    claimIds.push(realClaimId);
    state = applyPoolEvent(state, contributeEvent(`d${i}`, poolId, `contributor${i}`, realClaimId), conservation);
  }
  const draw = await computeWeightedDraw(poolId, 0, state.cycles[poolId][0].contributions);
  return { poolState: state, conservationState: conservation, claimIds, winner: draw.winnerDomain };
}

test('a legitimate payout to the real, recomputed winner is accepted', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  const ok = await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('pool1'), winner, { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, true);
});

test('SECURITY: a payout to anyone other than the real recomputed winner is rejected', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  const impostor = winner === 'contributor0' ? 'contributor1' : 'contributor0';
  const ok = await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('pool1'), impostor, { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a payout before the cycle has actually closed (not enough real contributions) is rejected', async () => {
  const { conservation, realClaimId } = conservationWithRealContribution('pool1', 'alice', 'c1', 10);
  let state = applyPoolEvent(initialPoolState(), initEvent('i', 'pool1', 5), {}); // needs 5 contributions
  state = applyPoolEvent(state, contributeEvent('d1', 'pool1', 'alice', realClaimId), conservation); // only 1 posted
  const ok = await verifyPoolPayout(state, conservation, realClaimId, potAddress('pool1'), 'alice', { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a payout for a claim that was never part of this cycle is rejected, even if it is genuinely pool-owned from elsewhere', async () => {
  const { poolState, conservationState, winner } = await setupClosedCycle();
  // A claim owned by the pool but never recorded as a real contribution to THIS cycle.
  let conservation2 = issueClaim(conservationState, { id: 'unrelated-claim', kind: 'AIWA', amount: 999, owner: potAddress('pool1') });
  const ok = await verifyPoolPayout(poolState, conservation2, 'unrelated-claim', potAddress('pool1'), winner, { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a payout for an already-released claim is rejected — cannot pay the same claim out twice', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  const afterRelease = transfer(conservationState, { claimId: claimIds[0], from: potAddress('pool1'), to: winner, n: 0, derivation: 'identity' }, { identity: identityDerivation }).state;
  const ok = await verifyPoolPayout(poolState, afterRelease, claimIds[0], potAddress('pool1'), winner, { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a payout claiming the wrong `from` (not the real pool address) is rejected', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  const ok = await verifyPoolPayout(poolState, conservationState, claimIds[0], 'not-the-real-pool-address', winner, { poolId: 'pool1', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a payout for an unknown pool is rejected', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  const ok = await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('nonexistent'), winner, { poolId: 'nonexistent', cycleIndex: 0 });
  assert.equal(ok, false);
});

test('SECURITY: a malformed releaseProof is rejected without throwing', async () => {
  const { poolState, conservationState, claimIds, winner } = await setupClosedCycle();
  assert.equal(await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('pool1'), winner, null), false);
  assert.equal(await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('pool1'), winner, {}), false);
  assert.equal(await verifyPoolPayout(poolState, conservationState, claimIds[0], potAddress('pool1'), winner, { poolId: 'pool1', cycleIndex: 'zero' }), false);
});
