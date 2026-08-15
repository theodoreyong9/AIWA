// lemma1.test.mjs — an executable illustration of Lemma 1 (§11), not
// just its reward-formula sub-parts. The lemma states an identity
// scheme id(·) is safe for G exactly when id(e1) = id(e2) implies
// G({e1}, θ) = G({e2}, θ). This test constructs the exact counterexample
// §11 describes in prose: under cadence-sensitive reward, a weak
// identifier that omits q lets two events with different economic
// meaning collide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reward } from '../public/js/core/economics/reward.js';

// A deliberately weak identifier: H(domain, payload-without-q), exactly
// the "H(domain, payload) sufficient when time-insensitive" case §11
// opens with — reused here where it is NOT sufficient, to make the
// failure concrete rather than asserted in prose.
function weakId(domain, payload) {
  const { q, ...rest } = payload;
  return `${domain}:${JSON.stringify(rest)}`;
}

// r = b * max(1,q) with these params (see reward.test.mjs's header for
// why: beta=0 nullifies qTotal's contribution, C=e-1 makes ln(1+C)=1) —
// cadence-sensitive because alpha=1 makes the numerator depend on q.
const params = { alpha: 1, beta: 0, gamma: 1, C: Math.E - 1, minQ: 1 };

test('Lemma 1 violated: a weak identifier that omits q collides two economically distinct events', () => {
  const eventAtEpoch1 = { domain: 'd1', b: 10, q: 1 };
  const eventAtEpoch5 = { domain: 'd1', b: 10, q: 5 };

  // Same weak id despite different economic epoch.
  assert.equal(weakId('d1', eventAtEpoch1), weakId('d1', eventAtEpoch5));

  // But G (here, the reward the event is worth) is NOT indifferent to
  // which representative survives deduplication — exactly what Lemma 1
  // forbids an identity scheme from doing.
  const rewardAt1 = reward(eventAtEpoch1.b, eventAtEpoch1.q, eventAtEpoch1.q, 0, params);
  const rewardAt5 = reward(eventAtEpoch5.b, eventAtEpoch5.q, eventAtEpoch5.q, 0, params);
  assert.notEqual(rewardAt1, rewardAt5, 'reward must differ for the lemma violation to be real, not vacuous');
});

test('Lemma 1 satisfied: a strong identifier that includes q does not collide them', () => {
  function strongId(domain, payload) {
    return `${domain}:${JSON.stringify(payload)}`; // includes q
  }

  const eventAtEpoch1 = { domain: 'd1', b: 10, q: 1 };
  const eventAtEpoch5 = { domain: 'd1', b: 10, q: 5 };

  assert.notEqual(strongId('d1', eventAtEpoch1), strongId('d1', eventAtEpoch5));
});

test('Lemma 1: a weak identifier IS safe under a time-insensitive reward (alpha = 0)', () => {
  // §11's other half: under a reward that doesn't depend on q at all
  // (alpha = 0 nullifies q's contribution in the real formula's
  // numerator — the structural analogue of the old power-law form's
  // beta = 0), collisions on q do not matter because G is indifferent
  // to q entirely.
  const timeInsensitiveParams = { alpha: 0, beta: 0, gamma: 1, C: Math.E - 1, minQ: 0 };
  const eventAtEpoch1 = { domain: 'd1', b: 10, q: 1 };
  const eventAtEpoch5 = { domain: 'd1', b: 10, q: 5 };

  assert.equal(weakId('d1', eventAtEpoch1), weakId('d1', eventAtEpoch5)); // still collides
  const rewardAt1 = reward(eventAtEpoch1.b, eventAtEpoch1.q, eventAtEpoch1.q, 0, timeInsensitiveParams);
  const rewardAt5 = reward(eventAtEpoch5.b, eventAtEpoch5.q, eventAtEpoch5.q, 0, timeInsensitiveParams);
  assert.equal(rewardAt1, rewardAt5, 'reward must be equal for the weak identifier to actually be safe here');
});
