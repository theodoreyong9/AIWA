use sha2::{Digest, Sha256};

pub fn compute_module_hash(code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code.as_bytes());
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn verify_module_integrity(code: &str, expected_hash: &str) -> bool {
    compute_module_hash(code) == expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_for_identical_code() {
        let code = "window.YM_S['a.js'] = { name: 'A' };";
        assert_eq!(compute_module_hash(code), compute_module_hash(code));
    }

    #[test]
    fn differs_for_different_code() {
        assert_ne!(compute_module_hash("const x = 1;"), compute_module_hash("const x = 2;"));
    }

    #[test]
    fn verify_accepts_unmodified_code() {
        let code = "export const x = 42;";
        let hash = compute_module_hash(code);
        assert!(verify_module_integrity(code, &hash));
    }

    #[test]
    fn verify_rejects_silently_swapped_code() {
        let original = "export const x = 42;";
        let swapped = "export const x = 42; exfiltrate();";
        let hash = compute_module_hash(original);
        assert!(!verify_module_integrity(swapped, &hash));
    }
}
