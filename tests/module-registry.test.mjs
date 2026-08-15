import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialModuleRegistryState,
  registerModule,
  updateModuleCode,
  setAuditStatus,
  validateEconomicConfig,
  selectIdentityScheme,
} from '../public/js/core/modules/module-registry.js';

function baseEntry(overrides = {}) {
  return {
    id: 'mymodule.js',
    name: 'My Module',
    icon: '🔮',
    category: 'Tools',
    description: 'Does a thing.',
    codeHash: 'hash1',
    codeUrl: 'https://example.com/mymodule.js',
    author: 'alice',
    isIssuing: false,
    timeSensitive: null,
    economicConfig: null,
    ...overrides,
  };
}

test('selectIdentityScheme derives strong for time-sensitive, weak otherwise (Lemma 1)', () => {
  assert.equal(selectIdentityScheme(true), 'strong');
  assert.equal(selectIdentityScheme(false), 'weak');
});

test('validateEconomicConfig rejects alpha <= 1 with no identity-cost mechanism (§24.1)', () => {
  const check = validateEconomicConfig({ alpha: 1, identityCostMechanism: null, scarcityPolicy: 'preallocated' });
  assert.equal(check.valid, false);
  assert.match(check.reason, /unbounded splitting incentive/);
});

test('validateEconomicConfig accepts alpha <= 1 WITH an identity-cost mechanism', () => {
  const check = validateEconomicConfig({ alpha: 0.5, identityCostMechanism: 'sol-burn', scarcityPolicy: 'preallocated' });
  assert.equal(check.valid, true);
});

test('validateEconomicConfig accepts alpha > 1 with no identity-cost mechanism', () => {
  const check = validateEconomicConfig({ alpha: 1.5, identityCostMechanism: null, scarcityPolicy: 'preallocated' });
  assert.equal(check.valid, true);
});

test('validateEconomicConfig requires a declared scarcityPolicy', () => {
  const check = validateEconomicConfig({ alpha: 2, identityCostMechanism: null, scarcityPolicy: '' });
  assert.equal(check.valid, false);
});

test('a non-issuing (read-only) module registers without any economic declaration', () => {
  const { accepted, state } = registerModule(initialModuleRegistryState(), baseEntry());
  assert.equal(accepted, true);
  assert.equal(state.modules['mymodule.js'].identityScheme, null);
  assert.equal(state.modules['mymodule.js'].auditStatus, 'unaudited');
});

test('an issuing module without economicConfig is rejected', () => {
  const { accepted, reason } = registerModule(initialModuleRegistryState(), baseEntry({ isIssuing: true, timeSensitive: true }));
  assert.equal(accepted, false);
  assert.match(reason, /economicConfig/);
});

test('an issuing module with an internally-inconsistent economicConfig is rejected', () => {
  const { accepted, reason } = registerModule(
    initialModuleRegistryState(),
    baseEntry({ isIssuing: true, timeSensitive: true, economicConfig: { alpha: 1, identityCostMechanism: null, scarcityPolicy: 'preallocated' } })
  );
  assert.equal(accepted, false);
  assert.match(reason, /unbounded splitting/);
});

test('a valid issuing module registers and gets the identity scheme Lemma 1 implies', () => {
  const { accepted, state } = registerModule(
    initialModuleRegistryState(),
    baseEntry({ isIssuing: true, timeSensitive: true, economicConfig: { alpha: 2, identityCostMechanism: null, scarcityPolicy: 'preallocated' } })
  );
  assert.equal(accepted, true);
  assert.equal(state.modules['mymodule.js'].identityScheme, 'strong');
});

test('registration is open — no author allow-list, anyone can register any id once', () => {
  const r1 = registerModule(initialModuleRegistryState(), baseEntry({ id: 'a.js', author: 'alice' }));
  const r2 = registerModule(r1.state, baseEntry({ id: 'b.js', author: 'someone-nobody-approved' }));
  assert.equal(r2.accepted, true);
});

test('a duplicate id is rejected (the only publishing-time gate — mechanical, not a permission check)', () => {
  const r1 = registerModule(initialModuleRegistryState(), baseEntry({ id: 'a.js' }));
  const r2 = registerModule(r1.state, baseEntry({ id: 'a.js', author: 'someone-else' }));
  assert.equal(r2.accepted, false);
  assert.match(r2.reason, /already registered/);
});

test('updateModuleCode resets auditStatus to unaudited, so a stale verdict cannot carry over silently', () => {
  let { state } = registerModule(initialModuleRegistryState(), baseEntry());
  ({ state } = setAuditStatus(state, 'mymodule.js', 'passed'));
  assert.equal(state.modules['mymodule.js'].auditStatus, 'passed');

  ({ state } = updateModuleCode(state, { id: 'mymodule.js', codeHash: 'hash2', codeUrl: 'https://example.com/mymodule.js' }));
  assert.equal(state.modules['mymodule.js'].auditStatus, 'unaudited');
  assert.equal(state.modules['mymodule.js'].codeHash, 'hash2');
});

test('updateModuleCode on an unregistered id is rejected', () => {
  const { accepted } = updateModuleCode(initialModuleRegistryState(), { id: 'ghost.js', codeHash: 'x', codeUrl: 'x' });
  assert.equal(accepted, false);
});

test('setAuditStatus supports the full status range, including red-listing', () => {
  let { state } = registerModule(initialModuleRegistryState(), baseEntry());
  ({ state } = setAuditStatus(state, 'mymodule.js', 'red-listed'));
  assert.equal(state.modules['mymodule.js'].auditStatus, 'red-listed');
});
