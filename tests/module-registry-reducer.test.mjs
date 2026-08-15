// module-registry-reducer.test.mjs — proves the actual gap the user
// found is closed: a module registered on one domain's local DAG is
// invisible to another domain's replica UNTIL the DAGs merge — and
// once merged, both replicas converge to the exact same registry,
// regardless of merge order. This is the same determinism property
// (§9) already proven for economics (g-integration.test.mjs) and
// conservation, now proven for the module registry too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventDag } from '../public/js/core/event-dag.js';
import { materializeModuleRegistry } from '../public/js/core/modules/module-registry-reducer.js';

test('a module registered on Earth is invisible on Mars before the domains reconcile', async () => {
  const earthDag = new EventDag();
  const genesis = await earthDag.addEvent([], { type: 'genesis' });
  await earthDag.addEvent([genesis], {
    type: 'module-register', id: 'weather.js', name: 'Weather', icon: '☀️', category: 'Tools',
    description: 'Shows the weather.', codeHash: 'hash1', codeUrl: 'https://example.com/weather.js',
    author: 'earth-domain', isIssuing: false, timeSensitive: null, economicConfig: null, at: 1000,
  });

  const marsDag = new EventDag();
  await marsDag.addEvent([], { type: 'genesis' }); // same payload -> same id, no coordination needed

  const earthRegistry = materializeModuleRegistry(earthDag.topoOrder());
  const marsRegistry = materializeModuleRegistry(marsDag.topoOrder());

  assert.ok(earthRegistry.modules['weather.js']);
  assert.equal(marsRegistry.modules['weather.js'], undefined); // exactly the gap the user identified
});

test('after reconciling, both domains converge to the identical registry regardless of merge order', async () => {
  const earthDag = new EventDag();
  const genesis = await earthDag.addEvent([], { type: 'genesis' });
  await earthDag.addEvent([genesis], {
    type: 'module-register', id: 'weather.js', name: 'Weather', icon: '☀️', category: 'Tools',
    description: 'Shows the weather.', codeHash: 'hash1', codeUrl: 'https://example.com/weather.js',
    author: 'earth-domain', isIssuing: false, timeSensitive: null, economicConfig: null, at: 1000,
  });

  const marsDag = new EventDag();
  const marsGenesis = await marsDag.addEvent([], { type: 'genesis' });
  await marsDag.addEvent([marsGenesis], {
    type: 'module-register', id: 'rover-cam.js', name: 'Rover Cam', icon: '📷', category: 'Media',
    description: 'Live rover feed.', codeHash: 'hash2', codeUrl: 'https://example.com/rover-cam.js',
    author: 'mars-domain', isIssuing: false, timeSensitive: null, economicConfig: null, at: 2000,
  });

  const mergedForward = new EventDag();
  mergedForward.merge(earthDag);
  mergedForward.merge(marsDag);

  const mergedBackward = new EventDag();
  mergedBackward.merge(marsDag);
  mergedBackward.merge(earthDag);

  const registryForward = materializeModuleRegistry(mergedForward.topoOrder());
  const registryBackward = materializeModuleRegistry(mergedBackward.topoOrder());

  assert.deepEqual(registryForward, registryBackward);
  assert.ok(registryForward.modules['weather.js']);
  assert.ok(registryForward.modules['rover-cam.js']);
});

test('module-update and module-audit events fold correctly through the real DAG', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  const reg = await dag.addEvent([genesis], {
    type: 'module-register', id: 'weather.js', name: 'Weather', icon: '☀️', category: 'Tools',
    description: 'Shows the weather.', codeHash: 'hash1', codeUrl: 'https://example.com/weather.js',
    author: 'earth-domain', isIssuing: false, timeSensitive: null, economicConfig: null, at: 1000,
  });
  const audited = await dag.addEvent([reg], { type: 'module-audit', id: 'weather.js', status: 'passed' });
  await dag.addEvent([audited], { type: 'module-update', id: 'weather.js', codeHash: 'hash2', codeUrl: 'https://example.com/weather.js' });

  const registry = materializeModuleRegistry(dag.topoOrder());
  assert.equal(registry.modules['weather.js'].codeHash, 'hash2');
  assert.equal(registry.modules['weather.js'].auditStatus, 'unaudited'); // reset by the update, same as direct registerModule/updateModuleCode
});

test('a duplicate registration event (e.g. replayed or forked) is silently rejected during the fold, not thrown', async () => {
  const dag = new EventDag();
  const genesis = await dag.addEvent([], { type: 'genesis' });
  await dag.addEvent([genesis], {
    type: 'module-register', id: 'weather.js', name: 'Weather v1', icon: '☀️', category: 'Tools',
    description: 'v1', codeHash: 'hash1', codeUrl: 'https://example.com/weather.js',
    author: 'alice', isIssuing: false, timeSensitive: null, economicConfig: null, at: 1000,
  });
  // A different event (different codeHash -> different id) claiming the same module id.
  await dag.addEvent([genesis], {
    type: 'module-register', id: 'weather.js', name: 'Weather v2 (impostor)', icon: '🌧', category: 'Tools',
    description: 'v2', codeHash: 'hash-impostor', codeUrl: 'https://evil.example/weather.js',
    author: 'mallory', isIssuing: false, timeSensitive: null, economicConfig: null, at: 1001,
  });

  const registry = materializeModuleRegistry(dag.topoOrder());
  // Exactly one of the two survives (whichever the deterministic topo
  // order folds first) — never both, never a crash.
  assert.equal(registry.modules['weather.js'].codeHash === 'hash1' || registry.modules['weather.js'].codeHash === 'hash-impostor', true);
});
