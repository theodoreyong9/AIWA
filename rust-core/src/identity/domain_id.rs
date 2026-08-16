use sha2::{Digest, Sha256};

/// A domain's id: SHA-256 of its wallet's public key, hex-encoded — the
/// full 64 hex characters (256 bits), not truncated. Mirror of
/// deriveDomainId() in domain-id.js — see that file's header for why
/// truncation became a real weakness once domain ids started being
/// checked against inside a signature-verification path
/// (conservation_bridge.rs's transfer authorization).
pub fn derive_domain_id(public_key_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key_bytes);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

/// A short label for UI display only — never use this as an identifier
/// in a security check.
pub fn short_domain_label(domain_id: &str) -> String {
    domain_id.chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_same_key_same_id() {
        let key = [7u8; 32];
        assert_eq!(derive_domain_id(&key), derive_domain_id(&key));
    }

    #[test]
    fn full_64_char_hex_not_truncated() {
        let key = [7u8; 32];
        assert_eq!(derive_domain_id(&key).len(), 64);
    }

    #[test]
    fn different_keys_differ() {
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        assert_ne!(derive_domain_id(&key1), derive_domain_id(&key2));
    }

    #[test]
    fn short_label_truncates_for_display() {
        let key = [7u8; 32];
        let id = derive_domain_id(&key);
        let label = short_domain_label(&id);
        assert_eq!(label.len(), 12);
        assert!(id.starts_with(&label));
    }
}
