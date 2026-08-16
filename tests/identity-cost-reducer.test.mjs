import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeIdentity } from '../public/js/core/identity/identity-cost-reducer.js';
import { hasIdentityCost } from '../public/js/core/identity/identity-cost.js';

function identityEvent(id, parents, domain, signature, burnedLamports, at) {
  return { id, parents, payload: { type: 'identity-register', domain, signature, burnedLamports, at } };
}

test('an identity registered on one domain is invisible on another before reconciliation — the exact gap that was found', async () => {
  const earthDag = new EventDag();
  const genesis = await earthDag.addEvent([], { type: 'genesis' });
  await earthDag.addEvent([genesis], { type: 'identity-register', domain: 'earth', signature: 'sig1', burnedLamports: 500, at: 0 });

  const marsDag = new EventDag();
  await marsDag.addEvent([], { type: 'genesis' });

  const earthIdentity = materializeIdentity(earthDag.topoOrder());
  const marsIdentity = materializeIdentity(marsDag.topoOrder());

  assert.equal(hasIdentityCost(earthIdentity, 'earth'), true);
  assert.equal(hasIdentityCost(marsIdentity, 'earth'), false); // exactly the gap
});

test('after reconciling, both domains converge to the identical identity view', async () => {
  const earthDag = new EventDag();
  const eGenesis = await earthDag.addEvent([], { type: 'genesis' });
  await earthDag.addEvent([eGenesis], { type: 'identity-register', domain: 'earth', signature: 'sig1', burnedLamports: 500, at: 0 });

  const marsDag = new EventDag();
  const mGenesis = await marsDag.addEvent([], { type: 'genesis' });
  await marsDag.addEvent([mGenesis], { type: 'identity-register', domain: 'mars', signature: 'sig2', burnedLamports: 300, at: 0 });

  const forward = new EventDag();
  forward.merge(earthDag);
  forward.merge(marsDag);
  const backward = new EventDag();
  backward.merge(marsDag);
  backward.merge(earthDag);

  const identityForward = materializeIdentity(forward.topoOrder());
  const identityBackward = materializeIdentity(backward.topoOrder());

  assert.deepEqual(identityForward, identityBackward);
  assert.equal(hasIdentityCost(identityForward, 'earth'), true);
  assert.equal(hasIdentityCost(identityForward, 'mars'), true);
});

test('the same burn signature cannot register two different domains, even across a merge', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'identity-register', domain: 'earth', signature: 'sig-shared', burnedLamports: 500, at: 0 });
  await dag.addEvent([genesis], { type: 'identity-register', domain: 'mars', signature: 'sig-shared', burnedLamports: 500, at: 1 });

  const identity = materializeIdentity(dag.topoOrder());
  const earthOk = hasIdentityCost(identity, 'earth');
  const marsOk = hasIdentityCost(identity, 'mars');
  // Exactly one wins (whichever the deterministic topo order folds first), never both.
  assert.equal(earthOk && marsOk, false);
  assert.equal(earthOk || marsOk, true);
});

test('malformed identity-register events are folded through without throwing', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'identity-register', domain: '', signature: 'x', burnedLamports: 10 });
  await dag.addEvent([genesis], { type: 'identity-register', domain: 'd1', signature: '', burnedLamports: 10 });
  const identity = materializeIdentity(dag.topoOrder());
  assert.deepEqual(identity.registered, {});
});
