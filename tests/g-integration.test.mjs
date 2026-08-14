//! check_id_parity — computes the content-addressed id for each case in
//! ../../test-vectors/id-parity.json using aiwa_core::Event::compute_id,
//! one id per line. Meant to be diffed against the JS output of the same
//! fixture (scripts/check-id-parity.mjs) — see scripts/verify-parity.sh.
//!
//! Run: cargo run --example check_id_parity

use std::fs;
use std::path::Path;

use aiwa_core::Event;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    #[allow(dead_code)]
    name: String,
    parents: Vec<String>,
    payload: serde_json::Value,
}

fn main() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/id-parity.json");
    let raw = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", fixture_path.display()));
    let cases: Vec<Case> = serde_json::from_str(&raw).expect("invalid fixture JSON");

    for case in cases {
        println!("{}", Event::compute_id(&case.parents, &case.payload));
    }
}
