mod conservation;
mod core;
mod dag;
mod economics;
mod event;
mod identity;
mod modules;

pub use conservation::{identity_derivation, Claim, ClaimStatus, ConservationError, ConservationState, DerivationFn, Proof};
pub use core::EventDagCore;
pub use dag::EventDag;
pub use economics::{
    elapsed_epochs, reward, simulate_hourly_issuance, AccrualRejection, CadenceState,
    DomainCadenceState, DomainConfig, DomainScarcityState, GState, RewardParams, ScarcityState,
    Snapshot, Theta,
};
pub use event::Event;
pub use identity::{
    verify_burn_proof, Commitment, IdentityCostState, NormalizedBurnTx, RegisterResult,
    RegisteredIdentity, VerifyResult, SOLANA_INCINERATOR_ADDRESS,
};
pub use modules::{
    build_submission_event, compute_module_hash, record_nonce, select_identity_scheme,
    submit_module, validate_economic_config, validate_submission, verify_module_integrity,
    verify_submission_signature, AuditStatus, EconomicConfig, IdentityScheme, ModuleEntry,
    ModuleRegistryState, NewModule, RegisterOutcome, SubmissionEvent, SubmissionState,
    SubmitOutcome, ValidationOutcome, ValidationResult,
};
