import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeFormulas, initialFormulaRegistryState, GENESIS_FORMULA_ID, GENESIS_FORMULA_PARAMS } from '../public/js/core/economics/formula-registry-reducer.js';

test('genesis formula is always present, even over an empty event list', () => {
  const state = materializeFormulas([]);
  assert.deepEqual(state.formulas[GENESIS_FORMULA_ID], { ...GENESIS_FORMULA_PARAMS, mintedBy: null, mintedAt: 0 });
});

test('a real mint registers a new, permanent formula', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'formula-register', id: 'my-formula', alpha: 1, beta: 0, gamma: 1, C: 5, minQ: 2, mintedBy: 'alice', at: 0 });

  const state = materializeFormulas(dag.topoOrder());
  assert.deepEqual(state.formulas['my-formula'], { alpha: 1, beta: 0, gamma: 1, C: 5, minQ: 2, mintedBy: 'alice', mintedAt: 0 });
});

test('the exact same id cannot be minted twice — exactly one registration wins, deterministically, regardless of which was authored "first"', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'formula-register', id: 'my-formula', alpha: 1, beta: 0, gamma: 1, C: 5, minQ: 2, mintedBy: 'alice', at: 0 });
  await dag.addEvent([genesis], { type: 'formula-register', id: 'my-formula', alpha: 99, beta: 99, gamma: 99, C: 99, minQ: 99, mintedBy: 'attacker', at: 1 });

  // Both events share the same parent (genesis) — the DAG has no real
  // time-order between them, only a deterministic topo-sort tie-break.
  // The property that matters isn't "the honest one always wins" (a
  // real network can't guarantee who writes first), it's that exactly
  // one wins, and every replica that folds this same DAG agrees on
  // which one — verified below by folding twice independently.
  const stateA = materializeFormulas(dag.topoOrder());
  const stateB = materializeFormulas(dag.topoOrder());
  assert.deepEqual(stateA, stateB); // deterministic — same fold, same winner, every time
  assert.equal(stateA.rejections.length, 1); // exactly one of the two was rejected as a duplicate
  assert.ok(stateA.formulas['my-formula'].alpha === 1 || stateA.formulas['my-formula'].alpha === 99); // exactly one survives, immutable from then on
});

test('the genesis id itself cannot be re-minted, even by someone trying to overwrite protocol defaults', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const attempt = await dag.addEvent([genesis], { type: 'formula-register', id: GENESIS_FORMULA_ID, alpha: 0, beta: 0, gamma: 0, C: 0, minQ: 0, mintedBy: 'attacker', at: 0 });

  const state = materializeFormulas(dag.topoOrder());
  assert.deepEqual(state.formulas[GENESIS_FORMULA_ID], { ...GENESIS_FORMULA_PARAMS, mintedBy: null, mintedAt: 0 });
  assert.equal(state.rejections.some((r) => r.eventId === attempt), true);
});

test('two domains that mint independently, then reconcile, converge to the identical formula registry', async () => {
  const earth = new EventDag();
  const eGenesis = await earth.addEvent([], { type: 'genesis' });
  await earth.addEvent([eGenesis], { type: 'formula-register', id: 'earth-formula', alpha: 1, beta: 1, gamma: 1, C: 1, minQ: 1, mintedBy: 'earth', at: 0 });

  const mars = new EventDag();
  const mGenesis = await mars.addEvent([], { type: 'genesis' });
  await mars.addEvent([mGenesis], { type: 'formula-register', id: 'mars-formula', alpha: 2, beta: 2, gamma: 2, C: 2, minQ: 2, mintedBy: 'mars', at: 0 });

  const forward = new EventDag();
  forward.merge(earth);
  forward.merge(mars);
  const backward = new EventDag();
  backward.merge(mars);
  backward.merge(earth);

  const stateForward = materializeFormulas(forward.topoOrder());
  const stateBackward = materializeFormulas(backward.topoOrder());
  assert.deepEqual(stateForward, stateBackward);
  assert.ok(stateForward.formulas['earth-formula']);
  assert.ok(stateForward.formulas['mars-formula']);
});

test('malformed formula-register events are rejected without throwing', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'formula-register', id: '', alpha: 1, beta: 1, gamma: 1, C: 1, minQ: 1 });
  await dag.addEvent([genesis], { type: 'formula-register', id: 'bad', alpha: NaN, beta: 1, gamma: 1, C: 1, minQ: 1 });
  const state = materializeFormulas(dag.topoOrder());
  assert.equal(state.formulas.bad, undefined);
});

test('initialFormulaRegistryState alone (no fold) already contains genesis', () => {
  const state = initialFormulaRegistryState();
  assert.ok(state.formulas[GENESIS_FORMULA_ID]);
});

test('REGRESSION: a minted formula entry is flat (no nested .params) — a near-miss bug in main.js confused this with the Rust shape, silently falling back to genesis on every switch', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'formula-register', id: 'my-formula', alpha: 7, beta: 8, gamma: 9, C: 10, minQ: 11, mintedBy: 'alice', at: 0 });

  const state = materializeFormulas(dag.topoOrder());
  const entry = state.formulas['my-formula'];
  // The bug: main.js read entry?.params?.alpha (always undefined here),
  // triggering a silent fallback to GENESIS_FORMULA_PARAMS on every
  // switch to a minted formula. This assertion is what a correct fix
  // must satisfy: fields live directly on the entry, not nested.
  assert.equal(entry.params, undefined);
  assert.equal(entry.alpha, 7);
  assert.equal(entry.beta, 8);
});
