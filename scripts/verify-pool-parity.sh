#!/usr/bin/env bash
# verify-pool-parity.sh — runs the real, deterministic weighted draw
# (JS and Rust) over test-vectors/pool-scenario.json and fails if
# their output differs. Closes the one gap the other four parity
# scripts didn't cover: pool-reducer.js's computeWeightedDraw() vs
# pool_reducer.rs's compute_weighted_draw() previously had no
# dedicated script or shared fixture, only a single hardcoded hash
# pinned inside a Rust unit test.
#
# Run from the repo root: bash scripts/verify-pool-parity.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Computing the real weighted draw (JavaScript)..."
node scripts/check-pool-parity.mjs > /tmp/aiwa-pool-js.json

echo "Computing the real weighted draw (Rust)..."
(cd rust-core && cargo run --quiet --example check_pool_parity) > /tmp/aiwa-pool-rust.json

node -e '
const fs = require("fs");
const js = JSON.parse(fs.readFileSync("/tmp/aiwa-pool-js.json", "utf8"));
const rust = JSON.parse(fs.readFileSync("/tmp/aiwa-pool-rust.json", "utf8"));

function deepEqual(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.join(",") !== keysB.join(",")) return false;
    return keysA.every((k) => deepEqual(a[k], b[k]));
  }
  return a === b;
}

if (deepEqual(js, rust)) {
  console.log("OK: JS and Rust compute an identical weighted draw for the shared scenario.");
  console.log(JSON.stringify(js, null, 2));
  process.exit(0);
} else {
  console.error("MISMATCH: JS and Rust disagree on the weighted draw.");
  console.error("JS:  ", JSON.stringify(js));
  console.error("Rust:", JSON.stringify(rust));
  process.exit(1);
}
'
