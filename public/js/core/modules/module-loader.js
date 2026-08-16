// module-loader.js — the "load to run" counterpart to module-fetch.js's
// "load to submit": fetches a registered module's real code from its
// codeUrl and verifies it against the hash bound at registration
// (module-hash.js) before ever considering it runnable. This is not
// optional or a nice-to-have — it's the same content-addressing
// guarantee module-sandbox.js's mountModule() already enforces
// internally, made explicit at the point where a module is chosen to
// run at all, so a mismatch is caught with a clear message here rather
// than surfacing as mountModule()'s own generic rejection.
//
// Real network call — untestable in this development sandbox for the
// same reason solana-rpc.js and module-fetch.js are (no outbound access
// to arbitrary hosting URLs here). Kept as thin as those files so the
// untested surface stays small; the verification logic itself
// (verifyModuleIntegrity) is already fully tested in module-hash.js.

import { verifyModuleIntegrity } from './module-hash.js';

/**
 * @param {import('./module-registry.js').ModuleEntry} entry
 * @returns {Promise<string>} the verified code, ready to hand to mountModule()
 * @throws if the fetch fails or the fetched bytes don't match entry.codeHash
 */
export async function loadVerifiedModuleCode(entry) {
  const response = await fetch(`${entry.codeUrl}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch '${entry.id}' from ${entry.codeUrl}: HTTP ${response.status}`);
  }
  const code = await response.text();
  const ok = await verifyModuleIntegrity(code, entry.codeHash);
  if (!ok) {
    throw new Error(`'${entry.id}' failed integrity verification — the code fetched from ${entry.codeUrl} does not match its registered hash. Refusing to run it.`);
  }
  return code;
}
