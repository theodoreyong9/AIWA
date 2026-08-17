//! cadence_vdf.rs — mirror of cadence-vdf.js. See that file's own
//! header for the full rationale (closes R11 — the mandatory heartbeat
//! makes silence observable but never bounded the RATE of cadence
//! advancement; a sequential hash chain does, since each step depends
//! on the output of the one before it, making production
//! non-parallelizable regardless of available hardware).
//!
//! Cross-language parity matters here more than for most reducers:
//! this chain's exact byte output must match the JS implementation's
//! bit-for-bit, since both languages fold the SAME shared DAG events
//! (including the cross-language test-vectors/g-scenario.json fixture)
//! and must reach the identical verdict on the identical proof.

use sha2::{Digest, Sha256};

/// The seed binds the chain to exactly one domain and exactly one
/// position in that domain's own cadence history — see cadence-vdf.js
/// for why this, not just per-epoch chaining, matters.
pub fn vdf_seed(domain: &str, previous_output: &str) -> String {
    format!("{domain}:{previous_output}")
}

/// Computes the chain. `iterations` must be >= 1 (the first hash is
/// unconditional; the loop runs iterations-1 additional times) —
/// mirrors computeVdfChain()'s exact loop shape so both languages
/// produce byte-identical output for the same (seed, iterations).
pub fn compute_vdf_chain(seed: &str, iterations: u64) -> String {
    let mut h = Sha256::digest(seed.as_bytes()).to_vec();
    for _ in 1..iterations {
        h = Sha256::digest(&h).to_vec();
    }
    h.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Verifies a claimed chain by recomputing it — recompute, don't
/// trust, the same discipline this project applies everywhere else.
pub fn verify_vdf_chain(seed: &str, iterations: u64, claimed_output: &str) -> bool {
    if iterations < 1 { return false; }
    if claimed_output.len() != 64 || !claimed_output.bytes().all(|b| b.is_ascii_hexdigit()) {
        return false;
    }
    compute_vdf_chain(seed, iterations) == claimed_output.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_seed_binds_a_chain_to_exactly_one_domain_and_position() {
        assert_eq!(vdf_seed("alice", "genesis"), "alice:genesis");
        assert_ne!(vdf_seed("alice", "genesis"), vdf_seed("bob", "genesis"));
        assert_ne!(vdf_seed("alice", "genesis"), vdf_seed("alice", "some-prior-output"));
    }

    #[test]
    fn compute_vdf_chain_is_deterministic() {
        let out1 = compute_vdf_chain("alice:genesis", 1000);
        let out2 = compute_vdf_chain("alice:genesis", 1000);
        assert_eq!(out1, out2);
    }

    #[test]
    fn compute_vdf_chain_output_is_a_real_64_char_hex_sha256_digest() {
        let out = compute_vdf_chain("alice:genesis", 100);
        assert_eq!(out.len(), 64);
        assert!(out.bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn a_different_seed_produces_a_completely_different_chain() {
        let out1 = compute_vdf_chain("alice:genesis", 500);
        let out2 = compute_vdf_chain("bob:genesis", 500);
        assert_ne!(out1, out2);
    }

    #[test]
    fn a_different_iteration_count_produces_a_different_output() {
        let out500 = compute_vdf_chain("alice:genesis", 500);
        let out501 = compute_vdf_chain("alice:genesis", 501);
        assert_ne!(out500, out501);
    }

    #[test]
    fn verify_vdf_chain_accepts_a_genuinely_computed_chain() {
        let seed = "alice:genesis";
        let iterations = 5000;
        let output = compute_vdf_chain(seed, iterations);
        assert!(verify_vdf_chain(seed, iterations, &output));
    }

    #[test]
    fn security_verify_vdf_chain_rejects_a_fabricated_output() {
        let seed = "alice:genesis";
        let fabricated = "0".repeat(64);
        assert!(!verify_vdf_chain(seed, 5000, &fabricated));
    }

    #[test]
    fn security_verify_vdf_chain_rejects_a_real_chain_for_fewer_iterations_than_claimed() {
        let seed = "alice:genesis";
        let shortcut = compute_vdf_chain(seed, 100);
        assert!(!verify_vdf_chain(seed, 5000, &shortcut));
    }

    #[test]
    fn security_verify_vdf_chain_rejects_the_wrong_seed() {
        let output = compute_vdf_chain("alice:genesis", 5000);
        assert!(!verify_vdf_chain("bob:genesis", 5000, &output));
        assert!(!verify_vdf_chain("alice:some-other-prior-output", 5000, &output));
    }

    #[test]
    fn verify_vdf_chain_rejects_malformed_claimed_output_without_panicking() {
        assert!(!verify_vdf_chain("alice:genesis", 100, "not-a-real-hex-digest"));
        assert!(!verify_vdf_chain("alice:genesis", 100, ""));
    }

    #[test]
    fn epoch_to_epoch_chaining_depends_on_the_real_prior_output() {
        let epoch1_output = compute_vdf_chain(&vdf_seed("alice", "genesis"), 1000);
        let epoch2_seed_real = vdf_seed("alice", &epoch1_output);
        let epoch2_seed_faked = vdf_seed("alice", "a-guessed-or-precomputed-output");
        let epoch2_real = compute_vdf_chain(&epoch2_seed_real, 1000);
        let epoch2_faked = compute_vdf_chain(&epoch2_seed_faked, 1000);
        assert_ne!(epoch2_real, epoch2_faked);
    }

    /// Cross-language parity: these exact values were independently
    /// computed by cadence-vdf.js (Node, real @noble/hashes sha256) for
    /// the identical (seed, iterations) pair. If this ever fails, the
    /// two languages have diverged on what should be an identical,
    /// pure computation — a real cross-language parity break, not a
    /// cosmetic difference.
    #[test]
    fn cross_language_parity_matches_the_real_js_computed_value() {
        assert_eq!(
            compute_vdf_chain(&vdf_seed("d1", "genesis"), 50),
            "8adb1b83ff6aa686793c1995bbd1f627d9cfb9ce35465294ecbc062af043a19f"
        );
    }
}
