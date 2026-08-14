// check-conservation-parity.mjs — runs the shared scenario in
// test-vectors/conservation-scenario.json through the JS conservation
// module and prints a canonical JSON summary. Diffed against the Rust
// output (rust-core/examples/check_conservation_parity.rs) by
// scripts/verify-conservation-parity.sh — Phase 5's cross-language
// parity check for Conservation, mirroring economics (G)'s approach.
//
// Run: node scripts/check-conservation-parity.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initialConservationState, issueClaim, transfer, identityDerivation } from '../public/js/core/conservation/conservation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'test-vectors', 'conservation-scenario.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const burnXMintY = (kind, amount) => (kind === 'X' ? { kind: 'Y', amount: amount * 2 } : null);
const derivations = { identity: identityDerivation, burnXMintY };

let state = initialConservationState();
for (const c of fixture.claims) {
  state = issueClaim(state, c);
}
for (const t of fixture.transfers) {
  ({ state } = transfer(state, t, derivations));
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

const summary = {
  claims: sortKeys(
    Object.fromEntries(
      Object.entries(state.claims).map(([id, c]) => [id, { kind: c.kind, amount: c.amount, owner: c.owner, status: c.status }])
    )
  ),
  consumedCount: Object.keys(state.consumed).length,
};

console.log(JSON.stringify(summary, null, 2));
