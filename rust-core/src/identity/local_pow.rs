use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct PowProof {
    pub domain: String,
    pub nonce: u64,
    pub hash: String,
    pub difficulty_bits: u32,
    pub mined_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct LocalPowState {
    pub registered: HashMap<String, PowProof>,
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn count_leading_zero_bits(hex_hash: &str) -> u32 {
    let mut bits = 0u32;
    for ch in hex_hash.chars() {
        let nibble = ch.to_digit(16).unwrap_or(0);
        if nibble == 0 {
            bits += 4;
            continue;
        }
        bits += nibble.leading_zeros() - 28;
        break;
    }
    bits
}

/// Mirror of minePowProof() in local-pow.js — real CPU work, zero
/// network calls, the network-independent counterpart to the Solana
/// burn (§24.6(v) vs §24.6(ii)).
pub fn mine_pow_proof(domain: &str, difficulty_bits: u32, max_attempts: u64) -> Result<PowProof, String> {
    for nonce in 0..max_attempts {
        let hash = sha256_hex(&format!("{domain}:{nonce}"));
        if count_leading_zero_bits(&hash) >= difficulty_bits {
            return Ok(PowProof { domain: domain.to_string(), nonce, hash, difficulty_bits, mined_at: 0 });
        }
    }
    Err(format!("No valid nonce found within {max_attempts} attempts at difficulty {difficulty_bits}"))
}

#[derive(Debug, PartialEq)]
pub struct VerifyResult {
    pub valid: bool,
    pub reason: Option<String>,
}

/// Mirror of verifyPowProof().
pub fn verify_pow_proof(proof: &PowProof) -> VerifyResult {
    let recomputed = sha256_hex(&format!("{}:{}", proof.domain, proof.nonce));
    if recomputed != proof.hash {
        return VerifyResult { valid: false, reason: Some("claimed hash does not match SHA-256(domain:nonce) — not a real proof".to_string()) };
    }
    if count_leading_zero_bits(&recomputed) < proof.difficulty_bits {
        return VerifyResult {
            valid: false,
            reason: Some(format!("hash has fewer than {} leading zero bits — insufficient work", proof.difficulty_bits)),
        };
    }
    VerifyResult { valid: true, reason: None }
}

#[derive(Debug, PartialEq)]
pub struct RegisterOutcome {
    pub accepted: bool,
    pub reason: Option<String>,
}

impl LocalPowState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mirror of registerLocalPow().
    pub fn register_local_pow(&mut self, proof: PowProof) -> RegisterOutcome {
        if self.registered.contains_key(&proof.domain) {
            return RegisterOutcome {
                accepted: false,
                reason: Some(format!("domain '{}' already has a registered identity cost", proof.domain)),
            };
        }
        let check = verify_pow_proof(&proof);
        if !check.valid {
            return RegisterOutcome { accepted: false, reason: check.reason };
        }
        self.registered.insert(proof.domain.clone(), proof);
        RegisterOutcome { accepted: true, reason: None }
    }

    pub fn has_local_pow(&self, domain: &str) -> bool {
        self.registered.contains_key(domain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_DIFFICULTY: u32 = 8;

    #[test]
    fn mine_finds_real_nonce() {
        let proof = mine_pow_proof("mars-outpost-7", TEST_DIFFICULTY, 50_000_000).unwrap();
        assert_eq!(proof.domain, "mars-outpost-7");
        assert_eq!(proof.difficulty_bits, TEST_DIFFICULTY);
    }

    #[test]
    fn verify_accepts_genuine_proof() {
        let proof = mine_pow_proof("earth-alpha", TEST_DIFFICULTY, 50_000_000).unwrap();
        assert!(verify_pow_proof(&proof).valid);
    }

    #[test]
    fn verify_rejects_hash_mismatch() {
        let mut proof = mine_pow_proof("earth-alpha", TEST_DIFFICULTY, 50_000_000).unwrap();
        proof.hash = "0".repeat(64);
        assert!(!verify_pow_proof(&proof).valid);
    }

    #[test]
    fn verify_rejects_inflated_difficulty_claim() {
        let mut proof = mine_pow_proof("earth-alpha", TEST_DIFFICULTY, 50_000_000).unwrap();
        proof.difficulty_bits += 40;
        assert!(!verify_pow_proof(&proof).valid);
    }

    #[test]
    fn register_accepts_valid_proof() {
        let proof = mine_pow_proof("mars-outpost-7", TEST_DIFFICULTY, 50_000_000).unwrap();
        let mut state = LocalPowState::new();
        let outcome = state.register_local_pow(proof);
        assert!(outcome.accepted);
        assert!(state.has_local_pow("mars-outpost-7"));
    }

    #[test]
    fn cannot_register_twice() {
        let mut state = LocalPowState::new();
        let proof1 = mine_pow_proof("mars-outpost-7", TEST_DIFFICULTY, 50_000_000).unwrap();
        state.register_local_pow(proof1);
        let proof2 = mine_pow_proof("mars-outpost-7", TEST_DIFFICULTY, 50_000_000).unwrap();
        let second = state.register_local_pow(proof2);
        assert!(!second.accepted);
    }

    #[test]
    fn has_local_pow_false_for_unregistered() {
        assert!(!LocalPowState::new().has_local_pow("unknown"));
    }

    #[test]
    fn forged_proof_rejected_at_registration() {
        let fake = PowProof { domain: "lazy-domain".to_string(), nonce: 0, hash: "0".repeat(64), difficulty_bits: TEST_DIFFICULTY, mined_at: 0 };
        let mut state = LocalPowState::new();
        assert!(!state.register_local_pow(fake).accepted);
    }
}
