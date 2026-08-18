import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { evaluateCondition } from '../public/js/core/causal-condition-evaluator.js';
import { initialConservationState, issueClaim } from '../public/js/core/conservation/conservation.js';
import { deriveDomainId } from '../public/js/core/identity/domain-id.js';

// ── ownership ─────────────────────────────────────────────────────

test('ownership: accepts a real, active claim owned by the expected domain', async () => {
  const conservationState = issueClaim(initialConservationState(), { id: 'c1', kind: 'AIWA', amount: 10, owner: 'alice' });
  const ok = await evaluateCondition({ type: 'ownership', claimId: 'c1', expectedOwner: 'alice' }, { conservationState });
  assert.equal(ok, true);
});

test('ownership: rejects a claim owned by someone else', async () => {
  const conservationState = issueClaim(initialConservationState(), { id: 'c1', kind: 'AIWA', amount: 10, owner: 'alice' });
  const ok = await evaluateCondition({ type: 'ownership', claimId: 'c1', expectedOwner: 'bob' }, { conservationState });
  assert.equal(ok, false);
});

test('ownership: rejects a nonexistent claim without throwing', async () => {
  const conservationState = initialConservationState();
  const ok = await evaluateCondition({ type: 'ownership', claimId: 'nope', expectedOwner: 'alice' }, { conservationState });
  assert.equal(ok, false);
});

test('ownership: rejects when conservationState is entirely absent from context', async () => {
  const ok = await evaluateCondition({ type: 'ownership', claimId: 'c1', expectedOwner: 'alice' }, {});
  assert.equal(ok, false);
});

// ── count ─────────────────────────────────────────────────────────

function makeEvents(payloads) {
  return payloads.map((payload, i) => ({ id: `e${i}`, parents: i === 0 ? [] : [`e${i - 1}`], payload }));
}

test('count: accepts when at least min matching events exist', async () => {
  const orderedEvents = makeEvents([
    { type: 'donate', domain: 'alice' },
    { type: 'donate', domain: 'bob' },
    { type: 'donate', domain: 'carol' },
  ]);
  const ok = await evaluateCondition({ type: 'count', eventType: 'donate', min: 3 }, { orderedEvents });
  assert.equal(ok, true);
});

test('count: rejects when fewer than min matching events exist', async () => {
  const orderedEvents = makeEvents([{ type: 'donate', domain: 'alice' }]);
  const ok = await evaluateCondition({ type: 'count', eventType: 'donate', min: 3 }, { orderedEvents });
  assert.equal(ok, false);
});

test('count: domain filter narrows the match', async () => {
  const orderedEvents = makeEvents([
    { type: 'donate', domain: 'alice' },
    { type: 'donate', domain: 'bob' },
  ]);
  const okAlice = await evaluateCondition({ type: 'count', eventType: 'donate', domain: 'alice', min: 1 }, { orderedEvents });
  const okAliceTwo = await evaluateCondition({ type: 'count', eventType: 'donate', domain: 'alice', min: 2 }, { orderedEvents });
  assert.equal(okAlice, true);
  assert.equal(okAliceTwo, false);
});

test('count: flat field filter is exact-equality-only, all keys must match', async () => {
  const orderedEvents = makeEvents([
    { type: 'bid', amount: 100, currency: 'AIWA' },
    { type: 'bid', amount: 200, currency: 'AIWA' },
  ]);
  const ok = await evaluateCondition({ type: 'count', eventType: 'bid', filter: { amount: 100, currency: 'AIWA' }, min: 1 }, { orderedEvents });
  const okWrong = await evaluateCondition({ type: 'count', eventType: 'bid', filter: { amount: 999 }, min: 1 }, { orderedEvents });
  assert.equal(ok, true);
  assert.equal(okWrong, false);
});

test('count: rejects when orderedEvents is entirely absent from context', async () => {
  const ok = await evaluateCondition({ type: 'count', eventType: 'donate', min: 1 }, {});
  assert.equal(ok, false);
});

// ── deterministic-match ──────────────────────────────────────────

test('deterministic-match: accepts when recomputing the named function matches the expected output', async () => {
  const functionRegistry = { double: (x) => x * 2 };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'double', args: [21], expectedOutput: 42 }, { functionRegistry });
  assert.equal(ok, true);
});

test('deterministic-match: rejects a mismatched output', async () => {
  const functionRegistry = { double: (x) => x * 2 };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'double', args: [21], expectedOutput: 999 }, { functionRegistry });
  assert.equal(ok, false);
});

test('deterministic-match: outputPath extracts one field of a structured result', async () => {
  const functionRegistry = { draw: () => ({ winnerDomain: 'alice', totalAmount: 25 }) };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'draw', args: [], outputPath: 'winnerDomain', expectedOutput: 'alice' }, { functionRegistry });
  const okWrong = await evaluateCondition({ type: 'deterministic-match', function: 'draw', args: [], outputPath: 'winnerDomain', expectedOutput: 'bob' }, { functionRegistry });
  assert.equal(ok, true);
  assert.equal(okWrong, false);
});

test('deterministic-match: works with a real async function, not only synchronous ones', async () => {
  const functionRegistry = { asyncDouble: async (x) => x * 2 };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'asyncDouble', args: [10], expectedOutput: 20 }, { functionRegistry });
  assert.equal(ok, true);
});

test('deterministic-match: an unregistered function name is rejected, not a crash', async () => {
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'nonexistent', args: [], expectedOutput: 1 }, { functionRegistry: {} });
  assert.equal(ok, false);
});

test('deterministic-match: a throwing recomputation is a rejection, not an unhandled crash', async () => {
  const functionRegistry = { boom: () => { throw new Error('nope'); } };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'boom', args: [], expectedOutput: 1 }, { functionRegistry });
  assert.equal(ok, false);
});

test('deterministic-match: deep structural equality, not reference equality, for object outputs', async () => {
  const functionRegistry = { stats: () => ({ wins: 3, losses: 1 }) };
  const ok = await evaluateCondition({ type: 'deterministic-match', function: 'stats', args: [], expectedOutput: { wins: 3, losses: 1 } }, { functionRegistry });
  assert.equal(ok, true);
});

// ── unique ────────────────────────────────────────────────────────

test('unique: accepts a key not present in usedKeys', async () => {
  const ok = await evaluateCondition({ type: 'unique', key: 'formula-x' }, { usedKeys: new Set(['formula-y']) });
  assert.equal(ok, true);
});

test('unique: rejects a key already present in usedKeys', async () => {
  const ok = await evaluateCondition({ type: 'unique', key: 'formula-x' }, { usedKeys: new Set(['formula-x']) });
  assert.equal(ok, false);
});

test('unique: an absent usedKeys context treats every key as unique — the evaluator never mutates state itself', async () => {
  const ok = await evaluateCondition({ type: 'unique', key: 'anything' }, {});
  assert.equal(ok, true);
});

// ── causal-order ──────────────────────────────────────────────────

test('causal-order: accepts when beforeEventId is a real ancestor of afterEventId', async () => {
  const orderedEvents = [
    { id: 'a', parents: [], payload: {} },
    { id: 'b', parents: ['a'], payload: {} },
    { id: 'c', parents: ['b'], payload: {} },
  ];
  const ok = await evaluateCondition({ type: 'causal-order', beforeEventId: 'a', afterEventId: 'c' }, { orderedEvents });
  assert.equal(ok, true);
});

test('causal-order: rejects when beforeEventId is NOT an ancestor', async () => {
  const orderedEvents = [
    { id: 'a', parents: [], payload: {} },
    { id: 'b', parents: [], payload: {} }, // independent, not a descendant of a
  ];
  const ok = await evaluateCondition({ type: 'causal-order', beforeEventId: 'a', afterEventId: 'b' }, { orderedEvents });
  assert.equal(ok, false);
});

test('causal-order: rejects when afterEventId does not exist', async () => {
  const orderedEvents = [{ id: 'a', parents: [], payload: {} }];
  const ok = await evaluateCondition({ type: 'causal-order', beforeEventId: 'a', afterEventId: 'nonexistent' }, { orderedEvents });
  assert.equal(ok, false);
});

test('causal-order: works through a multi-parent (merged) DAG shape', async () => {
  const orderedEvents = [
    { id: 'a', parents: [], payload: {} },
    { id: 'b', parents: [], payload: {} },
    { id: 'merge', parents: ['a', 'b'], payload: {} },
  ];
  const okA = await evaluateCondition({ type: 'causal-order', beforeEventId: 'a', afterEventId: 'merge' }, { orderedEvents });
  const okB = await evaluateCondition({ type: 'causal-order', beforeEventId: 'b', afterEventId: 'merge' }, { orderedEvents });
  assert.equal(okA, true);
  assert.equal(okB, true);
});

// ── signature ─────────────────────────────────────────────────────

function toHex(bytes) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''); }

test('signature: accepts a real, valid signature matching the expected domain', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const pubkey = ed25519.getPublicKey(seed);
  const message = 'hello';
  const signature = ed25519.sign(new TextEncoder().encode(message), seed);
  const expectedDomain = await deriveDomainId(pubkey);

  const ok = await evaluateCondition({ type: 'signature', message, signerPubkeyHex: toHex(pubkey), signatureHex: toHex(signature), expectedDomain }, {});
  assert.equal(ok, true);
});

test('SECURITY signature: rejects a signature over a DIFFERENT message than claimed', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const pubkey = ed25519.getPublicKey(seed);
  const signature = ed25519.sign(new TextEncoder().encode('real message'), seed);
  const expectedDomain = await deriveDomainId(pubkey);

  const ok = await evaluateCondition({ type: 'signature', message: 'forged message', signerPubkeyHex: toHex(pubkey), signatureHex: toHex(signature), expectedDomain }, {});
  assert.equal(ok, false);
});

test('SECURITY signature: rejects when the pubkey does not derive to the claimed expectedDomain', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const pubkey = ed25519.getPublicKey(seed);
  const message = 'hello';
  const signature = ed25519.sign(new TextEncoder().encode(message), seed);

  const ok = await evaluateCondition({ type: 'signature', message, signerPubkeyHex: toHex(pubkey), signatureHex: toHex(signature), expectedDomain: 'not-the-real-derived-domain' }, {});
  assert.equal(ok, false);
});

// ── composition: all / any / not ─────────────────────────────────

test('all: accepted only when every sub-condition is accepted', async () => {
  const okBoth = await evaluateCondition({ all: [{ type: 'unique', key: 'a' }, { type: 'unique', key: 'b' }] }, { usedKeys: new Set() });
  const okOneFails = await evaluateCondition({ all: [{ type: 'unique', key: 'a' }, { type: 'unique', key: 'b' }] }, { usedKeys: new Set(['b']) });
  assert.equal(okBoth, true);
  assert.equal(okOneFails, false);
});

test('any: accepted when at least one sub-condition is accepted', async () => {
  const ok = await evaluateCondition({ any: [{ type: 'unique', key: 'a' }, { type: 'unique', key: 'b' }] }, { usedKeys: new Set(['a']) });
  const okNone = await evaluateCondition({ any: [{ type: 'unique', key: 'a' }, { type: 'unique', key: 'b' }] }, { usedKeys: new Set(['a', 'b']) });
  assert.equal(ok, true);
  assert.equal(okNone, false);
});

test('not: inverts the inner condition', async () => {
  const ok = await evaluateCondition({ not: { type: 'unique', key: 'a' } }, { usedKeys: new Set(['a']) });
  assert.equal(ok, true);
});

test('nested composition: a real, multi-level all/any/not tree evaluates correctly', async () => {
  const usedKeys = new Set(['taken']);
  const condition = {
    all: [
      { any: [{ type: 'unique', key: 'taken' }, { type: 'unique', key: 'free' }] }, // true (free is unique)
      { not: { type: 'unique', key: 'taken' } }, // true (taken is NOT unique, so not(false)=true... wait taken IS used, unique('taken')=false, not(false)=true)
    ],
  };
  const ok = await evaluateCondition(condition, { usedKeys });
  assert.equal(ok, true);
});

// ── malformed input handling ──────────────────────────────────────

test('malformed conditions are rejected without throwing', async () => {
  assert.equal(await evaluateCondition(null, {}), false);
  assert.equal(await evaluateCondition(undefined, {}), false);
  assert.equal(await evaluateCondition({}, {}), false);
  assert.equal(await evaluateCondition({ type: 'nonexistent-primitive' }, {}), false);
  assert.equal(await evaluateCondition('not-an-object', {}), false);
});
