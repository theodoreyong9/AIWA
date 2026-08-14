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

import { ed25519 } from '@noble/curves/ed25519';
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
 * @param {Omit<SubmissionEvent, 'nonce'|'timestamp'|'signerPubkey'|'signature'>} fields
 * @param {Uint8Array} signerSeed
 * @param {Uint8Array} signerPubkeyBytes
 * @param {{ now?: number, nonce?: string }} [opts]
 * @returns {SubmissionEvent}
 */
export function buildSubmissionEvent(fields, signerSeed, signerPubkeyBytes, { now = Date.now(), nonce } = {}) {
  const withMeta = { ...fields, nonce: nonce ?? crypto.randomUUID(), timestamp: now };
  const message = new TextEncoder().encode(canonicalSubmissionMessage(withMeta));
  const signature = ed25519.sign(message, signerSeed);
  return { ...withMeta, signerPubkey: toHex(signerPubkeyBytes), signature: toHex(signature) };
}

/**
 * Pure signature check — no network. Mirror of validate.js's
 * verifySignature() step, adapted to Ed25519/@noble/curves.
 * @param {SubmissionEvent} event
 * @returns {boolean}
 */
export function verifySubmissionSignature(event) {
  const message = new TextEncoder().encode(canonicalSubmissionMessage(event));
  try {
    return ed25519.verify(fromHex(event.signature), message, fromHex(event.signerPubkey));
  } catch {
    return false;
  }
}

export function initialSubmissionState() {
  return { usedNonces: {} };
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
  if (!verifySubmissionSignature(event)) {
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
  return { usedNonces: { ...submissionState.usedNonces, [nonce]: true } };
}

/**
 * The full pure pipeline: validate the submission against the actual
 * fetched code, then register (new module id) or update (existing id)
 * in the module registry, then record the nonce — all or nothing. Still
 * takes `code` pre-fetched, so this stays network-free and fully
 * testable; the one thin, untestable piece is fetching `code` from
 * `event.codeUrl` in the first place (see module-fetch.js).
 *
 * @param {import('./module-registry.js').ModuleRegistryState} registryState
 * @param {{ usedNonces: Record<string, true> }} submissionState
 * @param {SubmissionEvent} event
 * @param {string} code
 * @param {{ now?: number, registerModuleFn: Function, updateModuleCodeFn: Function }} deps
 *   registerModuleFn/updateModuleCodeFn are injected from
 *   module-registry.js by the caller, avoiding a circular import here.
 */
export async function submitModule(registryState, submissionState, event, code, { now = Date.now(), registerModuleFn, updateModuleCodeFn }) {
  const check = await validateSubmission(submissionState, event, code);
  if (!check.valid) {
    return { registryState, submissionState, accepted: false, reason: check.reason };
  }

  const alreadyRegistered = Boolean(registryState.modules[event.moduleId]);
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

  return {
    registryState: result.state,
    submissionState: recordNonce(submissionState, event.nonce),
    accepted: true,
    isUpdate: alreadyRegistered,
  };
}
