// module-fetch.js — the one network-touching step in the submission
// pipeline: fetching the actual code bytes from event.codeUrl (the
// author's own hosting — a GitHub fork, IPFS, anywhere; this project
// never hosts module code itself, only the registry entry pointing to
// it, matching the pattern in the real prior implementation this was
// modeled on). Untestable in this development sandbox for the same
// reason solana-rpc.js and identity-flow.js are: no outbound network
// access to arbitrary hosting URLs here. Kept as thin as those files so
// the untested surface stays small — the actual accept/reject logic is
// entirely in module-submission.js and is fully tested there.

import { submitModule } from './module-submission.js';
import { registerModule, updateModuleCode } from './module-registry.js';

/**
 * Fetches the code at `event.codeUrl` and runs it through the full
 * submission pipeline. Not exercised in this environment — see this
 * file's header.
 *
 * @param {import('./module-registry.js').ModuleRegistryState} registryState
 * @param {{ usedNonces: Record<string, true> }} submissionState
 * @param {import('./module-submission.js').SubmissionEvent} event
 */
export async function fetchAndSubmitModule(registryState, submissionState, event) {
  const response = await fetch(`${event.codeUrl}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    return { registryState, submissionState, accepted: false, reason: `HTTP ${response.status} fetching ${event.codeUrl}` };
  }
  const code = await response.text();
  return submitModule(registryState, submissionState, event, code, {
    registerModuleFn: registerModule,
    updateModuleCodeFn: updateModuleCode,
  });
}
