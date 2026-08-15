use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IdentityScheme {
    Strong,
    Weak,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AuditStatus {
    Unaudited,
    Passed,
    RedListed,
}

#[derive(Debug, Clone)]
pub struct EconomicConfig {
    pub alpha: f64,
    pub identity_cost_mechanism: Option<String>,
    pub scarcity_policy: String,
}

#[derive(Debug, Clone)]
pub struct ModuleEntry {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub category: String,
    pub description: String,
    pub code_hash: String,
    pub code_url: String,
    pub author: String,
    pub is_issuing: bool,
    pub time_sensitive: Option<bool>,
    pub economic_config: Option<EconomicConfig>,
    pub identity_scheme: Option<IdentityScheme>,
    pub audit_status: AuditStatus,
    pub registered_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ModuleRegistryState {
    pub modules: HashMap<String, ModuleEntry>,
}

/// §11/§27.2: derives the minimum sufficient identity scheme from
/// whether the module's reward function is time-sensitive — mirror of
/// selectIdentityScheme() in module-registry.js.
pub fn select_identity_scheme(time_sensitive: bool) -> IdentityScheme {
    if time_sensitive {
        IdentityScheme::Strong
    } else {
        IdentityScheme::Weak
    }
}

#[derive(Debug, PartialEq)]
pub struct ValidationResult {
    pub valid: bool,
    pub reason: Option<String>,
}

/// §24.1, enforced: α ≤ 1 with no identity-cost mechanism has an
/// unbounded splitting incentive — mirror of validateEconomicConfig()
/// in module-registry.js.
pub fn validate_economic_config(config: &EconomicConfig) -> ValidationResult {
    if !config.alpha.is_finite() {
        return ValidationResult { valid: false, reason: Some("alpha must be a finite number".to_string()) };
    }
    if config.alpha <= 1.0 && config.identity_cost_mechanism.is_none() {
        return ValidationResult {
            valid: false,
            reason: Some(
                "alpha <= 1 with no identity-cost mechanism has an unbounded splitting incentive (§24.1) — declare an identity_cost_mechanism or raise alpha above 1"
                    .to_string(),
            ),
        };
    }
    if config.scarcity_policy.is_empty() {
        return ValidationResult { valid: false, reason: Some("scarcity_policy must be declared".to_string()) };
    }
    ValidationResult { valid: true, reason: None }
}

pub struct NewModule {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub category: String,
    pub description: String,
    pub code_hash: String,
    pub code_url: String,
    pub author: String,
    pub is_issuing: bool,
    pub time_sensitive: Option<bool>,
    pub economic_config: Option<EconomicConfig>,
}

#[derive(Debug, PartialEq)]
pub struct RegisterOutcome {
    pub accepted: bool,
    pub reason: Option<String>,
}

impl ModuleRegistryState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registration is open — no author allow-list, no approval step.
    /// The only rejections are mechanical: a duplicate id, or (for an
    /// issuing module only) an internally-inconsistent economic
    /// declaration. Mirror of registerModule() in module-registry.js.
    pub fn register_module(&mut self, entry: NewModule, now: i64) -> RegisterOutcome {
        if self.modules.contains_key(&entry.id) {
            return RegisterOutcome {
                accepted: false,
                reason: Some(format!("module id '{}' is already registered", entry.id)),
            };
        }

        let mut identity_scheme = None;
        if entry.is_issuing {
            let time_sensitive = match entry.time_sensitive {
                Some(v) => v,
                None => {
                    return RegisterOutcome {
                        accepted: false,
                        reason: Some("an issuing module must declare time_sensitive".to_string()),
                    }
                }
            };
            let config = match &entry.economic_config {
                Some(c) => c,
                None => {
                    return RegisterOutcome {
                        accepted: false,
                        reason: Some("an issuing module must declare economic_config".to_string()),
                    }
                }
            };
            let check = validate_economic_config(config);
            if !check.valid {
                return RegisterOutcome { accepted: false, reason: check.reason };
            }
            identity_scheme = Some(select_identity_scheme(time_sensitive));
        }

        self.modules.insert(
            entry.id.clone(),
            ModuleEntry {
                id: entry.id,
                name: entry.name,
                icon: entry.icon,
                category: entry.category,
                description: entry.description,
                code_hash: entry.code_hash,
                code_url: entry.code_url,
                author: entry.author,
                is_issuing: entry.is_issuing,
                time_sensitive: entry.time_sensitive,
                economic_config: entry.economic_config,
                identity_scheme,
                audit_status: AuditStatus::Unaudited,
                registered_at: now,
            },
        );
        RegisterOutcome { accepted: true, reason: None }
    }

    /// Still open, no permission required — resets audit_status to
    /// Unaudited so a stale verdict never silently carries over to new
    /// code. Mirror of updateModuleCode().
    pub fn update_module_code(&mut self, id: &str, code_hash: String, code_url: String) -> RegisterOutcome {
        match self.modules.get_mut(id) {
            Some(m) => {
                m.code_hash = code_hash;
                m.code_url = code_url;
                m.audit_status = AuditStatus::Unaudited;
                RegisterOutcome { accepted: true, reason: None }
            }
            None => RegisterOutcome { accepted: false, reason: Some(format!("module id '{id}' is not registered")) },
        }
    }

    /// A hook for a future (AI-driven, per the project's stated
    /// direction) audit to attach a durable verdict to — not an audit
    /// implementation itself. Mirror of setAuditStatus().
    pub fn set_audit_status(&mut self, id: &str, status: AuditStatus) -> RegisterOutcome {
        match self.modules.get_mut(id) {
            Some(m) => {
                m.audit_status = status;
                RegisterOutcome { accepted: true, reason: None }
            }
            None => RegisterOutcome { accepted: false, reason: Some(format!("module id '{id}' is not registered")) },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_entry(id: &str) -> NewModule {
        NewModule {
            id: id.to_string(),
            name: "My Module".to_string(),
            icon: "🔮".to_string(),
            category: "Tools".to_string(),
            description: "Does a thing.".to_string(),
            code_hash: "hash1".to_string(),
            code_url: "https://example.com/mymodule.js".to_string(),
            author: "alice".to_string(),
            is_issuing: false,
            time_sensitive: None,
            economic_config: None,
        }
    }

    #[test]
    fn select_identity_scheme_derives_from_time_sensitivity() {
        assert_eq!(select_identity_scheme(true), IdentityScheme::Strong);
        assert_eq!(select_identity_scheme(false), IdentityScheme::Weak);
    }

    #[test]
    fn validate_rejects_alpha_leq_1_with_no_identity_cost() {
        let cfg = EconomicConfig { alpha: 1.0, identity_cost_mechanism: None, scarcity_policy: "preallocated".to_string() };
        assert!(!validate_economic_config(&cfg).valid);
    }

    #[test]
    fn validate_accepts_alpha_leq_1_with_identity_cost() {
        let cfg = EconomicConfig {
            alpha: 0.5,
            identity_cost_mechanism: Some("sol-burn".to_string()),
            scarcity_policy: "preallocated".to_string(),
        };
        assert!(validate_economic_config(&cfg).valid);
    }

    #[test]
    fn validate_accepts_alpha_gt_1_with_no_identity_cost() {
        let cfg = EconomicConfig { alpha: 1.5, identity_cost_mechanism: None, scarcity_policy: "preallocated".to_string() };
        assert!(validate_economic_config(&cfg).valid);
    }

    #[test]
    fn non_issuing_module_registers_without_economic_declaration() {
        let mut state = ModuleRegistryState::new();
        let outcome = state.register_module(base_entry("mymodule.js"), 1000);
        assert!(outcome.accepted);
        assert_eq!(state.modules["mymodule.js"].identity_scheme, None);
        assert_eq!(state.modules["mymodule.js"].audit_status, AuditStatus::Unaudited);
    }

    #[test]
    fn issuing_module_without_economic_config_is_rejected() {
        let mut state = ModuleRegistryState::new();
        let mut entry = base_entry("mymodule.js");
        entry.is_issuing = true;
        entry.time_sensitive = Some(true);
        assert!(!state.register_module(entry, 1000).accepted);
    }

    #[test]
    fn valid_issuing_module_gets_identity_scheme_from_lemma_1() {
        let mut state = ModuleRegistryState::new();
        let mut entry = base_entry("mymodule.js");
        entry.is_issuing = true;
        entry.time_sensitive = Some(true);
        entry.economic_config = Some(EconomicConfig { alpha: 2.0, identity_cost_mechanism: None, scarcity_policy: "preallocated".to_string() });
        let outcome = state.register_module(entry, 1000);
        assert!(outcome.accepted);
        assert_eq!(state.modules["mymodule.js"].identity_scheme, Some(IdentityScheme::Strong));
    }

    #[test]
    fn registration_is_open_no_allowlist() {
        let mut state = ModuleRegistryState::new();
        let mut e1 = base_entry("a.js");
        e1.author = "alice".to_string();
        assert!(state.register_module(e1, 1000).accepted);
        let mut e2 = base_entry("b.js");
        e2.author = "someone-nobody-approved".to_string();
        assert!(state.register_module(e2, 1001).accepted);
    }

    #[test]
    fn duplicate_id_rejected() {
        let mut state = ModuleRegistryState::new();
        state.register_module(base_entry("a.js"), 1000);
        let outcome = state.register_module(base_entry("a.js"), 1001);
        assert!(!outcome.accepted);
    }

    #[test]
    fn update_module_code_resets_audit_status() {
        let mut state = ModuleRegistryState::new();
        state.register_module(base_entry("mymodule.js"), 1000);
        state.set_audit_status("mymodule.js", AuditStatus::Passed);
        assert_eq!(state.modules["mymodule.js"].audit_status, AuditStatus::Passed);

        state.update_module_code("mymodule.js", "hash2".to_string(), "https://example.com/m.js".to_string());
        assert_eq!(state.modules["mymodule.js"].audit_status, AuditStatus::Unaudited);
        assert_eq!(state.modules["mymodule.js"].code_hash, "hash2");
    }

    #[test]
    fn set_audit_status_supports_red_listing() {
        let mut state = ModuleRegistryState::new();
        state.register_module(base_entry("mymodule.js"), 1000);
        state.set_audit_status("mymodule.js", AuditStatus::RedListed);
        assert_eq!(state.modules["mymodule.js"].audit_status, AuditStatus::RedListed);
    }
}
