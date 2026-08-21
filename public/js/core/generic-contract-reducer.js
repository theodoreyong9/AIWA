// generic-contract-reducer.js — the last mile of the composability
// promise. causal-condition-evaluator.js proved the evaluator works
// (pool-reducer.js's own verifyPoolPayout was rewritten to use it,
// 25 pre-existing tests unchanged), but nothing let a THIRD PARTY
// actually define a new contract this way — every real use so far was
// hand-wired platform code (pool-reducer.js itself). This file closes
// that: a module mints a contract ONCE, declaring its release
// condition as data; anyone can later post a release attempt
// referencing that contract, and this reducer evaluates the
// ALREADY-MINTED, IMMUTABLE condition — never a condition the release
// attempt supplies itself.
//
// The safety argument, stated precisely because it is the one thing
// that must never be gotten wrong here: if a release event could
// supply its OWN condition, any attacker could attach a trivially-true
// one (e.g. {type:'unique', key:'never-used-before'}) and drain any
// contract's funds. Safety comes from separating WHEN a condition can
// be supplied (only at mint time, once, immutable — the exact
// mint-once-forever discipline pool-init and formula-register already
// use) from WHEN it is merely referenced (at release time, by
// contractId only — the release event supplies claimId/from/to, which
// get substituted into the ALREADY-FIXED template's placeholders, and
// nothing else). A release event can never introduce new verification
// logic; it can only ask "does the immutable condition I was minted
// with, evaluated against the real, current state, and with MY OWN
// claimId/from/to plugged in, come out true."
//
// Honest scope boundary: this closes the gap for contracts expressible
// as "release once a declarative condition over already-existing
// events/state holds" — a threshold multisig release, a time-locked
// escrow, a causal-order-gated release. It does NOT replace pool-
// reducer.js's own bespoke reducer: a weighted random draw needs
// STATEFUL accumulation of which contributions belong to which cycle
// before a condition can even be evaluated, which is a fundamentally
// different kind of logic than a stateless condition check over
// already-materialized state. Contracts needing that shape of logic
// still need their own reducer, honestly, not force-fit here.

import { evaluateCondition } from './causal-condition-evaluator.js';

export function initialGenericContractState() {
  return { contracts: {}, rejections: [] };
}

function reject(state, eventId, reason) {
  return { ...state, rejections: [...state.rejections, { eventId, reason }] };
}

/**
 * Walks a Condition tree, replacing the placeholder strings '$claimId',
 * '$from', '$to' — wherever they appear as a plain string value in the
 * template — with the real values from the release attempt being
 * verified. Deliberately narrow: only these three placeholders, only
 * as whole-string matches (no partial substitution, no string
 * templating engine), so this stays a fixed, auditable transformation,
 * not a second place new expressiveness could sneak in.
 */
export function substitutePlaceholders(condition, { claimId, from, to }) {
  const substitute = (value) => {
    if (value === '$claimId') return claimId;
    if (value === '$from') return from;
    if (value === '$to') return to;
    return value;
  };

  if (condition == null || typeof condition !== 'object') return condition;
  if (Array.isArray(condition.all)) return { all: condition.all.map((c) => substitutePlaceholders(c, { claimId, from, to })) };
  if (Array.isArray(condition.any)) return { any: condition.any.map((c) => substitutePlaceholders(c, { claimId, from, to })) };
  if (condition.not !== undefined) return { not: substitutePlaceholders(condition.not, { claimId, from, to }) };

  const result = { ...condition };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') result[key] = substitute(result[key]);
  }
  return result;
}

/**
 * Applies one event. 'generic-contract-init' mints a contract's
 * release condition permanently — the same immutable-once-set
 * discipline pool-init and formula-register already use. No other
 * event type is handled by this reducer; releases themselves are
 * verified by verifyGenericRelease() below, called as an injected
 * conservation-bridge.js pot-release verifier, not folded here.
 */
export function applyGenericContractEvent(state, event) {
  const payload = event.payload;
  if (!payload || payload.type !== 'generic-contract-init') return state;

  const { contractId, condition, mintedBy, at } = payload;
  if (typeof contractId !== 'string' || !contractId) return reject(state, event.id, 'missing contractId');
  if (state.contracts[contractId]) return reject(state, event.id, `contract '${contractId}' already initialized — permanent once minted`);
  if (!condition || typeof condition !== 'object') return reject(state, event.id, 'missing or invalid condition');

  return { ...state, contracts: { ...state.contracts, [contractId]: { condition, mintedBy: mintedBy ?? null, mintedAt: at ?? 0 } } };
}

/** registry(H_d) for generic contracts — mirror of every other materialize* function in this project. */
export function materializeGenericContracts(orderedEvents) {
  return orderedEvents.reduce(applyGenericContractEvent, initialGenericContractState());
}

/**
 * The injected verifier conservation-bridge.js's 'pot-release' event
 * calls — see that file's own header for why this is safe without a
 * signature. Looks up the ALREADY-MINTED, immutable condition for
 * releaseProof.contractId, substitutes the real claimId/from/to into
 * its placeholders, and evaluates it against real, materialized state.
 * A release attempt can never supply its own condition — only which
 * already-minted contract it claims to satisfy.
 *
 * @param {ReturnType<typeof initialGenericContractState>} contractState
 * @param {import('../conservation/conservation.js').ConservationState} conservationState
 * @param {Array<{id: string, parents: string[], payload: any}>} orderedEvents
 * @param {Record<string, (...args: any[]) => any>} functionRegistry
 * @param {string} claimId
 * @param {string} from
 * @param {string} to
 * @param {{ contractId: string }} releaseProof
 *
 * Honest, stated limitation: `usedKeys` is always a fresh, empty set
 * here — this reducer does not itself accumulate a used-keys history
 * across the fold the way pool-reducer.js's own usedContributionClaimIds
 * does. A `unique` primitive referenced inside a generic contract's
 * condition will therefore always evaluate as "unique" (nothing is
 * ever recorded as already-used) within this specific mechanism —
 * contracts genuinely needing mint-once-style uniqueness tracking
 * across many events still need their own dedicated reducer, honestly,
 * the same scope boundary already stated for stateful accumulation
 * (weighted draws) in this file's own header.
 */
export async function verifyGenericRelease(contractState, conservationState, orderedEvents, functionRegistry, claimId, from, to, releaseProof) {
  const contractId = releaseProof?.contractId;
  if (typeof contractId !== 'string' || !contractId) return false;
  const contract = contractState.contracts[contractId];
  if (!contract) return false;

  const condition = substitutePlaceholders(contract.condition, { claimId, from, to });
  return evaluateCondition(condition, { conservationState, orderedEvents, functionRegistry, usedKeys: new Set() });
}
