// transport.js — the interface specified, not an implementation.
// Nothing above this layer (identity, ledger, modules) is permitted to
// depend on which concrete transport is active — this file exists so
// that dependency is checkable, not just claimed in prose.
//
// Five methods: connect(roomId, appId),
// send(peerId, data) with peerId=null meaning broadcast,
// onMessage(callback), onPeerJoin(callback), onPeerLeave(callback).
//
// Two concrete backends are specified in the whitepaper: a same-planet
// low-latency mesh (WebRTC, requiring real signaling infrastructure —
// left an explicit, honestly-unimplemented stub in this pass, since it
// cannot be verified without a real signaling server and real peers,
// neither available in this environment) and a delay-tolerant
// store-and-forward transport for cross-planet reachability
// (delay-tolerant-transport.js — real, tested logic, since queueing and
// flushing don't require an actual network to verify).

/**
 * @typedef {{
 *   connect: (roomId: string, appId: string) => Promise<void>,
 *   send: (peerId: string | null, data: any) => Promise<boolean>,
 *   onMessage: (callback: (peerId: string, data: any) => void) => void,
 *   onPeerJoin: (callback: (peerId: string) => void) => void,
 *   onPeerLeave: (callback: (peerId: string) => void) => void,
 * }} Transport
 */

const REQUIRED_METHODS = ['connect', 'send', 'onMessage', 'onPeerJoin', 'onPeerLeave'];

/**
 * Structural check that an object actually satisfies the Transport
 * contract — used at the point a concrete backend is plugged in, so a
 * malformed or partial implementation fails loudly at wiring time
 * rather than with a confusing "not a function" error deep inside the
 * ledger layer the first time it happens to call a missing method.
 *
 * @param {any} candidate
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function assertImplementsTransport(candidate) {
  const missing = REQUIRED_METHODS.filter((m) => typeof candidate?.[m] !== 'function');
  return { valid: missing.length === 0, missing };
}

/**
 * A transport that has not been connected to any concrete backend yet
 * — every call throws clearly, rather than silently doing nothing or
 * failing with a cryptic TypeError, so "I forgot to plug in a real
 * transport" is diagnosable immediately.
 * @returns {Transport}
 */
export function createUnconnectedTransport() {
  const message = (method) => `Transport.${method}() called before a concrete backend was connected — see transport.js`;
  const failAsync = (method) => async () => {
    throw new Error(message(method));
  };
  const failSync = (method) => () => {
    throw new Error(message(method));
  };
  return {
    connect: failAsync('connect'),
    send: failAsync('send'),
    onMessage: failSync('onMessage'),
    onPeerJoin: failSync('onPeerJoin'),
    onPeerLeave: failSync('onPeerLeave'),
  };
}
