// g-scenario.test.mjs — regression test pinning the exact materialized
// values for the shared cross-language fixture
// (test-vectors/g-scenario.json). If this ever fails without an
// intentional change to g.js/cadence.js/reward.js/scarcity.js, either
// the reducer logic changed unintentionally or topoOrder()'s
// tie-breaking rule changed — see the "Materialization order" note in
// README.md's Phase 5 section for why the latter matters here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';

test('shared g-scenario fixture materializes to the exact pinned values', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../test-vectors/g-scenario.json', import.meta.url)));
  const theta = { reward: { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 }, budgets: { d1: 100, d2: null } };

  const dag = new EventDag();
  const idByLabel = {};
  for (const entry of fixture) {
    const parentIds = entry.parents.map((label) => idByLabel[label]);
    idByLabel[entry.label] = await dag.addEvent(parentIds, entry.payload);
  }

  const state = materializeG(theta, dag.topoOrder());

  assert.equal(state.cadence.domains.d1.epoch, 3);
  assert.equal(state.cadence.domains.d2.epoch, 1);
  assert.equal(state.cadence.rejections.length, 1); // the deliberate epoch-skip in the fixture
  assert.equal(state.balances.d1, 40);
  assert.equal(state.balances.d2, 20);
  assert.equal(state.accrualRejections.length, 1); // the deliberate negative-b accrual in the fixture
});
