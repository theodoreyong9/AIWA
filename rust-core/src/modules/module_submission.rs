#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    fn make_signer() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn base_event(signer: &SigningKey, code_hash: &str, nonce: &str) -> SubmissionEvent {
        build_submission_event(
            "mymodule.js",
            code_hash,
            "https://example.com/mymodule.js",
            "My Module",
            "🔮",
            "Tools",
            "Does a thing.",
            false,
            None,
            None,
            signer,
            nonce,
            1000,
        )
    }

    #[test]
    fn real_signature_verifies() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");
        assert!(verify_submission_signature(&event));
    }

    #[test]
    fn tampered_field_invalidates_signature() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let mut event = base_event(&signer, &hash, "n1");
        event.code_url = "https://evil.example/swapped.js".to_string();
        assert!(!verify_submission_signature(&event));
    }

    #[test]
    fn validate_rejects_hash_mismatch() {
        let signer = make_signer();
        let claimed_code = "const x = 1;";
        let hash = compute_module_hash(claimed_code);
        let event = base_event(&signer, &hash, "n1");

        let actually_fetched = "const x = 1; exfiltrate();";
        let check = validate_submission(&SubmissionState::default(), &event, actually_fetched);
        assert!(!check.valid);
    }

    #[test]
    fn validate_accepts_matching_signed_submission() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");
        let check = validate_submission(&SubmissionState::default(), &event, code);
        assert!(check.valid);
    }

    #[test]
    fn validate_rejects_replayed_nonce() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "fixed-nonce");

        let mut state = SubmissionState::default();
        record_nonce(&mut state, "fixed-nonce");

        let check = validate_submission(&state, &event, code);
        assert!(!check.valid);
    }

    #[test]
    fn forged_signature_wrong_signer_is_rejected() {
        let attacker = make_signer();
        let victim = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);

        let mut event = base_event(&attacker, &hash, "n1");
        event.signer_pubkey = to_hex(victim.verifying_key().as_bytes());
        assert!(!verify_submission_signature(&event));
    }

    #[test]
    fn submit_module_end_to_end_registers_new_module() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = base_event(&signer, &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, None);

        assert!(outcome.accepted);
        assert!(!outcome.is_update);
        assert_eq!(registry.modules["mymodule.js"].code_hash, hash);
        assert!(submissions.used_nonces.contains_key("n1"));
    }

    #[test]
    fn submit_module_second_submission_updates_and_resets_audit() {
        use crate::modules::module_registry::AuditStatus;

        let signer = make_signer();
        let code_v1 = "const x = 1;";
        let hash_v1 = compute_module_hash(code_v1);
        let event1 = base_event(&signer, &hash_v1, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        submit_module(&mut registry, &mut submissions, &event1, code_v1, 1000, None);
        registry.set_audit_status("mymodule.js", AuditStatus::Passed);

        let code_v2 = "const x = 2;";
        let hash_v2 = compute_module_hash(code_v2);
        let event2 = base_event(&signer, &hash_v2, "n2");
        let outcome2 = submit_module(&mut registry, &mut submissions, &event2, code_v2, 1001, None);

        assert!(outcome2.accepted);
        assert!(outcome2.is_update);
        assert_eq!(registry.modules["mymodule.js"].code_hash, hash_v2);
        assert_eq!(registry.modules["mymodule.js"].audit_status, AuditStatus::Unaudited);
    }

    // ── checkSubmissionEligibility, actually wired in ──────────────
    // Built and tested in module_rank.rs since an earlier phase, never
    // actually called from this pipeline until now.

    fn event_with_id(signer: &SigningKey, module_id: &str, code_hash: &str, nonce: &str) -> SubmissionEvent {
        build_submission_event(
            module_id, code_hash, &format!("https://example.com/{module_id}"), module_id, "🔮", "Tools", "Does a thing.",
            false, None, None, signer, nonce, 1000,
        )
    }

    fn eligibility_fn(rank: f64, epochs_elapsed: f64) -> impl Fn(&str, Option<&LastSubmission>) -> SubmissionEligibilityCheck {
        move |_author, last| {
            let check = crate::modules::module_rank::check_submission_eligibility(rank, epochs_elapsed, last.copied());
            SubmissionEligibilityCheck { eligible: check.eligible, rank, epochs_elapsed }
        }
    }

    #[test]
    fn first_submission_always_eligible_and_records_rank() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = event_with_id(&signer, "first.js", &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let f = eligibility_fn(100.0, 5.0);
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, Some(&f));

        assert!(outcome.accepted);
        let stored = submissions.last_submission_by_author.get(&event.signer_pubkey).unwrap();
        assert_eq!(stored.rank, 100.0);
        assert_eq!(stored.epochs_elapsed, 5.0);
    }

    #[test]
    fn second_new_module_id_with_declining_ratio_is_rejected() {
        let signer = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let code1 = "const a = 1;";
        let hash1 = compute_module_hash(code1);
        let event1 = event_with_id(&signer, "first.js", &hash1, "n1");
        let f1 = eligibility_fn(1000.0, 10.0);
        let outcome1 = submit_module(&mut registry, &mut submissions, &event1, code1, 1000, Some(&f1));
        assert!(outcome1.accepted);

        let code2 = "const b = 2;";
        let hash2 = compute_module_hash(code2);
        let event2 = event_with_id(&signer, "second.js", &hash2, "n2");
        let f2 = eligibility_fn(1.0, 10.0); // cratered ratio
        let outcome2 = submit_module(&mut registry, &mut submissions, &event2, code2, 1001, Some(&f2));

        assert!(!outcome2.accepted);
        assert!(!registry.modules.contains_key("second.js"));
    }

    #[test]
    fn eligibility_does_not_gate_an_update() {
        let signer = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let code_v1 = "const v = 1;";
        let hash_v1 = compute_module_hash(code_v1);
        let event_v1 = event_with_id(&signer, "mine.js", &hash_v1, "n1");
        let f1 = eligibility_fn(1000.0, 10.0);
        submit_module(&mut registry, &mut submissions, &event_v1, code_v1, 1000, Some(&f1));

        // Same author updates the SAME id, rank has since cratered.
        let code_v2 = "const v = 2;";
        let hash_v2 = compute_module_hash(code_v2);
        let event_v2 = event_with_id(&signer, "mine.js", &hash_v2, "n2");
        let f2 = eligibility_fn(0.0, 10.0);
        let outcome2 = submit_module(&mut registry, &mut submissions, &event_v2, code_v2, 1001, Some(&f2));

        assert!(outcome2.accepted);
        assert!(outcome2.is_update);
    }

    #[test]
    fn none_eligibility_fn_skips_the_check_backward_compatible() {
        let signer = make_signer();
        let code = "const x = 1;";
        let hash = compute_module_hash(code);
        let event = event_with_id(&signer, "any.js", &hash, "n1");

        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();
        let outcome = submit_module(&mut registry, &mut submissions, &event, code, 1000, None);

        assert!(outcome.accepted);
    }

    #[test]
    fn record_nonce_preserves_last_submission_by_author_for_other_authors() {
        // Rust's &mut discipline avoids the exact bug JS's immutable
        // recordNonce() had (a fresh {usedNonces} object silently
        // dropping every other field) — this test exists to confirm
        // that structural guarantee holds here too, not because the
        // same bug was found in this file.
        let alice = make_signer();
        let bob = make_signer();
        let mut registry = ModuleRegistryState::new();
        let mut submissions = SubmissionState::default();

        let alice_code = "const a = 1;";
        let alice_hash = compute_module_hash(alice_code);
        let alice_event = event_with_id(&alice, "alice-mod.js", &alice_hash, "n1");
        let fa = eligibility_fn(500.0, 20.0);
        submit_module(&mut registry, &mut submissions, &alice_event, alice_code, 1000, Some(&fa));
        assert!(submissions.last_submission_by_author.contains_key(&alice_event.signer_pubkey));

        let bob_code = "const b = 2;";
        let bob_hash = compute_module_hash(bob_code);
        let bob_event = event_with_id(&bob, "bob-mod.js", &bob_hash, "n2");
        let fb = eligibility_fn(10.0, 5.0);
        submit_module(&mut registry, &mut submissions, &bob_event, bob_code, 1001, Some(&fb));

        assert!(submissions.last_submission_by_author.contains_key(&alice_event.signer_pubkey));
        assert!(submissions.last_submission_by_author.contains_key(&bob_event.signer_pubkey));
    }
}
