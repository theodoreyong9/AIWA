// check-pool-parity.mjs — computes the real, deterministic weighted
// draw over test-vectors/pool-scenario.json and prints a canonical
// JSON summary to stdout. Meant to be diffed against the Rust output
// of the same fixture (rust-core/examples/check_pool_parity.rs) — see
// scripts/verify-pool-parity.sh. Closes the one gap the other four
// parity checks didn't cover: pool-reducer.js's computeWeightedDraw()
// vs pool_reducer.rs's compute_weighted_draw() previously had no
// dedicated script or shared fixture, only a single hardcoded hash
// pinned inside a Rust unit test.
//
// Run: node scripts/check-pool-parity.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeWeightedDraw } from '../public/js/core/pool/pool-reducer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'test-vectors', 'pool-scenario.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const draw = await computeWeightedDraw(fixture.poolId, fixture.cycleIndex, fixture.contributions);

console.log(JSON.stringify(draw, null, 2));
