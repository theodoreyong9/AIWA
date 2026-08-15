// module-hash.js — content-addressed integrity for module code, §27.
//
// The gap this closes, found by inspecting a real prior implementation
// (a permissive registry that re-fetches a *mutable* URL on every
// activation, verified against nothing): a judgment ("this code is
// safe", "this code is red-listed") is only durable if it's a judgment
// about a specific, fixed byte sequence — not about "whatever currently
// lives at this URL". Content-addressing doesn't add any publishing
// friction (the whole point of staying maximally open, per the
// project's stated philosophy) — it only makes an already-published
// judgment tamper-evident going forward, the same way §8.1 already made
// event identity tamper-evident for the ledger.

/**
 * SHA-256 of the module's raw source text, as a lowercase hex string.
 * No canonicalization — this hashes literal source bytes (UTF-8), not
 * a JSON structure, since module code IS the thing being judged, not a
 * data structure describing it.
 *
 * @param {string} code
 * @returns {Promise<string>}
 */
export async function computeModuleHash(code) {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Confirms that `code` is byte-for-byte the content a judgment
 * (audit pass, red-list, or simply "this is the version I registered")
 * was made about. This is the check that must run every time a module
 * is loaded, not only at registration — a module whose author (or
 * anyone controlling its `codeUrl`) swaps the content behind an
 * unchanged URL fails this check on the very next load, rather than
 * silently running the new code under the old judgment.
 *
 * @param {string} code
 * @param {string} expectedHash
 * @returns {Promise<boolean>}
 */
export async function verifyModuleIntegrity(code, expectedHash) {
  const actual = await computeModuleHash(code);
  return actual === expectedHash;
}
