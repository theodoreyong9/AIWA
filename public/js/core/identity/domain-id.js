// domain-id.js — the domain identity derivation, extracted into its own
// module so both the app (main.js) and anything that needs to VERIFY a
// claimed domain id against a public key (conservation-bridge.js, for
// real transfer-signature checking) use the exact same function. Having
// two independent copies of this — one to derive, one to verify against
// — is exactly the kind of drift that causes silent security bugs; this
// file exists so there is only one.

/**
 * A domain's id: SHA-256 of its wallet's public key, hex-encoded. Full
 * 64 hex characters (256 bits) — NOT truncated. An earlier revision
 * truncated this to 12 hex characters (48 bits) for a shorter display
 * string; that was a real weakness once domain ids became something an
 * attacker could be motivated to find a colliding preimage for (once
 * transfer signatures started binding a signature to "this pubkey
 * hashes to this domain id" — see conservation-bridge.js). 48 bits is
 * within reach of a well-resourced brute-force search; 256 bits is not.
 * Display code that wants a short label may still slice this string for
 * SHOWING it — it must never slice it before using it as the actual
 * identifier a security check depends on.
 *
 * @param {Uint8Array} publicKeyBytes
 * @returns {Promise<string>}
 */
export async function deriveDomainId(publicKeyBytes) {
  const digest = await crypto.subtle.digest('SHA-256', publicKeyBytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short label for UI display only — never use this as an identifier in a security check. */
export function shortDomainLabel(domainId) {
  return domainId.slice(0, 12);
}
