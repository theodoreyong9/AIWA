pub mod module_hash;
pub mod module_registry;
pub mod module_submission;

pub use module_hash::{compute_module_hash, verify_module_integrity};
pub use module_registry::{
    select_identity_scheme, validate_economic_config, AuditStatus, EconomicConfig, IdentityScheme,
    ModuleEntry, ModuleRegistryState, NewModule, RegisterOutcome, ValidationResult,
};
pub use module_submission::{
    build_submission_event, record_nonce, submit_module, validate_submission,
    verify_submission_signature, SubmissionEvent, SubmissionState, SubmitOutcome, ValidationOutcome,
};
