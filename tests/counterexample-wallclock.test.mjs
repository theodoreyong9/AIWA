// counterexample-wallclock.test.mjs — a deliberately broken variant of
// G, in the spirit of §20–22's methodology: break an invariant on
// purpose and show the test harness actually catches it, rather than
// only ever exercising the correct path.
//
// This file's brokenApplyAccrual() is NOT exported from
// public/js/core/economics/ and must never be. It exists only here, to
// be run against and shown to fail.
//
// What it breaks: it computes q from an externally-injected wall-clock
// value instead of from the domain's cadence-derived epoch (§10). The
// whitepaper argues in prose (v1.1 revision note, and the paragraph
// beginning "The wall clock MAY still be used...") that this reopens
// exactly the vulnerability v1.1 closed: a manipulable local clock can
// inflate reward. This test turns that prose claim into an executed
// one — Appendix H.8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';

const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: { d1: null } };

// This broken variant demonstrates a DIFFERENT failure (wall-clock vs.
// cadence-derived time) than the reward formula's own shape — it keeps
// its own simple inline power-law calculation, independent of
// reward.js's real signature, since the point here is q's source, not
// the formula's structure.
const BROKEN_PARAMS = { K: 1, alpha: 1, beta: 1 };

/**
 * Deliberately broken: q is derived from an externally-injected
 * wall-clock reading (`wallClockNow`), not from the cadence state
 * folded from H_d. This is exactly what §10 forbids: "The wall clock...
 * MUST NOT directly determine economic accrual." No cadence events are
 * even consulted — this variant does not build a CadenceState at all.
 */
function materializeBrokenWallClockG(orderedEvents, wallClockNow) {
  const balances = {};
  for (const event of orderedEvents) {
    const payload = event.payload;
    if (!payload || payload.type !== 'accrual') continue;
    const { domain, b, q0 } = payload;
    const q = Math.max(0, wallClockNow - q0); // <-- the broken part: not cadence-derived
    const r = BROKEN_PARAMS.K * b ** BROKEN_PARAMS.alpha * q ** BROKEN_PARAMS.beta;
    balances[domain] = (balances[domain] ?? 0) + r;
  }
  return balances;
}

test('control: the real cadence-derived G is unaffected by a wall-clock perturbation, because it never reads one', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const c1 = await dag.addEvent([genesis], { type: 'cadence', domain: 'd1', epoch: 1 });
  await dag.addEvent([c1], { type: 'accrual', domain: 'd1', b: 10, q0: 0 });

  const orderedEvents = dag.topoOrder();

  // Same converged event set. Two "replicas" materialize it — nothing
  // about wall-clock time is even a parameter here, which is the point.
  const stateA = materializeG(theta, orderedEvents);
  const stateB = materializeG(theta, orderedEvents);

  assert.deepEqual(stateA.balances, stateB.balances);
});

test('counterexample: the broken wall-clock variant DOES diverge on the identical converged event set — the violation the harness must be able to catch', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  // No cadence events at all — the broken variant doesn't consult them.
  await dag.addEvent([genesis], { type: 'accrual', domain: 'd1', b: 10, q0: 0 });

  const orderedEvents = dag.topoOrder();

  // Same H_d. Two "replicas" materialize it at two different wall-clock
  // readings — e.g. one right away, one after reconnecting from a long
  // partition. Per §9, A must depend only on the converged event set;
  // it must NOT depend on when a replica happens to compute it.
  const replicaAt10 = materializeBrokenWallClockG(orderedEvents, 10);
  const replicaAt1000 = materializeBrokenWallClockG(orderedEvents, 1000);

  assert.notEqual(
    replicaAt10.d1,
    replicaAt1000.d1,
    'the broken variant was expected to diverge — if this assertion fails, the counterexample itself is broken, not confirming anything'
  );

  // Concretely: reward scales with elapsed wall-clock units, exactly the
  // "manipulable local clock could inflate reward" failure mode the
  // whitepaper's v1.1 revision note describes in prose.
  assert.equal(replicaAt10.d1, 10 * 10); // K * b * q, q = 10 - 0
  assert.equal(replicaAt1000.d1, 10 * 1000); // q = 1000 - 0, 100x the reward for the same H_d
});
