// cadence-vdf-helper.mjs — shared by every test file that constructs
// cadence events, now that a real VDF proof is mandatory (cadence.js,
// closing R11). A small, genuinely-real iteration count (fast enough
// not to slow the test suite down, but still real, non-faked
// sequential computation) — matching this project's own established
// pattern of using small, hand-verifiable parameters in tests rather
// than unrealistic production-scale values.

import { vdfSeed, computeVdfChain } from '../../public/js/core/economics/cadence-vdf.js';

export const TEST_VDF_ITERATIONS = 50;

/**
 * Builds a real, verifiable cadence event payload. `previousVdfOutput`
 * must be the PRIOR epoch's own real vdfOutput (or omitted/undefined
 * for epoch 1) — matching cadence.js's own chaining requirement that
 * epoch N's proof cannot even begin without epoch N-1's real output.
 *
 * @param {string} domain
 * @param {number} epoch
 * @param {string} [previousVdfOutput]
 * @returns {{ type: 'cadence', domain: string, epoch: number, vdfIterations: number, vdfOutput: string }}
 */
export function cadencePayload(domain, epoch, previousVdfOutput) {
  const seed = vdfSeed(domain, previousVdfOutput ?? 'genesis');
  const vdfOutput = computeVdfChain(seed, TEST_VDF_ITERATIONS);
  return { type: 'cadence', domain, epoch, vdfIterations: TEST_VDF_ITERATIONS, vdfOutput };
}

/**
 * Convenience for the common "advance N epochs in a row" pattern this
 * project's own test files repeat often — returns the ordered list of
 * real cadence payloads, each correctly chained to the real output of
 * the one before it.
 *
 * @param {string} domain
 * @param {number} count
 * @returns {Array<ReturnType<typeof cadencePayload>>}
 */
export function cadencePayloadSequence(domain, count) {
  const payloads = [];
  let previousOutput;
  for (let epoch = 1; epoch <= count; epoch++) {
    const p = cadencePayload(domain, epoch, previousOutput);
    payloads.push(p);
    previousOutput = p.vdfOutput;
  }
  return payloads;
}
