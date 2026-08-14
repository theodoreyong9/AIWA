#!/usr/bin/env bash
# verify-g-parity.sh — runs the composed G materialization (JS and Rust)
# over test-vectors/g-scenario.json and fails if their output differs.
# Compares parsed JSON values (not raw text), since Rust's f64 formatting
# ("40.0") and JS's number formatting ("40") are equal in value but
# differ as text.
#
# Run from the repo root: ./scripts/verify-g-parity.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Materializing G (JavaScript)..."
node scripts/check-g-parity.mjs > /tmp/aiwa-g-js.json

echo "Materializing G (Rust)..."
(cd rust-core && cargo run --quiet --example check_g_parity) > /tmp/aiwa-g-rust.json

node -e '
const fs = require("fs");
const js = JSON.parse(fs.readFileSync("/tmp/aiwa-g-js.json", "utf8"));
const rust = JSON.parse(fs.readFileSync("/tmp/aiwa-g-rust.json", "utf8"));

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
  console.log("OK: JS and Rust materialize an identical composed G state for the shared scenario.");
  console.log(JSON.stringify(js, null, 2));
  process.exit(0);
} else {
  console.error("MISMATCH: JS and Rust disagree on the materialized G state.");
  console.error("JS:  ", JSON.stringify(js));
  console.error("Rust:", JSON.stringify(rust));
  process.exit(1);
}
'
