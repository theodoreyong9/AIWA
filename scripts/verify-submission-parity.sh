#!/usr/bin/env bash
# verify-submission-parity.sh — closes Appendix H.11's flagged gap: JS
# and Rust's canonical_submission_message() functions were written to
# match by careful field-order inspection, but never mechanically
# cross-checked. This runs both directions for real: JS signs, Rust
# verifies; Rust signs, JS verifies. If either canonical message
# construction disagrees in any byte, Ed25519 verification fails and
# this script exits non-zero.
#
# Run from the repo root: ./scripts/verify-submission-parity.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Direction 1: JS signs, Rust verifies..."
node scripts/check-submission-parity-sign-js.mjs > /tmp/aiwa-submission-js.json
(cd rust-core && cargo run --quiet --example verify_submission_from_js) < /tmp/aiwa-submission-js.json

echo ""
echo "Direction 2: Rust signs, JS verifies..."
(cd rust-core && cargo run --quiet --example sign_submission_rust) > /tmp/aiwa-submission-rust.json
node scripts/verify-submission-from-rust.mjs < /tmp/aiwa-submission-rust.json

echo ""
echo "OK: canonical submission message construction agrees between JS and Rust in both directions."
