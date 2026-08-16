import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializePublicProfiles, initialPublicProfileState, publishedDataForDomain } from '../public/js/core/profile/public-profile-reducer.js';

function publishEvent(id, parents, domain, moduleId, key, value, at) {
  return { id, parents, payload: { type: 'module-data-published', domain, moduleId, key, value, at } };
}

test('a published value is materialized, readable via publishedDataForDomain', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });

  const state = materializePublicProfiles(dag.topoOrder());
  const published = publishedDataForDomain(state, 'alice');
  assert.equal(published['status.js'].mood.value, 'curious');
});

test('visiting a domain that has published nothing returns an empty object, not an error', () => {
  const state = initialPublicProfileState();
  assert.deepEqual(publishedDataForDomain(state, 'nobody'), {});
});

test('a later publish to the same key overwrites the earlier value — latest wins, not immutable', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const e1 = await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });
  await dag.addEvent([e1], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'busy', at: 1 });

  const state = materializePublicProfiles(dag.topoOrder());
  assert.equal(publishedDataForDomain(state, 'alice')['status.js'].mood.value, 'busy');
});

test('publishing value:null retracts the key — a real unpublish, not stale data left forever', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const e1 = await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });
  await dag.addEvent([e1], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: null, at: 1 });

  const state = materializePublicProfiles(dag.topoOrder());
  assert.equal(publishedDataForDomain(state, 'alice')['status.js'].mood, undefined);
});

test('different modules on the same domain have independent published keys', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const e1 = await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });
  await dag.addEvent([e1], { type: 'module-data-published', domain: 'alice', moduleId: 'chess.js', key: 'rank', value: 1500, at: 1 });

  const state = materializePublicProfiles(dag.topoOrder());
  const published = publishedDataForDomain(state, 'alice');
  assert.equal(published['status.js'].mood.value, 'curious');
  assert.equal(published['chess.js'].rank.value, 1500);
});

test('different domains never see each other in the same bucket, even for the same moduleId/key', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const e1 = await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });
  await dag.addEvent([e1], { type: 'module-data-published', domain: 'bob', moduleId: 'status.js', key: 'mood', value: 'sleepy', at: 1 });

  const state = materializePublicProfiles(dag.topoOrder());
  assert.equal(publishedDataForDomain(state, 'alice')['status.js'].mood.value, 'curious');
  assert.equal(publishedDataForDomain(state, 'bob')['status.js'].mood.value, 'sleepy');
});

test('two domains publishing independently converge to the same view after reconciliation, regardless of merge order', async () => {
  const aliceDag = new EventDag();
  const aGenesis = await aliceDag.addEvent([], { type: 'genesis' });
  await aliceDag.addEvent([aGenesis], { type: 'module-data-published', domain: 'alice', moduleId: 'status.js', key: 'mood', value: 'curious', at: 0 });

  const bobDag = new EventDag();
  const bGenesis = await bobDag.addEvent([], { type: 'genesis' });
  await bobDag.addEvent([bGenesis], { type: 'module-data-published', domain: 'bob', moduleId: 'status.js', key: 'mood', value: 'sleepy', at: 0 });

  const forward = new EventDag();
  forward.merge(aliceDag);
  forward.merge(bobDag);
  const backward = new EventDag();
  backward.merge(bobDag);
  backward.merge(aliceDag);

  const stateForward = materializePublicProfiles(forward.topoOrder());
  const stateBackward = materializePublicProfiles(backward.topoOrder());
  assert.deepEqual(stateForward, stateBackward);
  assert.equal(publishedDataForDomain(stateForward, 'alice')['status.js'].mood.value, 'curious');
  assert.equal(publishedDataForDomain(stateForward, 'bob')['status.js'].mood.value, 'sleepy');
});

test('malformed publish events are rejected without throwing', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'module-data-published', domain: '', moduleId: 'x', key: 'y', value: 1 });
  await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: '', key: 'y', value: 1 });
  await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'x', key: '', value: 1 });
  const state = materializePublicProfiles(dag.topoOrder());
  assert.deepEqual(state.data, {});
});

test('a complex value (object, not just a primitive) round-trips correctly', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], { type: 'module-data-published', domain: 'alice', moduleId: 'chess.js', key: 'stats', value: { wins: 3, losses: 1 }, at: 0 });

  const state = materializePublicProfiles(dag.topoOrder());
  assert.deepEqual(publishedDataForDomain(state, 'alice')['chess.js'].stats.value, { wins: 3, losses: 1 });
});
