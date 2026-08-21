// module-pattern-miner.js — AIWA's own adaptation of a real pattern-
// mining approach the user showed directly, from YourMine
// (mine-patterns.js / ym-spec.json): extract real structural signals
// from already-fetched, already-hash-verified module source code, and
// summarize which real ctx primitives already-registered modules
// actually use, and how often — feeding the idea agent's own
// brainstorming prompt with a genuinely new, code-derived signal,
// distinct from every signal already there (registry metadata,
// desktop pins, published data, external GitHub trends).
//
// Deliberately NOT a code-generation system, unlike the YourMine
// original this is adapted from. YourMine's ym-spec.json exists
// specifically to feed a model enough structural knowledge to
// GENERATE new module code (skeleton_by_intent, a ctx_api reference,
// required_methods) — already confirmed, directly, more than once
// this session, that code generation stays outside AIWA's actual AI
// scope. This file stops at PATTERN FREQUENCY DATA: text a human (or
// the idea agent's own prompt) reads as inspiration, never a code
// template fed back in for generation. If that scope ever changes,
// that is its own, separate, explicit decision — not something to
// slide into by reusing this file for more than it was built for.
//
// Architecturally different from the YourMine original for a real,
// structural reason, not a stylistic one: YourMine mines a single,
// centralized files.json manifest from one GitHub repo. AIWA has no
// such thing — module registration is permissionless and DAG-
// replicated (module-registry.js); no single fetchable manifest of
// "every module that exists" is even meaningful, since different
// domains have reconciled different subsets of the real network. This
// file therefore mines whatever modules THIS domain already has in its
// own materialized registry (its own + its real contacts') — the exact
// same population collectContextSnapshot already draws from — never a
// network-wide crawl, and never a scheduled external bot the way
// fetch-github-trends.mjs is.

/**
 * Real ctx primitives a module can call — confirmed directly against
 * module-sandbox.js's own real ctx construction before this was
 * written, not guessed or carried over from memory of the YourMine
 * original's own, different ctx surface.
 */
export const KNOWN_CTX_CALLS = [
  'storage.get', 'storage.set', 'toast', 'commit', 'claim',
  'sendToPeer', 'onPeerMessage', 'transferClaim', 'postCausalEvent', 'queryCausalState',
];

/**
 * Extracts real structural signals from one module's real source code.
 * Pure string/regex analysis, no execution — mirrors mine-patterns.js's
 * own extraction discipline, adapted to AIWA's real, confirmed ctx
 * surface. A stated, honest limitation, not hidden: this is a
 * heuristic textual signal (a regex match, including inside comments
 * or strings), not a security or correctness check — nothing about
 * module admission or trust depends on it, exactly like YourMine's own
 * miner never claimed to be anything more than descriptive either.
 *
 * @param {string} code
 * @param {string} moduleId
 * @returns {{ moduleId: string, lineCount: number, hasIIFE: boolean, ctxCallsUsed: string[] }}
 */
export function extractModulePattern(code, moduleId) {
  const hasIIFE = /^\s*\(function\s*\(\s*\)\s*\{/.test(code.trim());
  const ctxCallsUsed = KNOWN_CTX_CALLS.filter((call) => {
    const escaped = call.replace('.', '\\.');
    return new RegExp(`ctx\\.${escaped}\\s*\\(`).test(code);
  });
  return { moduleId, lineCount: code.split('\n').length, hasIIFE, ctxCallsUsed };
}

/**
 * Summarizes real per-module extractions into frequency data — mirrors
 * mine-patterns.js's own buildSpec() frequency logic, deliberately
 * stopping at data: no skeleton_by_intent, no code templates. See this
 * file's own header for why that boundary is deliberate.
 *
 * @param {Array<ReturnType<typeof extractModulePattern>>} extractions
 * @param {number} [threshold] minimum frequency (0-1) to report a ctx call as a "common pattern"
 * @returns {{ totalModulesMined: number, commonCtxPatterns: Array<{ call: string, freq: number, count: number }>, unusedCtxPrimitives: string[] }}
 */
export function summarizeModulePatterns(extractions, threshold = 0.3) {
  const total = extractions.length;
  if (total === 0) {
    return { totalModulesMined: 0, commonCtxPatterns: [], unusedCtxPrimitives: [...KNOWN_CTX_CALLS] };
  }

  const counts = {};
  for (const call of KNOWN_CTX_CALLS) counts[call] = 0;
  for (const e of extractions) {
    for (const call of e.ctxCallsUsed) counts[call] = (counts[call] ?? 0) + 1;
  }

  const commonCtxPatterns = Object.entries(counts)
    .map(([call, count]) => ({ call, count, freq: count / total }))
    .filter((p) => p.freq >= threshold)
    .sort((a, b) => b.freq - a.freq);

  const unusedCtxPrimitives = KNOWN_CTX_CALLS.filter((call) => counts[call] === 0);

  return { totalModulesMined: total, commonCtxPatterns, unusedCtxPrimitives };
}
