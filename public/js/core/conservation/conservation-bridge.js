// conservation-bridge.js — closes a real vulnerability found by the
// user asking one precise question ("le soul correspond à une
// signature AIWA ou une signature Solana? ils sont où?"), which led to
// checking conservation.js's ownership check directly: `claim.owner
// !== from` (line ~93/131) is a plain string comparison — nothing
// verified that whoever wrote a 'transfer' DAG event actually
// controlled the private key behind `from`. Anyone able to add an
// event to H_d could forge a transfer stealing any claim, by simply
// writing the victim's domain id into the `from` field. This file now
// requires and verifies a real Ed25519 signature proving exactly that,
// modeled on the same pattern module-submission.js already uses for
// module submissions — signing is not a new primitive introduced here,
// it's the same one applied to a place that needed it and didn't have
// it.
//
// 'claim-issue' remains unsigned by design, not by oversight: it only
// ever assigns ownership of a new claim to the SAME domain whose
// balance it debits — forging one cannot move value to an attacker, at
// worst it inconveniences the victim's own accounting. 'transfer' is
// the event that actually moves value to someone else, which is
// exactly why it — and only it — requires proof of control.

import { ed25519 } from '@noble/curves/ed25519';
import { initialConservationState, issueClaim, transfer } from './conservation.js';
import { deriveDomainId } from '../identity/domain-id.js';

/**
 * @typedef {{ conservation: import('./conservation.js').ConservationState, usedTransferNonces: Record<string, true> }} ConservationBridgeState
 */

export function initialConservationBridgeState() {
  return { conservation: initialConservationState(), usedTransferNonces: {} };
}

function canonicalTransferMessage({ claimId, from, to, nonce, timestamp }) {
  return JSON.stringify({ claimId, from, to, nonce, timestamp });
}

/**
 * Builds and signs a transfer event — the real counterpart to the
 * forgeable payload the vulnerability allowed. `signerSeed` is the
 * 32-byte Ed25519 seed (a wallet keypair's `secretKey.slice(0, 32)`).
 *
 * @param {{ claimId: string, from: string, to: string }} fields
 * @param {Uint8Array} signerSeed
 * @param {Uint8Array} signerPubkeyBytes
 */
export function buildSignedTransferEvent(fields, signerSeed, signerPubkeyBytes, { now = Date.now(), nonce = crypto.randomUUID() } = {}) {
  const withMeta = { ...fields, nonce, timestamp: now };
  const message = new TextEncoder().encode(canonicalTransferMessage(withMeta));
  const signature = ed25519.sign(message, signerSeed);
  const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { ...withMeta, signerPubkey: toHex(signerPubkeyBytes), signature: toHex(signature) };
}

async function verifyTransferAuthorization(event) {
  const message = new TextEncoder().encode(canonicalTransferMessage(event));
  const fromHex = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  };
  let sigValid;
  try {
    sigValid = ed25519.verify(fromHex(event.signature), message, fromHex(event.signerPubkey));
  } catch {
    return { valid: false, reason: 'malformed signature or pubkey' };
  }
  if (!sigValid) {
    return { valid: false, reason: 'invalid signature — does not match signerPubkey over the transfer fields' };
  }
  const derivedId = await deriveDomainId(fromHex(event.signerPubkey));
  if (derivedId !== event.from) {
    return { valid: false, reason: `signerPubkey does not derive to the claimed 'from' domain (${event.from}) — this is not a proof of control over that domain` };
  }
  return { valid: true };
}

/**
 * @param {ConservationBridgeState} state
 * @param {{ id: string, parents: string[], payload: any }} event
 * @returns {Promise<ConservationBridgeState>}
 */
export async function applyConservationEvent(state, event) {
  const payload = event.payload;
  if (!payload || typeof payload.type !== 'string') return state;

  if (payload.type === 'claim-issue') {
    const { domain, id, kind, amount } = payload;
    if (typeof domain !== 'string' || !domain || typeof id !== 'string' || !id || !Number.isFinite(amount) || amount <= 0) {
      return state;
    }
    try {
      const conservation = issueClaim(state.conservation, { id, kind: kind ?? 'AIWA', amount, owner: domain });
      return { ...state, conservation };
    } catch {
      return state;
    }
  }

  if (payload.type === 'transfer') {
    const { claimId, from, to, nonce, timestamp, signerPubkey, signature } = payload;
    if (
      typeof claimId !== 'string' || !claimId ||
      typeof from !== 'string' || !from ||
      typeof to !== 'string' || !to ||
      typeof nonce !== 'string' || !nonce ||
      typeof signerPubkey !== 'string' || typeof signature !== 'string'
    ) {
      return state; // structurally incomplete — e.g. an old, unsigned-format event — rejected, not a crash
    }
    if (state.usedTransferNonces[nonce]) {
      return state; // replay
    }
    const check = await verifyTransferAuthorization({ claimId, from, to, nonce, timestamp, signerPubkey, signature });
    if (!check.valid) {
      return state;
    }
    try {
      const result = transfer(state.conservation, { claimId, from, to, n: 0, derivation: 'identity' }, { identity: (kind, amount) => ({ kind, amount }) });
      return { conservation: result.state, usedTransferNonces: { ...state.usedTransferNonces, [nonce]: true } };
    } catch {
      return state;
    }
  }

  return state;
}

/**
 * registry(H_d) for Conservation: folds a topologically-ordered event
 * list. Returns the same { conservation, usedTransferNonces } shape
 * applyConservationEvent does — callers that only need the claims
 * (existing code, existing tests) read `.conservation` off the result.
 */
export async function materializeConservation(orderedEvents) {
  let state = initialConservationBridgeState();
  for (const event of orderedEvents) {
    state = await applyConservationEvent(state, event);
  }
  return state;
}
