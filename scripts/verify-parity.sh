#!/usr/bin/env bash
# verify-parity.sh — runs both id computations (JS and Rust) over
# test-vectors/id-parity.json and fails if their output differs.
#
# Run from the repo root: ./scripts/verify-parity.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Computing ids (JavaScript)..."
node scripts/check-id-parity.mjs > /tmp/aiwa-ids-js.txt

echo "Computing ids (Rust)..."
(cd rust-core && cargo run --quiet --example check_id_parity) > /tmp/aiwa-ids-rust.txt

if diff -u /tmp/aiwa-ids-js.txt /tmp/aiwa-ids-rust.txt; then
  echo "OK: JS and Rust produce identical ids for all $(wc -l < /tmp/aiwa-ids-js.txt) test vectors."
else
  echo "MISMATCH: JS and Rust disagree on at least one id. See diff above." >&2
  exit 1
fi
