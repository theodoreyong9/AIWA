// causal-condition-evaluator.js — a general, fixed, auditable evaluator
// over a small, non-Turing-complete vocabulary of verification
// primitives, composed as plain data (AND/OR/NOT), so a genuinely new
// causal contract can compose EXISTING, already-audited checks without
// ever needing a new reducer file or touching module-sandbox.js's own
// security boundary. §27.8 closed HALF this problem — ctx.postCausalEvent
// / ctx.queryCausalState let any module post or read any event type
// permissionlessly, because legitimacy has never come from which ctx
// method was called, only from whichever reducer independently
// verifies a given event type. What still needed a platform update
// every time was the REDUCER half: writing new verification LOGIC.
// This file closes that half, for verification logic expressible as a
// composition of the primitives below — a genuinely novel primitive
// still needs a platform update, honestly, not hidden (§4 below).
//
// Deliberately NOT a general-purpose interpreter. Considered and
// explicitly rejected: a metered, sandboxed JS interpreter (real gas
// accounting, its own audit surface, closer in scope to a small EVM
// than to anything else in this project) — named as the larger
// alternative if this smaller design proves insufficient, not pursued
// here. Nothing in this vocabulary can express unbounded computation:
// no loops, no arbitrary code, only AND/OR/NOT over six fixed checks.
//
// Every primitive below generalizes a check some already-shipped
// reducer already performs by hand — extracted, not invented, and each
// one's own comment names exactly which real file it generalizes.

/**
 * @typedef {
 *   | { type: 'ownership', claimId: string, expectedOwner: string }
 *   | { type: 'signature', message: string, signerPubkeyHex: string, signatureHex: string, expectedDomain: string }
 *   | { type: 'count', eventType: string, domain?: string, filter?: Record<string, any>, min: number }
 *   | { type: 'deterministic-match', function: string, args: any[], expectedOutput: any, outputPath?: string }
 *   | { type: 'unique', key: string }
 *   | { type: 'causal-order', beforeEventId: string, afterEventId: string }
 *   | { all: Condition[] }
 *   | { any: Condition[] }
 *   | { not: Condition }
 * } Condition
 *
 * @typedef {{
 *   conservationState?: import('../conservation/conservation.js').ConservationState,
 *   orderedEvents?: Array<{ id: string, parents: string[], payload: any }>,
 *   functionRegistry?: Record<string, (...args: any[]) => any>,
 *   usedKeys?: Set<string>,
 * }} EvaluationContext
 */

function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

/**
 * "claim X is currently owned by domain Y, status active."
 * Generalizes verifyPoolPayout's claim-ownership check (pool-reducer.js)
 * and prove_transfer's owner check (conservation.js) — both already
 * real, already tested, hand-written per file before this evaluator
 * existed.
 */
function evalOwnership(cond, ctx) {
  const claims = ctx.conservationState?.claims;
  if (!claims) return false;
  const claim = claims[cond.claimId];
  return Boolean(claim && claim.owner === cond.expectedOwner && claim.status === 'active');
}

/**
 * "at least N real events of type T (optionally: from domain D,
 * optionally: matching a flat field-equality filter) exist in the
 * folded history." Generalizes pool-reducer.js's cycle-closing check
 * (cycle.contributions.length >= pool.cycleLengthContributions).
 * Deliberately flat, exact-equality-only filtering — no nested
 * operators, no boolean sub-expressions inside a single count filter —
 * so this primitive itself never grows into a second mini-language.
 */
function evalCount(cond, ctx) {
  const events = ctx.orderedEvents;
  if (!events) return false;
  const matches = events.filter((e) => {
    const p = e.payload;
    if (!p || p.type !== cond.eventType) return false;
    if (cond.domain !== undefined && p.domain !== cond.domain) return false;
    if (cond.filter) {
      for (const [key, value] of Object.entries(cond.filter)) {
        if (p[key] !== value) return false;
      }
    }
    return true;
  });
  return matches.length >= cond.min;
}

/**
 * "recomputing a named, registered pure function over given inputs
 * produces the claimed output." Generalizes computeWeightedDraw's role
 * inside verifyPoolPayout — the recompute-don't-trust pattern this
 * whole project already leans on for event ids, module hashes, and
 * formula parity, made reusable across contracts instead of re-
 * implemented per file. `functionRegistry` is a fixed, platform-
 * maintained set of named pure functions — a genuinely new pure
 * computation still needs a platform update to register it here,
 * stated honestly as this primitive's own scope boundary, not hidden.
 * `outputPath` (optional, dot-separated, no operators) lets a condition
 * compare one specific field of the function's result rather than the
 * whole structure — e.g. 'winnerDomain' out of computeWeightedDraw's
 * {winnerDomain, totalAmount, drawHash}.
 */
async function evalDeterministicMatch(cond, ctx) {
  const fn = ctx.functionRegistry?.[cond.function];
  if (typeof fn !== 'function') return false;
  let result;
  try {
    result = await fn(...cond.args);
  } catch {
    return false; // a throwing recomputation is a rejection, not a crash
  }
  const actual = getPath(result, cond.outputPath);
  return deepEqual(actual, cond.expectedOutput);
}

/**
 * "this key has never been set before, permanent once set."
 * Generalizes pool-init's and formula-registry's mint-once-forever
 * discipline. `usedKeys` is read-only from this evaluator's
 * perspective — whichever reducer wraps this evaluator owns and
 * updates the real set as its own state, exactly like pool-reducer.js
 * already owns `usedContributionClaimIds` itself.
 */
function evalUnique(cond, ctx) {
  return !(ctx.usedKeys?.has(cond.key));
}

/**
 * "event A causally precedes event B in this domain's own history" — a
 * real DAG-parent-chain walk. Generalizes cadence.js's own last-
 * accepted-event chaining logic. Honest, stated limitation: this walks
 * `afterEventId`'s real ancestor chain up to a fixed safety bound
 * (10,000 events) rather than unboundedly — a genuinely pathological,
 * extremely deep chain would report false rather than walk forever;
 * this bound is a deliberate DoS guard, not a claim that 10,000 is
 * always sufficient for every deployment.
 */
function evalCausalOrder(cond, ctx) {
  const events = ctx.orderedEvents;
  if (!events) return false;
  const byId = new Map(events.map((e) => [e.id, e]));
  const target = byId.get(cond.afterEventId);
  if (!target) return false;

  const visited = new Set();
  const queue = [...target.parents];
  const SAFETY_BOUND = 10000;
  while (queue.length > 0 && visited.size < SAFETY_BOUND) {
    const id = queue.shift();
    if (id === cond.beforeEventId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const event = byId.get(id);
    if (event) queue.push(...event.parents);
  }
  return false;
}

/**
 * Evaluates one condition, recursively composing all/any/not over the
 * six primitives above. Never executes submitted code — every branch
 * here is a fixed, platform-authored check; only the DATA (which
 * primitive, which arguments) comes from the caller.
 *
 * @param {Condition} condition
 * @param {EvaluationContext} context
 * @returns {Promise<boolean>}
 */
export async function evaluateCondition(condition, context) {
  if (!condition || typeof condition !== 'object') return false;

  if (Array.isArray(condition.all)) {
    for (const c of condition.all) {
      if (!(await evaluateCondition(c, context))) return false;
    }
    return true;
  }
  if (Array.isArray(condition.any)) {
    for (const c of condition.any) {
      if (await evaluateCondition(c, context)) return true;
    }
    return false;
  }
  if (condition.not !== undefined) {
    return !(await evaluateCondition(condition.not, context));
  }

  switch (condition.type) {
    case 'ownership': return evalOwnership(condition, context);
    case 'count': return evalCount(condition, context);
    case 'deterministic-match': return evalDeterministicMatch(condition, context);
    case 'unique': return evalUnique(condition, context);
    case 'causal-order': return evalCausalOrder(condition, context);
    case 'signature': return evalSignature(condition, context);
    default: return false; // unknown primitive type — reject, never silently pass
  }
}

/**
 * "this exact message was signed by the holder of domain Y's real
 * key." Generalizes verifyTransferAuthorization (conservation-bridge.js)
 * and verifySubmissionSignature (module-submission.js) — both already
 * real, already independently implemented per file, before this
 * evaluator existed. Kept synchronous-import-free here (dynamic import
 * of the same real, already-audited crypto this project already uses
 * elsewhere) so this file itself has no top-level dependency on
 * @noble/curves, matching the same "core reducer files carry zero
 * external dependencies" discipline the cadence-VDF CI break already
 * taught this project the hard way.
 */
async function evalSignature(cond, ctx) {
  const { ed25519 } = await import('@noble/curves/ed25519');
  const { deriveDomainId } = await import('./identity/domain-id.js');
  const fromHex = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  };
  let valid;
  try {
    valid = ed25519.verify(fromHex(cond.signatureHex), new TextEncoder().encode(cond.message), fromHex(cond.signerPubkeyHex));
  } catch {
    return false;
  }
  if (!valid) return false;
  const derivedId = await deriveDomainId(fromHex(cond.signerPubkeyHex));
  return derivedId === cond.expectedDomain;
}
