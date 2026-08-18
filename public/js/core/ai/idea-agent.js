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
 * @typedef {{ id: string, name: string, category: string, author: string, registeredAt: number }} ModuleSummary
 * @typedef {{
 *   myModules: ModuleSummary[],
 *   myPinnedModuleIds: string[],
 *   myPublishedData: Record<string, Record<string, any>>,
 *   contactModules: Record<string, ModuleSummary[]>,
 *   sharedCategories: Record<string, number>,
 *   trendingCategories: Array<{ category: string, count: number }>,
 *   categoryGaps: string[],
 *   multiContactOverlap: Array<{ category: string, contactCount: number }>,
 * }} ContextSnapshot
 */

/**
 * Builds a real snapshot from this domain's own materialized module
 * registry and its known contacts (domains actually merged in via
 * reconciliation, §9 — never invented, never a placeholder list).
 * Pure: takes already-materialized state, does no fetching itself.
 *
 * Deepened, this revision, after the earlier version was found to be
 * shallower than intended: what a domain has REGISTERED is not the
 * same signal as what it actually USES (someone can register a module
 * they never open again), and a flat category count treats a category
 * three different unrelated contacts independently converged on the
 * same as one a single prolific contact happens to dominate — very
 * different strength of pattern. Three real, already-available signals
 * added, all pulled from data that already exists and is either
 * already public (the module registry, by design) or the caller's own
 * private local state (desktop pins, own published profile data —
 * never another domain's private state, never anything financial):
 *
 * - myPinnedModuleIds / myPublishedData: the caller's own real,
 *   local desktop arrangement (desktop-layout.js's own
 *   allModuleIdsInLayout — what is actually pinned, not merely
 *   registered) and own published module data (public-profile-
 *   reducer.js) — a genuine usage signal, not an authorship one.
 * - trendingCategories: category counts among only the most recently
 *   registered modules network-wide (registeredAt, already a real
 *   field on every module — see module-registry.js), not a flat
 *   all-time count, so a category three people just started matters
 *   more than one from months of accumulated, possibly-stale entries.
 * - categoryGaps / multiContactOverlap: real set operations over
 *   contacts' real modules — categories present among contacts but
 *   absent from this domain's own (a real, useful gap), and
 *   categories where 2+ DISTINCT contacts independently have a module
 *   (not just 2+ modules from one prolific contact) — the actual
 *   "multiple people converged on this independently" signal a
 *   flat count cannot distinguish from "one contact really likes this
 *   category."
 *
 * @param {import('../modules/module-registry.js').ModuleRegistryState} registryState
 * @param {string} myDomainId
 * @param {string[]} contactDomainIds
 * @param {{ pinnedModuleIds?: string[], publishedData?: Record<string, Record<string, any>> }} [own]
 * @returns {ContextSnapshot}
 */
export function collectContextSnapshot(registryState, myDomainId, contactDomainIds, own = {}) {
  const allModules = Object.values(registryState.modules).map((m) => ({ id: m.id, name: m.name, category: m.category, author: m.author, registeredAt: m.registeredAt }));

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

  // Recency-weighted: only the most recently registered third of the
  // network's modules (at least 1, if any exist at all) — a real,
  // if simple, stand-in for "what's actually happening lately" rather
  // than an all-time count a large, old registry would otherwise
  // permanently dominate.
  const byRecency = [...allModules].sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
  const recentSlice = byRecency.slice(0, Math.max(1, Math.ceil(byRecency.length / 3)));
  const trendingCounts = {};
  for (const m of recentSlice) trendingCounts[m.category] = (trendingCounts[m.category] ?? 0) + 1;
  const trendingCategories = Object.entries(trendingCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  const myCategories = new Set(myModules.map((m) => m.category));
  const contactCategoriesByContact = Object.fromEntries(
    Object.entries(contactModules).map(([contactId, mods]) => [contactId, new Set(mods.map((m) => m.category))]),
  );
  const allContactCategories = new Set(Object.values(contactCategoriesByContact).flatMap((s) => [...s]));
  const categoryGaps = [...allContactCategories].filter((c) => !myCategories.has(c)).sort();

  const contactCountByCategory = {};
  for (const categorySet of Object.values(contactCategoriesByContact)) {
    for (const category of categorySet) contactCountByCategory[category] = (contactCountByCategory[category] ?? 0) + 1;
  }
  const multiContactOverlap = Object.entries(contactCountByCategory)
    .filter(([, contactCount]) => contactCount >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([category, contactCount]) => ({ category, contactCount }));

  return {
    myModules,
    myPinnedModuleIds: own.pinnedModuleIds ?? [],
    myPublishedData: own.publishedData ?? {},
    contactModules,
    sharedCategories,
    trendingCategories,
    categoryGaps,
    multiContactOverlap,
  };
}

/**
 * The system prompt — mirror of YourMine's buildIdeaSystemPrompt(),
 * same structure and same discipline (state plainly that network data
 * is the only source of truth, forbid inventing trends), rebuilt
 * against AIWA's real snapshot shape instead of YourMine's. Deepened
 * this revision alongside collectContextSnapshot() itself — see that
 * function's own header for what each new signal is and why it is
 * real, not invented.
 *
 * @param {ContextSnapshot} snapshot
 * @returns {string}
 */
export function buildIdeaSystemPrompt(snapshot) {
  // Defaults so a hand-built (e.g. older-shape, test-constructed)
  // snapshot that omits the newer fields degrades gracefully to "no
  // data for this signal" rather than throwing — collectContextSnapshot
  // itself always provides all of these; this tolerance is for any
  // OTHER caller that builds a snapshot object directly.
  const myPinnedModuleIds = snapshot.myPinnedModuleIds ?? [];
  const myPublishedData = snapshot.myPublishedData ?? {};
  const trendingCategories = snapshot.trendingCategories ?? [];
  const categoryGaps = snapshot.categoryGaps ?? [];
  const multiContactOverlap = snapshot.multiContactOverlap ?? [];

  const myModuleNames = snapshot.myModules.map((m) => `${m.name} (${m.category})`).join(', ') || 'none yet';
  const contactCount = Object.keys(snapshot.contactModules).length;
  const topCategories = Object.entries(snapshot.sharedCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => `${category} x${count}`)
    .join(', ') || 'no network data yet';

  const pinnedLine = myPinnedModuleIds.length > 0
    ? `This domain actually keeps ${myPinnedModuleIds.length} module(s) pinned on its own desktop right now — real usage, not just registration.`
    : 'This domain has nothing pinned to its own desktop yet.';

  const publishedEntries = Object.entries(myPublishedData);
  const publishedLine = publishedEntries.length > 0
    ? `This domain has published real data from its own modules: ${publishedEntries.map(([moduleId, data]) => `${moduleId} (${Object.keys(data).join(', ')})`).join('; ')}.`
    : 'This domain has published no module data yet.';

  const trendingLine = trendingCategories.length > 0
    ? trendingCategories.slice(0, 5).map(({ category, count }) => `${category} x${count}`).join(', ')
    : 'not enough recent registrations to tell';

  const gapsLine = categoryGaps.length > 0
    ? categoryGaps.join(', ')
    : 'none — this domain already has a module in every category its contacts do';

  const overlapLine = multiContactOverlap.length > 0
    ? multiContactOverlap.slice(0, 5).map(({ category, contactCount }) => `${category} (${contactCount} contacts independently)`).join(', ')
    : 'no category yet shared by 2 or more distinct contacts';

  return [
    'You are a brainstorming assistant inside AIWA, a partition-tolerant platform where domains run small sandboxed modules.',
    'You suggest ONE concrete new module idea per reply, in plain text — short, like a real conversation, not JSON.',
    'Prefer an idea that ties to this domain\'s ACTUAL USAGE (pinned modules, published data) or a REAL, MULTI-CONTACT pattern over a generic one — a personalized suggestion beats a generic one whenever the data supports it.',
    'Format each suggestion as:',
    'Name — one-line tagline',
    'Why: one short sentence tying it to a real, specific signal below — name the actual signal (a pinned module, a category gap, a multi-contact pattern), not a vague generality.',
    '',
    'NETWORK DATA (your only source of truth — do not invent trends or news, you have no internet access):',
    `- This domain's own registered modules: ${myModuleNames}`,
    `- ${pinnedLine}`,
    `- ${publishedLine}`,
    `- Modules seen from ${contactCount} known contact domain${contactCount === 1 ? '' : 's'} (only domains actually reconciled with, §9)`,
    `- Most common module categories across the whole known network (all-time): ${topCategories}`,
    `- TRENDING categories (among only the most recently registered modules network-wide): ${trendingLine}`,
    `- CATEGORY GAPS (categories this domain's own contacts have, that this domain itself has none of): ${gapsLine}`,
    `- MULTI-CONTACT PATTERNS (categories where 2+ DISTINCT contacts each independently have a module, not just one prolific contact): ${overlapLine}`,
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
  'TRENDING categories', 'CATEGORY GAPS', 'MULTI-CONTACT PATTERNS', 'Prefer an idea that ties to',
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
