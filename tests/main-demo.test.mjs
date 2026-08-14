// main-demo.test.mjs — pins the exact behavior of the two-domain
// (Earth/Mars) interplanetary demo built by public/js/app/main.js, so a
// change to the economics reducers that silently changes what the
// deployed page shows gets caught here rather than only visually, in a
// browser.
//
// This intentionally duplicates DomainReplica's logic rather than
// importing it from main.js, since main.js also touches the DOM
// (document.*) and is not meant to be imported in a non-browser test
// environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeG } from '../public/js/core/economics/g.js';

const theta = { reward: { K: 1, alpha: 1, beta: 1 }, budgets: { earth: 1000, mars: 1000 } };

class DomainReplica {
  constructor(name, dag) {
    this.name = name;
    this.dag = dag;
    this.genesisId = null;
    this.lastEventId = null;
    this.lastCadenceId = null;
    this.epoch = 0;
    this.pending = [];
  }
  async advanceCadence() {
    const nextEpoch = this.epoch + 1;
    const parents = [...new Set([this.lastCadenceId ?? this.genesisId, this.lastEventId])];
    const id = await this.dag.addEvent(parents, { type: 'cadence', domain: this.name, epoch: nextEpoch });
    this.lastCadenceId = id;
    this.lastEventId = id;
    this.epoch = nextEpoch;
    return id;
  }
  commit(amount) {
    this.pending.push({ b: amount, q0: this.epoch });
  }
  async claim() {
    const claimed = this.pending;
    this.pending = [];
    for (const c of claimed) {
      const id = await this.dag.addEvent([this.lastEventId], { type: 'accrual', domain: this.name, b: c.b, q0: c.q0 });
      this.lastEventId = id;
    }
    return claimed.length;
  }
  materialize() {
    return materializeG(theta, this.dag.topoOrder());
  }
}

async function makeReplica(name) {
  const replica = new DomainReplica(name, new EventDag());
  const genesisId = await replica.dag.addEvent([], { type: 'genesis' });
  replica.genesisId = genesisId;
  replica.lastEventId = genesisId;
  return replica;
}

test('commit() records a pending claim without touching the ledger', async () => {
  const earth = await makeReplica('earth');
  earth.commit(10);
  assert.equal(earth.pending.length, 1);
  assert.equal(earth.dag.size, 1); // still just genesis — commit is not a ledger event
});

test('claim() posts pending commits and reward reflects elapsed cadence epochs since q0, not instant', async () => {
  const earth = await makeReplica('earth');
  earth.commit(10); // q0 = 0
  await earth.advanceCadence();
  await earth.advanceCadence(); // epoch = 2
  const claimedCount = await earth.claim();

  assert.equal(claimedCount, 1);
  assert.equal(earth.materialize().balances.earth, 20); // K=1, b=10, q=2-0=2
});

test('Earth and Mars share the same genesis id without any coordination (content-addressed, §8.1)', async () => {
  const earth = await makeReplica('earth');
  const mars = await makeReplica('mars');
  assert.equal(earth.genesisId, mars.genesisId);
});

test('two domains accrue independently while partitioned, then converge exactly after reconcile', async () => {
  const earth = await makeReplica('earth');
  const mars = await makeReplica('mars');

  earth.commit(10);
  await earth.advanceCadence();
  await earth.advanceCadence();
  await earth.claim(); // earth balance: 10 * 2 = 20

  await mars.advanceCadence();
  mars.commit(10);
  await mars.advanceCadence();
  await mars.claim(); // mars balance: 10 * 1 = 10

  assert.equal(earth.materialize().balances.earth, 20);
  assert.equal(mars.materialize().balances.mars, 10);

  // Reconcile: set union, both directions.
  earth.dag.merge(mars.dag);
  mars.dag.merge(earth.dag);

  const earthView = earth.materialize();
  const marsView = mars.materialize();

  assert.deepEqual(earthView.balances, marsView.balances);
  assert.deepEqual(earthView.balances, { earth: 20, mars: 10 });
  assert.equal(earth.dag.size, mars.dag.size);
  assert.equal(earth.dag.size, 7); // shared genesis + 2 cadence + 1 accrual (earth) + 2 cadence + 1 accrual (mars)
});
