// check-id-parity.mjs — computes the content-addressed id for each case
// in test-vectors/id-parity.json using the pure JS EventDag, one id per
// line. Meant to be diffed against the Rust output of the same fixture
// (rust-core/examples/check_id_parity.rs) — see scripts/verify-parity.sh.
//
// Run: node scripts/check-id-parity.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventDag } from '../public/js/core/event-dag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'test-vectors', 'id-parity.json');
const cases = JSON.parse(readFileSync(fixturePath, 'utf8'));

const dag = new EventDag();

for (const testCase of cases) {
  const id = await dag.computeId(testCase.parents, testCase.payload);
  console.log(id);
}
