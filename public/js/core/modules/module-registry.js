// module-registry.js — module registry: registration is open by
// design (no permission, no gatekeeping to publish — anyone can
// register any module at any time), but registration still validates
// two things, both already backed by real code elsewhere in this
// project rather than asserted in prose:
//
//   1. Economic self-declaration: a module that issues accrual must
//      declare whether its reward is time-sensitive (the runtime
//      derives the strong/weak identity scheme from this
//      automatically) and its economic config (α, identity-cost
//      mechanism, scarcity policy). This is enforced here, not just
//      described: α ≤ 1 with no identity-cost mechanism has an
//      unbounded splitting incentive, and is rejected.
//   2. Content integrity (module-hash.js): a registration binds an id
//      to a specific code hash, not a mutable URL.
//
// What this file deliberately does NOT do: decide whether a module's
// CODE is safe, malicious, or good. That's the audit step — per the
// project's own stated direction, an AI-driven audit layered on top of
// this registry later, not a rule enforced at registration time. This
// registry's job is narrower and more mechanical: make sure a judgment,
// whenever and however it's made, has something durable to attach to.

/**
 * @typedef {'strong' | 'weak'} IdentityScheme
 * @typedef {'unaudited' | 'passed' | 'red-listed'} AuditStatus
 *
 * @typedef {{
 *   alpha: number,
 *   identityCostMechanism: string | null,
 *   scarcityPolicy: string,
 * }} EconomicConfig
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   icon: string,
 *   category: string,
 *   description: string,
 *   codeHash: string,
 *   codeUrl: string,
 *   author: string,
 *   isIssuing: boolean,
 *   timeSensitive: boolean | null,
 *   economicConfig: EconomicConfig | null,
 *   identityScheme: IdentityScheme | null,
 *   auditStatus: AuditStatus,
 *   registeredAt: number,
 * }} ModuleEntry
 *
 * @typedef {{ modules: Record<string, ModuleEntry> }} ModuleRegistryState
 */

export function initialModuleRegistryState() {
  return { modules: {} };
}

/**
 * The runtime does not ask a module author to pick an identity scheme
 * — it derives the minimum sufficient one from the one fact that
 * actually determines it: whether the module's reward function is
 * sensitive to elapsed cadence time. A module that declares itself
 * time-insensitive gets the cheaper weak scheme automatically; nothing
 * stronger is forced on it, and nothing weaker is permitted if it
 * declared time-sensitivity.
 *
 * @param {boolean} timeSensitive
 * @returns {IdentityScheme}
 */
export function selectIdentityScheme(timeSensitive) {
  return timeSensitive ? 'strong' : 'weak';
}

/**
 * Enforced rather than only described: with reward concave or
 * linear in committed capital (α ≤ 1) and no identity-cost mechanism,
 * splitting into many identities is non-decreasing in profit and
 * reward concavity alone gives no bound — a module configured this way
 * has, by the paper's own algebra, an unbounded Sybil-splitting
 * incentive. This is the one case registration actually refuses, not
 * because the code is judged unsafe, but because the declared economics
 * are internally inconsistent with what this project's own analysis
 * requires.
 *
 * @param {EconomicConfig} config
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateEconomicConfig(config) {
  if (!Number.isFinite(config.alpha)) {
    return { valid: false, reason: 'alpha must be a finite number' };
  }
  if (config.alpha <= 1 && !config.identityCostMechanism) {
    return {
      valid: false,
      reason: 'alpha <= 1 with no identity-cost mechanism has an unbounded splitting incentive — declare an identityCostMechanism or raise alpha above 1',
    };
  }
  if (!config.scarcityPolicy) {
    return { valid: false, reason: 'scarcityPolicy must be declared' };
  }
  return { valid: true };
}

/**
 * Registers a module. Always open — no author allow-list, no approval
 * step, no minimum reputation to publish. The only rejections are
 * mechanical: a duplicate id, or (for an issuing module only) an
 * internally-inconsistent economic declaration per validateEconomicConfig.
 * A non-issuing module (isIssuing: false) skips economic validation
 * entirely and registers in read-only mode.
 *
 * @param {ModuleRegistryState} state
 * @param {Omit<ModuleEntry, 'identityScheme' | 'auditStatus' | 'registeredAt'>} entry
 * @param {{ now?: number }} [opts]
 * @returns {{ state: ModuleRegistryState, accepted: boolean, reason?: string }}
 */
export function registerModule(state, entry, { now = Date.now() } = {}) {
  if (state.modules[entry.id]) {
    return { state, accepted: false, reason: `module id '${entry.id}' is already registered` };
  }

  let identityScheme = null;
  if (entry.isIssuing) {
    if (typeof entry.timeSensitive !== 'boolean') {
      return { state, accepted: false, reason: 'an issuing module must declare timeSensitive (true or false)' };
    }
    if (!entry.economicConfig) {
      return { state, accepted: false, reason: 'an issuing module must declare economicConfig' };
    }
    const check = validateEconomicConfig(entry.economicConfig);
    if (!check.valid) {
      return { state, accepted: false, reason: check.reason };
    }
    identityScheme = selectIdentityScheme(entry.timeSensitive);
  }

  const record = { ...entry, identityScheme, auditStatus: 'unaudited', registeredAt: now };
  return { state: { modules: { ...state.modules, [entry.id]: record } }, accepted: true };
}

/**
 * Publishes a new code version for an already-registered module —
 * still open, no permission required, matching the project's stated
 * "plug and submit, as frictionless as possible" direction. What
 * changes going forward (module-hash.js) is that this is a distinct,
 * recorded event with its own hash: any judgment already made about
 * the previous codeHash does not silently carry over to this one.
 *
 * @param {ModuleRegistryState} state
 * @param {{ id: string, codeHash: string, codeUrl: string }} params
 */
export function updateModuleCode(state, { id, codeHash, codeUrl }) {
  const existing = state.modules[id];
  if (!existing) {
    return { state, accepted: false, reason: `module id '${id}' is not registered` };
  }
  const updated = { ...existing, codeHash, codeUrl, auditStatus: 'unaudited' };
  return { state: { modules: { ...state.modules, [id]: updated } }, accepted: true };
}

/**
 * Records an audit verdict against a module's CURRENT codeHash. Not an
 * audit implementation — a hook for one (per the project's stated
 * direction, an AI-driven audit, built later) to attach a durable
 * verdict to. Because updateModuleCode() resets auditStatus to
 * 'unaudited' on every code change, a verdict can never silently apply
 * to a version of the code it was never actually about.
 *
 * @param {ModuleRegistryState} state
 * @param {string} id
 * @param {import('./module-registry.js').AuditStatus} status
 */
const VALID_AUDIT_STATUSES = ['unaudited', 'passed', 'red-listed'];

/**
 * SECURITY/PARITY: previously accepted any string as `status` with no
 * validation at all (enum membership was only enforced in a JSDoc
 * comment) — Rust's own set_audit_status() already required a real
 * AuditStatus enum member. Given an identical 'module-audit' event,
 * the two languages could materialize different auditStatus values,
 * a real cross-language divergence found by direct inspection, not
 * hypothetical. Fixed to validate the same closed set Rust's own enum
 * defines.
 */
export function setAuditStatus(state, id, status) {
  const existing = state.modules[id];
  if (!existing) {
    return { state, accepted: false, reason: `module id '${id}' is not registered` };
  }
  if (!VALID_AUDIT_STATUSES.includes(status)) {
    return { state, accepted: false, reason: `'${status}' is not a valid audit status — must be one of ${VALID_AUDIT_STATUSES.join(', ')}` };
  }
  return { state: { modules: { ...state.modules, [id]: { ...existing, auditStatus: status } } }, accepted: true };
}
