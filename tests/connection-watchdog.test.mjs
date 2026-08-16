import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionWatchdog } from '../public/js/core/transport/connection-watchdog.js';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('never fires before any peer was ever known — no false positive on a fresh, never-connected domain', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  clock.advance(10000); // a long time passes, but no peer was ever known
  w.checkStale();
  assert.equal(staleCount, 0);
});

test('does not fire while activity is recent', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  w.recordActivity();
  clock.advance(500); // well within the timeout
  w.checkStale();
  assert.equal(staleCount, 0);
});

test('fires exactly once when the timeout window elapses with zero activity', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  w.recordActivity();
  clock.advance(1500); // past the timeout
  const firedThisCall = w.checkStale();
  assert.equal(firedThisCall, true);
  assert.equal(staleCount, 1);
});

test('does not fire a second time for the same stale episode — checkStale is idempotent while nothing changes', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  w.recordActivity();
  clock.advance(1500);
  w.checkStale();
  clock.advance(1000); // still stale, more time passes
  const firedAgain = w.checkStale();
  assert.equal(firedAgain, false);
  assert.equal(staleCount, 1, 'onStale must fire once per episode, not repeatedly while still stale');
});

test('fresh activity after a stale episode resets the watchdog — a real reconnect is detected as such', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  w.recordActivity();
  clock.advance(1500);
  w.checkStale();
  assert.equal(staleCount, 1);

  w.recordActivity(); // reconnected
  clock.advance(1500); // goes stale again, independently
  w.checkStale();
  assert.equal(staleCount, 2, 'a second, genuinely independent stale episode must fire again');
});

test('rejects a non-positive timeoutMs at construction, not silently at the first check', () => {
  assert.throws(() => createConnectionWatchdog({ timeoutMs: 0, onStale: () => {} }), /positive finite number/);
  assert.throws(() => createConnectionWatchdog({ timeoutMs: -5, onStale: () => {} }), /positive finite number/);
  assert.throws(() => createConnectionWatchdog({ timeoutMs: NaN, onStale: () => {} }), /positive finite number/);
});

test('activity exactly at the timeout boundary is not yet stale, only once elapsed >= timeoutMs', () => {
  const clock = fakeClock();
  let staleCount = 0;
  const w = createConnectionWatchdog({ timeoutMs: 1000, onStale: () => staleCount++, now: clock.now });

  w.recordActivity();
  clock.advance(999);
  w.checkStale();
  assert.equal(staleCount, 0);

  clock.advance(1); // now exactly at 1000
  w.checkStale();
  assert.equal(staleCount, 1);
});
