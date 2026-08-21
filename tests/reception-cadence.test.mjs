import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import {
  initialReceptionCadenceState, applyReceptionCommitEvent, materializeReceptionCadence,
} from '../public/js/core/reception-cadence.js';
import { deriveDomainId } from '../public/js/core/identity/domain-id.js';

function toHex(bytes) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''); }

async function signedCommitEvent(id, seed, domain, epoch, kind, receivedFrom) {
  const sorted = [...receivedFrom].sort((a, b) => (a.sourceDomain + a.eventId).localeCompare(b.sourceDomain + b.eventId));
  const message = new TextEncoder().encode(JSON.stringify({ domain, epoch, kind, receivedFrom: sorted }));
  const signature = ed25519.sign(message, seed);
  const pubkey = ed25519.getPublicKey(seed);
  return { id, payload: { type: 'reception-commit', domain, epoch, kind, receivedFrom, signature: toHex(signature), signerPubkey: toHex(pubkey) } };
}

function fixedLookup(realEvents) {
  // realEvents: { [sourceDomain]: { [eventId]: epoch } }
  return (sourceDomain, eventId) => realEvents[sourceDomain]?.[eventId] ?? null;
}

// ── Structural validation ──────────────────────────────────────────

test('an empty commitment is accepted', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = await signedCommitEvent('e1', seed, domain, 1, 'empty', []);
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({}));
  assert.equal(state.rejections.length, 0);
  assert.equal(state.commitments[domain].length, 1);
});

test("kind='empty' with a non-empty receivedFrom is rejected", async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = { id: 'e1', payload: { type: 'reception-commit', domain, epoch: 1, kind: 'empty', receivedFrom: [{ sourceDomain: 'c', eventId: 'x' }], signature: '00', signerPubkey: '00' } };
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({}));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /empty.*requires an empty/);
});

test("kind='full' with an empty receivedFrom is rejected", async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = { id: 'e1', payload: { type: 'reception-commit', domain, epoch: 1, kind: 'full', receivedFrom: [], signature: '00', signerPubkey: '00' } };
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({}));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /full.*requires a non-empty/);
});

test('a non-positive-integer epoch is rejected', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = await signedCommitEvent('e1', seed, domain, 0, 'empty', []);
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({}));
  assert.equal(state.rejections.length, 1);
});

// ── Signature ─────────────────────────────────────────────────────

test('SECURITY: a commitment with a forged signature is rejected', async () => {
  const realSeed = ed25519.utils.randomPrivateKey();
  const attackerSeed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(realSeed));
  // Attacker signs with their OWN key but claims the victim's domain id.
  const event = await signedCommitEvent('e1', attackerSeed, domain, 1, 'empty', []);
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({}));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /signature/);
});

test('SECURITY: tampering with receivedFrom after signing invalidates the signature', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'real1' }]);
  event.payload.receivedFrom = [{ sourceDomain: 'c', eventId: 'forged1' }]; // tampered after signing
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({ c: { forged1: 1 } }));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /signature/);
});

// ── Real reference resolution (recompute, don't trust) ─────────────

test('a full commitment referencing a real, existing source event is accepted', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'real1' }]);
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({ c: { real1: 5 } }));
  assert.equal(state.rejections.length, 0);
});

test('SECURITY: a full commitment referencing a forged/nonexistent event is rejected', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const event = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'never-really-existed' }]);
  const state = await applyReceptionCommitEvent(initialReceptionCadenceState(), event, fixedLookup({ c: { real1: 5 } }));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /does not correspond to any real event/);
});

// ── Reception monotonicity: the real, new security property ───────

test('SECURITY: reception monotonicity — claiming to have seen an EARLIER state of a source domain than previously claimed is rejected', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  let state = initialReceptionCadenceState();

  const e1 = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'c-at-50' }]);
  state = await applyReceptionCommitEvent(state, e1, fixedLookup({ c: { 'c-at-50': 50, 'c-at-30': 30 } }));
  assert.equal(state.rejections.length, 0);

  // Later, at A's own later epoch, A now claims to have seen only c's EARLIER state — a real inconsistency.
  const e2 = await signedCommitEvent('e2', seed, domain, 2, 'full', [{ sourceDomain: 'c', eventId: 'c-at-30' }]);
  state = await applyReceptionCommitEvent(state, e2, fixedLookup({ c: { 'c-at-50': 50, 'c-at-30': 30 } }));
  assert.equal(state.rejections.length, 1);
  assert.match(state.rejections[0].reason, /monotonicity violated/);
});

test('reception monotonicity: claiming to have seen a LATER or EQUAL state is accepted', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  let state = initialReceptionCadenceState();
  const lookup = fixedLookup({ c: { 'c-at-30': 30, 'c-at-50': 50, 'c-at-50b': 50 } });

  const e1 = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'c-at-30' }]);
  state = await applyReceptionCommitEvent(state, e1, lookup);
  const e2 = await signedCommitEvent('e2', seed, domain, 2, 'full', [{ sourceDomain: 'c', eventId: 'c-at-50' }]);
  state = await applyReceptionCommitEvent(state, e2, lookup);
  const e3 = await signedCommitEvent('e3', seed, domain, 3, 'full', [{ sourceDomain: 'c', eventId: 'c-at-50b' }]); // same epoch, equal is fine
  state = await applyReceptionCommitEvent(state, e3, lookup);

  assert.equal(state.rejections.length, 0);
  assert.equal(state.maxSeenEpoch[domain].c, 50);
});

test('monotonicity is tracked independently per source domain — progress on C does not gate claims about D', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  let state = initialReceptionCadenceState();
  const lookup = fixedLookup({ c: { 'c-at-50': 50 }, d: { 'd-at-5': 5 } });

  const e1 = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'c-at-50' }]);
  state = await applyReceptionCommitEvent(state, e1, lookup);
  const e2 = await signedCommitEvent('e2', seed, domain, 2, 'full', [{ sourceDomain: 'd', eventId: 'd-at-5' }]); // a totally different, unrelated source domain
  state = await applyReceptionCommitEvent(state, e2, lookup);

  assert.equal(state.rejections.length, 0);
});

// ── materializeReceptionCadence: real DAG-style folding ────────────

test('materializeReceptionCadence folds a real sequence and still catches a monotonicity violation', async () => {
  const seed = ed25519.utils.randomPrivateKey();
  const domain = await deriveDomainId(ed25519.getPublicKey(seed));
  const lookup = fixedLookup({ c: { 'c-at-50': 50, 'c-at-10': 10 } });

  const e1 = await signedCommitEvent('e1', seed, domain, 1, 'full', [{ sourceDomain: 'c', eventId: 'c-at-50' }]);
  const e2 = await signedCommitEvent('e2', seed, domain, 2, 'full', [{ sourceDomain: 'c', eventId: 'c-at-10' }]);

  const state = await materializeReceptionCadence([e1, e2], lookup);
  assert.equal(state.rejections.length, 1);
});

// ── End-to-end: the real two-partition, four-domain scenario ──────

test('end-to-end: A honestly reporting real reception from C is accepted; a fabricated too-early claim by A about itself is caught by monotonicity', async () => {
  // Two independent partitions: {A, B} and {C, D}. C produces a real,
  // growing local history entirely independently of A.
  const seedA = ed25519.utils.randomPrivateKey();
  const domainA = await deriveDomainId(ed25519.getPublicKey(seedA));

  // C's own real, independently-produced history (what a real materializeCadence(C) would show).
  const cHistory = { 'c-genesis': 1, 'c-epoch-10': 10, 'c-epoch-25': 25 };
  const lookup = fixedLookup({ c: cHistory });

  let state = initialReceptionCadenceState();

  // First contact: A merges with C's cluster, honestly reports what it has really seen so far.
  const firstContact = await signedCommitEvent('fc', seedA, domainA, 1, 'full', [{ sourceDomain: 'c', eventId: 'c-epoch-10' }]);
  state = await applyReceptionCommitEvent(state, firstContact, lookup);
  assert.equal(state.rejections.length, 0);

  // Later, A honestly reports having reconciled further with C — real progress.
  const laterHonest = await signedCommitEvent('later', seedA, domainA, 2, 'full', [{ sourceDomain: 'c', eventId: 'c-epoch-25' }]);
  state = await applyReceptionCommitEvent(state, laterHonest, lookup);
  assert.equal(state.rejections.length, 0);
  assert.equal(state.maxSeenEpoch[domainA].c, 25);

  // An attempt, still later, to claim A only ever saw C's earliest state — inconsistent with A's own prior real claim.
  const dishonestRewrite = await signedCommitEvent('rewrite', seedA, domainA, 3, 'full', [{ sourceDomain: 'c', eventId: 'c-genesis' }]);
  state = await applyReceptionCommitEvent(state, dishonestRewrite, lookup);
  assert.equal(state.rejections.length, 1, 'A cannot later claim to have seen only an earlier state of C than it already, honestly, claimed to have seen');
});

// ── deriveSourceEpochLookup: real DAG-native epoch derivation ─────

test('deriveSourceEpochLookup returns the real epoch when the target IS a cadence event', async () => {
  const { deriveSourceEpochLookup } = await import('../public/js/core/reception-cadence.js');
  const orderedEvents = [
    { id: 'c1', parents: [], payload: { type: 'cadence', domain: 'c', epoch: 5 } },
  ];
  const lookup = deriveSourceEpochLookup(orderedEvents);
  assert.equal(lookup('c', 'c1'), 5);
});

test('deriveSourceEpochLookup walks ancestors to find the highest real cadence epoch of the claimed domain', async () => {
  const { deriveSourceEpochLookup } = await import('../public/js/core/reception-cadence.js');
  const orderedEvents = [
    { id: 'c1', parents: [], payload: { type: 'cadence', domain: 'c', epoch: 1 } },
    { id: 'c2', parents: ['c1'], payload: { type: 'cadence', domain: 'c', epoch: 2 } },
    { id: 'a1', parents: ['c2'], payload: { type: 'accrual', domain: 'c', b: 10 } }, // not a cadence event itself
  ];
  const lookup = deriveSourceEpochLookup(orderedEvents);
  assert.equal(lookup('c', 'a1'), 2);
});

test('deriveSourceEpochLookup returns null for an event that does not genuinely belong to the claimed domain', async () => {
  const { deriveSourceEpochLookup } = await import('../public/js/core/reception-cadence.js');
  const orderedEvents = [
    { id: 'c1', parents: [], payload: { type: 'cadence', domain: 'real-owner', epoch: 5 } },
  ];
  const lookup = deriveSourceEpochLookup(orderedEvents);
  assert.equal(lookup('attacker-claimed-domain', 'c1'), null);
});

test('deriveSourceEpochLookup returns null for a nonexistent event id', async () => {
  const { deriveSourceEpochLookup } = await import('../public/js/core/reception-cadence.js');
  const lookup = deriveSourceEpochLookup([]);
  assert.equal(lookup('c', 'never-existed'), null);
});

test('deriveSourceEpochLookup returns null when no real cadence event of that domain exists among ancestors', async () => {
  const { deriveSourceEpochLookup } = await import('../public/js/core/reception-cadence.js');
  const orderedEvents = [
    { id: 'g1', parents: [], payload: { type: 'genesis', domain: 'c' } },
    { id: 'a1', parents: ['g1'], payload: { type: 'accrual', domain: 'c', b: 10 } },
  ];
  const lookup = deriveSourceEpochLookup(orderedEvents);
  assert.equal(lookup('c', 'a1'), null);
});
