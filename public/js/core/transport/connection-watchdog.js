// connection-watchdog.js — §25's required component: a connection can
// silently go stale (an ICE connection transitioning to disconnected
// without a WebRTC stack attempting restart, especially after a
// network change) without ever firing a peer-leave event. The watchdog
// tracks the timestamp of the last inbound peer-activity event and, if
// a bounded window elapses with zero activity while at least one peer
// was previously known, tears down and reinitializes the transport
// automatically, without requiring a manual reload.
//
// Real, tested logic: time is injected (a `now()` function, defaulting
// to Date.now but replaceable by a test with a fake clock), so
// staleness detection is verified deterministically rather than by
// actually waiting out a real timeout in a test suite.

/**
 * @param {{ timeoutMs: number, onStale: () => void, now?: () => number }} opts
 */
export function createConnectionWatchdog({ timeoutMs, onStale, now = Date.now }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive finite number');
  }
  let lastActivityAt = null; // null until at least one peer has ever been known — no false-positive staleness before any peer existed
  let hasHadPeer = false;
  let staleFired = false; // fires at most once per stale episode — recordActivity() resets this

  return {
    /** Called whenever any inbound peer activity is observed (a message, a heartbeat, a peer-join). */
    recordActivity() {
      lastActivityAt = now();
      hasHadPeer = true;
      staleFired = false; // a fresh activity means any prior staleness episode is over
    },

    /**
     * Call periodically (e.g. from a real setInterval in a live
     * deployment; called directly with a fake clock in tests). Fires
     * onStale exactly once per stale episode, not once per call while
     * still stale, so the caller's teardown/reinit logic doesn't run
     * repeatedly for the same silent failure.
     * @returns {boolean} true if this call detected (newly) stale
     */
    checkStale() {
      if (!hasHadPeer || staleFired) return false;
      const elapsed = now() - lastActivityAt;
      if (elapsed >= timeoutMs) {
        staleFired = true;
        onStale();
        return true;
      }
      return false;
    },

    /** For inspection/testing — not part of the operational contract. */
    _state() {
      return { lastActivityAt, hasHadPeer, staleFired };
    },
  };
}
