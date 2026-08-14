// conservation-scenario.test.mjs — regression test pinning the exact
// materialized values for the shared cross-language fixture
// (test-vectors/conservation-scenario.json). Mirror of
// tests/g-scenario.test.mjs for the conservation module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialConservationState, issueClaim, transfer, identityDerivation } from '../public/js/core/conservation/conservation.js';

test('shared conservation-scenario fixture materializes to the exact pinned values', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test-vectors/conservation-scenario.json', import.meta.url)));
  const burnXMintY = (kind, amount) => (kind === 'X' ? { kind: 'Y', amount: amount * 2 } : null);
  const derivations = { identity: identityDerivation, burnXMintY };

  let state = initialConservationState();
  for (const c of fixture.claims) state = issueClaim(state, c);
  for (const t of fixture.transfers) ({ state } = transfer(state, t, derivations));

  assert.equal(state.claims.c1.status, 'consumed');
  assert.equal(state.claims.c2.status, 'consumed');
  assert.equal(state.claims['activated:c1:alice:bob:n1:identity'].kind, 'X');
  assert.equal(state.claims['activated:c1:alice:bob:n1:identity'].amount, 10);
  assert.equal(state.claims['activated:c2:bob:alice:n2:burnXMintY'].kind, 'Y');
  assert.equal(state.claims['activated:c2:bob:alice:n2:burnXMintY'].amount, 10);
  assert.equal(Object.keys(state.consumed).length, 2);
});
