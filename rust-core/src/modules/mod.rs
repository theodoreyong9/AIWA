pub mod module_hash;
pub mod module_rank;
pub mod module_registry;
pub mod module_registry_reducer;
pub mod module_submission;

pub use module_hash::{compute_module_hash, verify_module_integrity};
pub use module_rank::{check_submission_eligibility, compute_module_rank, rank_from_identity_and_cadence, EligibilityResult, LastSubmission};
pub use module_registry::{
    select_identity_scheme, validate_economic_config, AuditStatus, EconomicConfig, IdentityScheme,
    ModuleEntry, ModuleRegistryState, NewModule, RegisterOutcome, ValidationResult,
};
pub use module_registry_reducer::{apply_module_event, materialize_module_registry};
pub use module_submission::{
    build_submission_event, record_nonce, submit_module, validate_submission,
    verify_submission_signature, SubmissionEligibilityCheck, SubmissionEvent, SubmissionState, SubmitOutcome, ValidationOutcome,
};
