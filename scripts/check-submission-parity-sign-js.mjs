// check-submission-parity-sign-js.mjs — signs a submission event with a
// real, randomly-generated Ed25519 keypair (via @noble/curves, the same
// library module-submission.js uses), using FIXED field values so the
// canonical message construction is exercised identically each run.
// Prints the signed event as JSON to stdout, for Rust's
// verify_submission_from_js example to independently verify.
//
// This is the missing half of Appendix H.11's flagged gap: a script
// that actually proves canonicalSubmissionMessage() (JS) and
// canonical_submission_message() (Rust) produce byte-identical input to
// the signature, not merely field-order matching by inspection.
//
// Run: node scripts/check-submission-parity-sign-js.mjs

import { ed25519 } from '@noble/curves/ed25519';
import { buildSubmissionEvent } from '../public/js/core/modules/module-submission.js';

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A real, freshly-generated key each run — parity is about whether the
// SAME key/fields produce a signature the OTHER language accepts, not
// about reusing a fixed key.
const seed = ed25519.utils.randomPrivateKey();
const pubkeyBytes = ed25519.getPublicKey(seed);

const fields = {
  moduleId: 'weather.js',
  codeHash: 'a1b2c3d4e5f6',
  codeUrl: 'https://example.com/weather.js',
  name: 'Weather',
  icon: '⬡',
  category: 'Tools',
  description: 'Cross-language parity fixture.',
  isIssuing: false,
  timeSensitive: null,
  economicConfig: null,
};

const event = buildSubmissionEvent(fields, seed, pubkeyBytes, { now: 1735689600000, nonce: 'parity-fixture-nonce-js' });

console.log(JSON.stringify(event, null, 2));
