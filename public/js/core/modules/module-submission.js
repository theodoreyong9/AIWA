// module-submission.js — the actual submission pipeline §27's registry
// needed and didn't have: a signed, replay-protected claim binding a
// module id to a specific code hash, checked against the REAL fetched
// bytes before ever registering — not registerModule() trusting a
// caller-supplied hash on faith.
//
// Modeled directly on a real prior implementation the user shared
// (validate.js / merge.js from another of their projects): a
// fork-hosted-code + signed-event + CI-validates + merge pattern. Two
// deliberate departures, both discussed with the user first:
//
//   1. The one precise gap found in that implementation — the content
//      hash is verified once at merge time, then discarded; nothing in
//      the persisted registry lets a later fetch be re-checked — is
//      closed here structurally: verifySubmission() always re-derives
//      the hash from the actual fetched code and registerModule()
//      (module-registry.js) always requires and stores codeHash
//      permanently, not just at submission time.
//   2. Publishing carries NO economic gate here (that implementation
//      requires a rising proof-of-will score to add genuinely new
//      files) — signing is for attribution and integrity only, per the
//      user's explicit instruction to keep submission maximally open.
//      A future economic throttle, if wanted, is a separate, additive
//      layer, not something this pipeline assumes.
//
// Real Ed25519 signing/verification via @noble/curves — the same
// primitive @solana/web3.js itself uses, compatible with a Solana
// keypair's raw key bytes, so the identity-cost wallet
// (solana-wallet.js) CAN be reused to sign a submission, though nothing
// here requires that specific wallet or requires the signer to have a
// registered identity cost at all.

import { computeModuleHash } from './module-hash.js';
import { validateEconomicConfig } from './module-registry.js';

/**
 * @typedef {{
 *   moduleId: string, codeHash: string, codeUrl: string,
 *   name: string, icon: string, category: string, description: string,
 *   isIssuing: boolean, timeSensitive: boolean | null,
 *   economicConfig: import('./module-registry.js').EconomicConfig | null,
 *   nonce: string, timestamp: number,
 *   signerPubkey: string, signature: string,
 * }} SubmissionEvent
 */

/**
 * The exact fields that are signed — deliberately excludes `signature`
 * itself (nothing signs over itself) and is a fixed field order so the
 * same logical event always produces the same signed message,
 * independent of how the caller happened to construct the object.
 */
function canonicalSubmissionMessage(fields) {
  return JSON.stringify({
    moduleId: fields.moduleId,
    codeHash: fields.codeHash,
    codeUrl: fields.codeUrl,
    isIssuing: fields.isIssuing,
    timeSensitive: fields.timeSensitive,
    nonce: fields.nonce,
    timestamp: fields.timestamp,
  });
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Builds and signs a submission event. `signerSeed` is the 32-byte
 * Ed25519 seed (a Solana Keypair's `secretKey.slice(0, 32)` — see
 * solana-wallet.js) — any keypair may sign, not only one with a
 * registered identity cost.
 *
 * SECURITY/AVAILABILITY: @noble/curves/ed25519 is a lazy dynamic
 * import here, not a static top-level one — the same real bug,
 * confirmed via real Playwright/Chromium browser testing, and the same
 * fix, as conservation-bridge.js's buildSignedTransferEvent(); see
 * that function's own doc comment for the full mechanism. A static
 * import graph is linked before any of a module's own top-level code
 * runs, so an unreachable CDN would otherwise hang the whole
 * application before main.js's own startup, including its own
 * main().catch() safety net, ever ran — with zero catchable error.
 * @param {Omit<SubmissionEvent, 'nonce'|'timestamp'|'signerPubkey'|'signature'>} fields
 * @param {Uint8Array} signerSeed
 * @param {Uint8Array} signerPubkeyBytes
 * @param {{ now?: number, nonce?: string }} [opts]
 * @returns {Promise<SubmissionEvent>}
 */
export async function buildSubmissionEvent(fields, signerSeed, signerPubkeyBytes, { now = Date.now(), nonce } = {}) {
  const { ed25519 } = await import('@noble/curves/ed25519');
  const withMeta = { ...fields, nonce: nonce ?? crypto.randomUUID(), timestamp: now };
  const message = new TextEncoder().encode(canonicalSubmissionMessage(withMeta));
  const signature = ed25519.sign(message, signerSeed);
  return { ...withMeta, signerPubkey: toHex(signerPubkeyBytes), signature: toHex(signature) };
}

/**
 * Pure signature check — no network. Mirror of validate.js's
 * verifySignature() step, adapted to Ed25519/@noble/curves.
 * @param {SubmissionEvent} event
 * @returns {Promise<boolean>}
 */
export async function verifySubmissionSignature(event) {
  const { ed25519 } = await import('@noble/curves/ed25519');
  const message = new TextEncoder().encode(canonicalSubmissionMessage(event));
  try {
    return ed25519.verify(fromHex(event.signature), message, fromHex(event.signerPubkey));
  } catch {
    return false;
  }
}

export function initialSubmissionState() {
  return { usedNonces: {}, lastSubmissionByAuthor: {} };
}

/**
 * The full pre-registration check, all pure (no network — `code` is
 * already-fetched text, matching validate.js's own separation between
 * "get the bytes" and "check the bytes"): nonce not replayed, signature
 * valid, fetched code hashes to exactly what the event claims, and (for
 * an issuing module) an internally-consistent economic declaration.
 *
 * @param {{ usedNonces: Record<string, true> }} submissionState
 * @param {SubmissionEvent} event
 * @param {string} code
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateSubmission(submissionState, event, code) {
  if (submissionState.usedNonces[event.nonce]) {
    return { valid: false, reason: `nonce ${event.nonce} already used — replay rejected` };
  }
  if (!(await verifySubmissionSignature(event))) {
    return { valid: false, reason: 'invalid signature — event does not match signerPubkey' };
  }
  const actualHash = await computeModuleHash(code);
  if (actualHash !== event.codeHash) {
    return { valid: false, reason: `content hash mismatch: claimed ${event.codeHash}, fetched code hashes to ${actualHash}` };
  }
  if (event.isIssuing) {
    if (typeof event.timeSensitive !== 'boolean') {
      return { valid: false, reason: 'an issuing module must declare timeSensitive' };
    }
    if (!event.economicConfig) {
      return { valid: false, reason: 'an issuing module must declare economicConfig' };
    }
    const check = validateEconomicConfig(event.economicConfig);
    if (!check.valid) return check;
  }
  return { valid: true };
}

/**
 * Marks a nonce as consumed. Called only after a submission has been
 * fully accepted (validated AND registered) — the same
 * idempotent-set replay-guard pattern used everywhere else in this
 * project (§7's consume(), identity-cost.js's usedSignatures).
 */
export function recordNonce(submissionState, nonce) {
  return { ...submissionState, usedNonces: { ...submissionState.usedNonces, [nonce]: true } };
}

/**
 * The full pure pipeline: validate the submission against the actual
 * fetched code, check eligibility for a genuinely NEW module id
 * (module-rank.js's checkSubmissionEligibility — built and tested since
 * an earlier phase, never actually wired into this pipeline until now),
 * then register or update in the module registry, then record the
 * nonce and the author's fresh rank — all or nothing. Still takes
 * `code` pre-fetched, so this stays network-free and fully testable;
 * the one thin, untestable piece is fetching `code` from
 * `event.codeUrl` in the first place (see module-fetch.js).
 *
 * Eligibility only ever gates a genuinely NEW module id, never an
 * update to one the author already owns — matching module-rank.js's
 * own documented reasoning: an author improving their own existing
 * module should never be throttled by a rank-based gate meant to deter
 * spamming many low-effort new registrations.
 *
 * @param {import('./module-registry.js').ModuleRegistryState} registryState
 * @param {{ usedNonces: Record<string, true>, lastSubmissionByAuthor: Record<string, {rank: number, epochsElapsed: number}> }} submissionState
 * @param {SubmissionEvent} event
 * @param {string} code
 * @param {{
 *   now?: number, registerModuleFn: Function, updateModuleCodeFn: Function,
 *   checkEligibilityFn?: (authorPubkey: string, lastSubmission: {rank: number, epochsElapsed: number} | null) =>
 *     { eligible: boolean, reason?: string, rank: number, epochsElapsed: number }
 * }} deps
 *   registerModuleFn/updateModuleCodeFn are injected from
 *   module-registry.js by the caller, avoiding a circular import here.
 *   checkEligibilityFn is injected the same way from main.js, since
 *   computing rank requires identity-cost state and cadence state this
 *   file has no business importing — if omitted, no eligibility check
 *   is applied (matches every existing caller/test written before this
 *   was wired in).
 */
export async function submitModule(registryState, submissionState, event, code, { now = Date.now(), registerModuleFn, updateModuleCodeFn, checkEligibilityFn }) {
  const check = await validateSubmission(submissionState, event, code);
  if (!check.valid) {
    return { registryState, submissionState, accepted: false, reason: check.reason };
  }

  const alreadyRegistered = Boolean(registryState.modules[event.moduleId]);

  // SECURITY: an update to an EXISTING module id is only ever valid
  // from the same signer who originally registered it — found as a
  // real, exploitable gap, not a hypothetical: neither this function
  // nor updateModuleCode() itself checked this at all, meaning any
  // validly-signed submission could overwrite ANY module's code and
  // codeUrl regardless of who registered it, while the displayed
  // `author` field stayed the original author's — an attacker's code,
  // credited to someone who never touched it. New registration stays
  // exactly as open as before (no author allow-list, §27.4) — this
  // check applies only once a module id already exists.
  if (alreadyRegistered && registryState.modules[event.moduleId].author !== event.signerPubkey) {
    return {
      registryState, submissionState, accepted: false,
      reason: `module '${event.moduleId}' is already registered by a different author — only the original author's signature can update it`,
    };
  }

  let eligibility = null;
  if (!alreadyRegistered && checkEligibilityFn) {
    const lastSubmission = submissionState.lastSubmissionByAuthor[event.signerPubkey] ?? null;
    eligibility = checkEligibilityFn(event.signerPubkey, lastSubmission);
    if (!eligibility.eligible) {
      return { registryState, submissionState, accepted: false, reason: eligibility.reason };
    }
  }

  let result;
  if (alreadyRegistered) {
    result = updateModuleCodeFn(registryState, { id: event.moduleId, codeHash: event.codeHash, codeUrl: event.codeUrl });
  } else {
    result = registerModuleFn(
      registryState,
      {
        id: event.moduleId,
        name: event.name,
        icon: event.icon,
        category: event.category,
        description: event.description,
        codeHash: event.codeHash,
        codeUrl: event.codeUrl,
        author: event.signerPubkey,
        isIssuing: event.isIssuing,
        timeSensitive: event.timeSensitive,
        economicConfig: event.economicConfig,
      },
      { now }
    );
  }

  if (!result.accepted) {
    return { registryState, submissionState, accepted: false, reason: result.reason };
  }

  let newSubmissionState = recordNonce(submissionState, event.nonce);
  if (eligibility) {
    newSubmissionState = {
      ...newSubmissionState,
      lastSubmissionByAuthor: { ...newSubmissionState.lastSubmissionByAuthor, [event.signerPubkey]: { rank: eligibility.rank, epochsElapsed: eligibility.epochsElapsed } },
    };
  }

  return {
    registryState: result.state,
    submissionState: newSubmissionState,
    accepted: true,
    isUpdate: alreadyRegistered,
  };
}
