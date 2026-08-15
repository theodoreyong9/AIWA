export function initialModuleRegistryState() { return { modules: {} }; }

export function selectIdentityScheme(timeSensitive) {
  return timeSensitive ? 'strong' : 'weak';
}

export function validateEconomicConfig(config) {
  if (!Number.isFinite(config.alpha)) return { valid: false, reason: 'alpha must be a finite number' };
  if (config.alpha <= 1 && !config.identityCostMechanism) {
    return { valid: false, reason: 'alpha <= 1 with no identity-cost mechanism has an unbounded splitting incentive (§24.1)' };
  }
  if (!config.scarcityPolicy) return { valid: false, reason: 'scarcityPolicy must be declared' };
  return { valid: true };
}

export function registerModule(state, entry, { now = Date.now() } = {}) {
  if (state.modules[entry.id]) return { state, accepted: false, reason: `module id '${entry.id}' is already registered` };
  let identityScheme = null;
  if (entry.isIssuing) {
    if (typeof entry.timeSensitive !== 'boolean') return { state, accepted: false, reason: 'an issuing module must declare timeSensitive' };
    if (!entry.economicConfig) return { state, accepted: false, reason: 'an issuing module must declare economicConfig' };
    const check = validateEconomicConfig(entry.economicConfig);
    if (!check.valid) return { state, accepted: false, reason: check.reason };
    identityScheme = selectIdentityScheme(entry.timeSensitive);
  }
  const record = { ...entry, identityScheme, auditStatus: 'unaudited', registeredAt: now };
  return { state: { modules: { ...state.modules, [entry.id]: record } }, accepted: true };
}

export function updateModuleCode(state, { id, codeHash, codeUrl }) {
  const existing = state.modules[id];
  if (!existing) return { state, accepted: false, reason: `module id '${id}' is not registered` };
  const updated = { ...existing, codeHash, codeUrl, auditStatus: 'unaudited' };
  return { state: { modules: { ...state.modules, [id]: updated } }, accepted: true };
}

export function setAuditStatus(state, id, status) {
  const existing = state.modules[id];
  if (!existing) return { state, accepted: false, reason: `module id '${id}' is not registered` };
  return { state: { modules: { ...state.modules, [id]: { ...existing, auditStatus: status } } }, accepted: true };
}
