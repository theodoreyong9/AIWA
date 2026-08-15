// verify-submission-from-rust.mjs — reads a SubmissionEvent (as
// produced by rust-core/examples/sign_submission_rust.rs) as JSON from
// stdin, and calls verifySubmissionSignature(). Prints PASS/FAIL and
// exits non-zero on failure — the reverse direction of Appendix H.11's
// cross-language parity check.
//
// Run: cargo run --example sign_submission_rust | node scripts/verify-submission-from-rust.mjs

import { verifySubmissionSignature } from '../public/js/core/modules/module-submission.js';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

const event = JSON.parse(input);

if (verifySubmissionSignature(event)) {
  console.log('PASS: JS verified a signature and canonical message produced by Rust.');
  process.exit(0);
} else {
  console.error('FAIL: JS rejected a signature Rust produced — canonical message construction disagrees between languages.');
  process.exit(1);
}
