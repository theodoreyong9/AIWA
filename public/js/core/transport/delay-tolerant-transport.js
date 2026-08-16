// delay-tolerant-transport.js — §25's second specified backend: for
// cross-planet reachability, messages queue locally and flush on the
// next available contact window, following the general shape of the
// Bundle Protocol lineage (RFC 9171 and successors) without requiring
// a specific implementation of it.
//
// Unlike the WebRTC mesh backend (transport.js's header explains why
// that one is left an honest stub in this pass), the actual QUEUEING
// and FLUSHING logic here doesn't require a real network to verify —
// only the underlying "did this message actually leave the machine"
// step does, and that step is injected as `sendFn`, exactly the same
// boundary-of-testability pattern already used throughout this project
// (solana-rpc.js, module-loader.js): the untestable network primitive
// is a thin, injected seam; the logic built on top of it is real and
// fully tested.

/**
 * @param {(peerId: string | null, data: any) => Promise<boolean>} sendFn
 *   The actual network send — returns true on success, false (or a
 *   rejected promise) on failure. In a real deployment this would be a
 *   WebRTC data-channel send, or any other real transport primitive;
 *   here it's injected so the queueing/flushing logic can be tested
 *   without one.
 */
export function createDelayTolerantTransport(sendFn) {
  /** @type {Map<string, Array<{ id: string, data: any }>>} */
  const queues = new Map(); // peerId -> FIFO queue, insertion order preserved
  /** @type {Array<{ id: string, data: any }>} */
  const broadcastQueue = [];
  let nextMessageId = 0;
  const messageListeners = [];
  const peerJoinListeners = [];
  const peerLeaveListeners = [];
  const knownPeers = new Set();

  function enqueue(peerId, data) {
    const entry = { id: `m${nextMessageId++}`, data };
    if (peerId === null) {
      broadcastQueue.push(entry);
    } else {
      if (!queues.has(peerId)) queues.set(peerId, []);
      queues.get(peerId).push(entry);
    }
    return entry.id;
  }

  /**
   * Attempts to send `entry` for `peerId` (or `null` for broadcast) via
   * the injected sendFn. Returns true if it was actually sent (and
   * should be removed from the queue), false if it should stay queued
   * for the next contact window.
   */
  async function attemptSend(peerId, entry) {
    try {
      return Boolean(await sendFn(peerId, entry.data));
    } catch {
      return false; // network still down — stays queued, not an error the caller needs to handle
    }
  }

  /**
   * Send is queue-then-attempt, not attempt-then-maybe-queue: a message
   * is durable in the queue the instant this call returns, before any
   * network attempt happens, so a crash between enqueueing and sending
   * never loses it silently — the next flush() (or contact window)
   * picks it up.
   *
   * @returns {Promise<boolean>} true if sent immediately, false if it
   *   remains queued for a later flush — both are success from the
   *   caller's point of view: the message is durably queued either way.
   */
  async function send(peerId, data) {
    const id = enqueue(peerId, data);
    const entry = { id, data };
    const delivered = await attemptSend(peerId, entry);
    if (delivered) {
      removeFromQueue(peerId, id);
    }
    return delivered;
  }

  function removeFromQueue(peerId, id) {
    const queue = peerId === null ? broadcastQueue : queues.get(peerId);
    if (!queue) return;
    const idx = queue.findIndex((e) => e.id === id);
    if (idx !== -1) queue.splice(idx, 1);
  }

  /**
   * Attempts to flush every currently-queued message, in FIFO order
   * per peer, stopping at the first failure for a given peer (so a
   * later message never overtakes an earlier one still stuck — real
   * store-and-forward semantics, not best-effort reordering). Returns
   * how many messages were actually sent.
   */
  async function flush() {
    let sentCount = 0;

    for (const [peerId, queue] of queues.entries()) {
      while (queue.length > 0) {
        const sent = await attemptSend(peerId, queue[0]);
        if (!sent) break; // stop at first failure — preserve order, don't skip ahead
        queue.shift();
        sentCount++;
      }
    }

    while (broadcastQueue.length > 0) {
      const sent = await attemptSend(null, broadcastQueue[0]);
      if (!sent) break;
      broadcastQueue.shift();
      sentCount++;
    }

    return sentCount;
  }

  function queueDepth(peerId) {
    if (peerId === null) return broadcastQueue.length;
    return queues.get(peerId)?.length ?? 0;
  }

  function totalQueueDepth() {
    let total = broadcastQueue.length;
    for (const q of queues.values()) total += q.length;
    return total;
  }

  return {
    /** Mirror of Transport.connect() — a no-op here; there's no persistent connection to establish, only a sendFn already provided. */
    async connect() {},
    send,
    onMessage(callback) {
      messageListeners.push(callback);
    },
    onPeerJoin(callback) {
      peerJoinListeners.push(callback);
    },
    onPeerLeave(callback) {
      peerLeaveListeners.push(callback);
    },

    // Extensions beyond the base Transport interface, specific to the
    // delay-tolerant semantics §25 requires:
    flush,
    queueDepth,
    totalQueueDepth,

    /** Simulates an inbound message arriving (e.g. from the underlying real transport) — dispatches to registered listeners. */
    _deliverInbound(peerId, data) {
      for (const cb of messageListeners) cb(peerId, data);
    },
    /** Simulates a peer becoming reachable — a real backend would call this when a contact window opens. */
    _notePeerJoin(peerId) {
      if (!knownPeers.has(peerId)) {
        knownPeers.add(peerId);
        for (const cb of peerJoinListeners) cb(peerId);
      }
    },
    _notePeerLeave(peerId) {
      if (knownPeers.has(peerId)) {
        knownPeers.delete(peerId);
        for (const cb of peerLeaveListeners) cb(peerId);
      }
    },
  };
}
