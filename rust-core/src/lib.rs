mod conservation;
mod core;
mod dag;
mod economics;
mod event;
mod identity;
mod modules;

pub use conservation::{
    apply_conservation_event, identity_derivation, materialize_conservation, Claim, ClaimStatus,
    ConservationBridgeState, ConservationError, ConservationState, DerivationFn, Proof,
};
pub use core::EventDagCore;
pub use dag::EventDag;
pub use economics::{
    elapsed_epochs, reward, simulate_hourly_issuance, AccrualRejection, CadenceState,
    DomainCadenceState, DomainConfig, DomainScarcityState, GState, RewardParams, ScarcityState,
    Snapshot, Theta,
};
pub use event::Event;
pub use identity::{
    apply_identity_event, derive_domain_id, materialize_identity, short_domain_label,
    verify_burn_proof, Commitment, IdentityCostState, NormalizedBurnTx, RegisterResult,
    RegisteredIdentity, VerifyResult, SOLANA_INCINERATOR_ADDRESS,
};
pub use modules::{
    apply_module_event, build_submission_event, check_submission_eligibility,
    compute_module_hash, compute_module_rank, materialize_module_registry, record_nonce,
    select_identity_scheme, submit_module, validate_economic_config, validate_submission,
    verify_module_integrity, verify_submission_signature, AuditStatus, EconomicConfig,
    EligibilityResult, IdentityScheme, LastSubmission, ModuleEntry, ModuleRegistryState,
    NewModule, RegisterOutcome, SubmissionEvent, SubmissionState, SubmitOutcome,
    ValidationOutcome, ValidationResult,
};
