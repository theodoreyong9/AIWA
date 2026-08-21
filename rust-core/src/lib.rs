mod causal_condition_evaluator;
mod conservation;
mod core;
mod dag;
mod economics;
mod event;
mod generic_contract_reducer;
mod identity;
mod modules;
mod pool_reducer;
mod public_profile_reducer;
mod reception_cadence;

pub use conservation::{
    apply_conservation_event, identity_derivation, materialize_conservation, Claim, ClaimStatus,
    ConservationBridgeState, ConservationError, ConservationState, DerivationFn, PotReleaseVerifier, Proof,
};
pub use core::EventDagCore;
pub use dag::EventDag;
pub use economics::{
    apply_formula_event, elapsed_epochs, materialize_formulas, reward, simulate_hourly_issuance,
    AccrualRejection, CadenceState, DomainCadenceState, DomainConfig, DomainScarcityState,
    FormulaParams, FormulaRegistryState, FormulaRejection, GState, MintedFormula, RewardParams,
    ScarcityState, Snapshot, Theta, GENESIS_FORMULA_ID, GENESIS_FORMULA_PARAMS,
};
pub use event::Event;
pub use causal_condition_evaluator::{evaluate_condition, Condition, EvaluationContext, FunctionRegistry};
pub use pool_reducer::{compute_weighted_draw, pot_address, verify_pool_payout, Contribution, Cycle, Draw, PoolConfig, PoolRejection, PoolState};
pub use generic_contract_reducer::{substitute_placeholders, verify_generic_release, GenericContract, GenericContractRejection, GenericContractState};
pub use public_profile_reducer::{published_data_for_domain, PublicProfileState, PublishedValue};
pub use reception_cadence::{ReceptionCadenceState, ReceptionCommitment, ReceptionKind, ReceptionRejection, ReceivedRef, SourceEpochLookup};
pub use identity::{
    apply_identity_event, derive_domain_id, materialize_identity, short_domain_label,
    verify_burn_proof, Commitment, IdentityCostState, NormalizedBurnTx, RegisterResult,
    RegisteredIdentity, VerifyResult, SOLANA_INCINERATOR_ADDRESS,
    ChurnConfig, linear_cost_curve, required_burn_lamports,
};
pub use modules::{
    apply_module_event, build_submission_event, check_submission_eligibility,
    compute_module_hash, compute_module_rank, materialize_module_registry, rank_from_identity_and_cadence, record_nonce,
    select_identity_scheme, submit_module, validate_economic_config, validate_submission,
    verify_module_integrity, verify_submission_signature, AuditStatus, EconomicConfig,
    EligibilityResult, IdentityScheme, LastSubmission, ModuleEntry, ModuleRegistryState,
    NewModule, RegisterOutcome, SubmissionEligibilityCheck, SubmissionEvent, SubmissionState, SubmitOutcome,
    ValidationOutcome, ValidationResult,
};
