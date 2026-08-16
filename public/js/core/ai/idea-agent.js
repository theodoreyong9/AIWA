// idea-agent.js — the single AI feature this project actually wants
// (confirmed directly: "je veux uniquement un générateur d'idées comme
// je t'ai dis utilisant webllm" — not code generation, not a public-code
// checker, just a brainstorming assistant). Modeled on YourMine's own
// real renderIdeaChat()/collectNetworkSnapshot()/buildIdeaSystemPrompt(),
// adapted to AIWA's real data instead of YourMine's global window.YM_S
// registry and localStorage: a domain's real registered/pinned modules
// (module-registry.js, already DAG-replicated) and real contacts
// (materialized cadence state, populated only after real reconciliation
// through the real transport, §25) — not invented, not a separate
// social layer with its own state.
//
// Split deliberately, matching this project's established discipline:
// everything here is pure data transformation and string construction,
// fully testable without a browser. The one genuinely untestable piece
// — actually running an on-device model via WebGPU/Worker — lives in
// webllm-engine.js and is injected here as a function, never imported
// directly, so this file has no dependency on browser-only APIs at all.

/**
 * @typedef {{ id: string, name: string, category: string, author: string }} ModuleSummary
 * @typedef {{ myModules: ModuleSummary[], contactModules: Record<string, ModuleSummary[]>, sharedCategories: Record<string, number> }} ContextSnapshot
 */

/**
 * Builds a real snapshot from this domain's own materialized module
 * registry and its known contacts (domains actually merged in via
 * reconciliation, §9 — never invented, never a placeholder list).
 * Pure: takes already-materialized state, does no fetching itself.
 *
 * @param {import('../modules/module-registry.js').ModuleRegistryState} registryState
 * @param {string} myDomainId
 * @param {string[]} contactDomainIds
 * @returns {ContextSnapshot}
 */
export function collectContextSnapshot(registryState, myDomainId, contactDomainIds) {
  const allModules = Object.values(registryState.modules).map((m) => ({ id: m.id, name: m.name, category: m.category, author: m.author }));

  const myModules = allModules.filter((m) => m.author === myDomainId);

  const contactModules = {};
  for (const contactId of contactDomainIds) {
    const theirs = allModules.filter((m) => m.author === contactId);
    if (theirs.length > 0) contactModules[contactId] = theirs;
  }

  const sharedCategories = {};
  for (const m of allModules) {
    sharedCategories[m.category] = (sharedCategories[m.category] ?? 0) + 1;
  }

  return { myModules, contactModules, sharedCategories };
}

/**
 * The system prompt — mirror of YourMine's buildIdeaSystemPrompt(),
 * same structure and same discipline (state plainly that network data
 * is the only source of truth, forbid inventing trends), rebuilt
 * against AIWA's real snapshot shape instead of YourMine's.
 *
 * @param {ContextSnapshot} snapshot
 * @returns {string}
 */
export function buildIdeaSystemPrompt(snapshot) {
  const myModuleNames = snapshot.myModules.map((m) => `${m.name} (${m.category})`).join(', ') || 'none yet';
  const contactCount = Object.keys(snapshot.contactModules).length;
  const topCategories = Object.entries(snapshot.sharedCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => `${category} x${count}`)
    .join(', ') || 'no network data yet';

  return [
    'You are a brainstorming assistant inside AIWA, a partition-tolerant platform where domains run small sandboxed modules.',
    'You suggest ONE concrete new module idea per reply, in plain text — short, like a real conversation, not JSON.',
    'Format each suggestion as:',
    'Name — one-line tagline',
    'Why: one short sentence tying it to a real pattern below.',
    '',
    'NETWORK DATA (your only source of truth — do not invent trends or news, you have no internet access):',
    `- This domain's own registered modules: ${myModuleNames}`,
    `- Modules seen from ${contactCount} known contact domain${contactCount === 1 ? '' : 's'} (only domains actually reconciled with, §9)`,
    `- Most common module categories across the whole known network: ${topCategories}`,
    '',
    'If the user asks a follow-up (different category, "another one", "more social", etc.), give a NEW idea matching that request — never repeat a previous suggestion.',
    'Stop writing immediately after the Why line. Do not add anything else.',
  ].join('\n');
}

// Defensive cleanup: small on-device models sometimes keep generating
// past their actual answer and start reproducing nearby instruction
// text verbatim — a known failure mode with small local models, not
// specific to any one app (the same defense YourMine's own
// sanitizeIdeaReply() uses, kept here for the same reason).
const IDEA_LEAK_MARKERS = [
  'NETWORK DATA', 'You are a brainstorming assistant', 'Format each suggestion as',
  'Stop writing immediately', "This domain's own registered modules:", 'Most common module categories',
];

/**
 * @param {string} text
 * @returns {string}
 */
export function sanitizeIdeaReply(text) {
  let cut = text.length;
  for (const marker of IDEA_LEAK_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  const trimmed = text.slice(0, cut).trim();
  return trimmed || text.trim(); // never return empty if the whole thing matched somehow
}
