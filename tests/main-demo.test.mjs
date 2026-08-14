// main-demo.test.mjs — pins the exact values of the demo scenario built
// by public/js/app/main.js's buildDemoHistory(), so a change to the
// economics reducers that silently changes what the deployed page shows
// gets caught here rather than only visually, in a browser.
//
// This intentionally duplicates the event sequence rather than importing
// it from main.js, since main.js also touches the DOM (document.*) and
// is not meant to be imported in a non-browser test environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';

const DOMAIN = 'demo-colony';
const theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { [DOMAIN]: 1000 } };

test('main.js demo scenario materializes to the exact values shown on the deployed page', async () => {
  const ledger = new EventDag();
  const genesis = await ledger.addEvent([], { type: 'genesis' });
  const c1 = await ledger.addEvent([genesis], { type: 'cadence', domain: DOMAIN, epoch: 1 });
  const c2 = await ledger.addEvent([c1], { type: 'cadence', domain: DOMAIN, epoch: 2 });
  await ledger.addEvent([c2], { type: 'accrual', domain: DOMAIN, b: 10, q0: 0 });
  const c3 = await ledger.addEvent([c2], { type: 'cadence', domain: DOMAIN, epoch: 3 });
  await ledger.addEvent([c3], { type: 'accrual', domain: DOMAIN, b: 4, q0: 2 });

  const state = materializeG(theta, ledger.topoOrder());

  assert.equal(ledger.size, 6);
  assert.equal(state.cadence.domains[DOMAIN].epoch, 3);
  assert.equal(state.balances[DOMAIN], 34);
  assert.equal(state.scarcity.domains[DOMAIN].used, 34);
  assert.equal(state.cadence.rejections.length, 0);
  assert.equal(state.accrualRejections.length, 0);
});
