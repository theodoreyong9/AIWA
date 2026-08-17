// module-sandbox.js — the actual runtime isolation boundary, §27.
//
// This is what the security critique (discussed with the user, see
// README.md's Modules section for the full writeup) identified as
// missing from the reference pattern: a module previously ran via
// `<script src="blob:...">`, same-origin, full access to `window`,
// `localStorage`, `fetch` — sandbox rules that existed only as
// documentation, never enforced. This file replaces that with a real
// boundary: `<iframe sandbox="allow-scripts">` — deliberately WITHOUT
// `allow-same-origin`, which is what makes the iframe's origin opaque
// and its storage (localStorage, cookies, IndexedDB) completely
// inaccessible to and from the host page, not merely inconvenient to
// reach. The module's code never touches `window` (the host's), never
// touches `document` (the host's), and cannot read anything the host
// didn't explicitly hand it through the ctx bridge below.
//
// This is deliberately invisible to a module author: from inside the
// iframe, `ctx.storage.get/set`, `ctx.toast`, etc. look and behave
// exactly like the ctx object described in the project's module
// contract — the isolation is a property of where the code runs, not
// something the module has to opt into or code around. Publishing
// stays exactly as open and frictionless as before; only execution is
// now actually contained.
//
// Untestable in this development sandbox for the same reason
// solana-rpc.js is: it requires a real DOM (iframe, postMessage) that
// doesn't exist under `node --test`. The message-passing protocol
// itself (the shape of ctx calls and responses) is plain data and
// could be tested with a DOM-simulating environment (jsdom) in a
// future pass; this file has not been exercised that way yet — treat
// it as unverified until it's run in a real browser.
//
// theme-tokens.js's ThemeTokens (§27.5, "presentation independence") is
// injected here — see buildSandboxHtml()'s own note on how.

import { DEFAULT_THEME, themeToCssVariables } from '../presentation/theme-tokens.js';

/**
 * Builds the sandboxed iframe's document: the module's verified code,
 * plus a minimal in-iframe `ctx` shim that forwards every call to the
 * host via postMessage and resolves/rejects based on the host's
 * response. The module never sees `window.parent`, never sees the
 * host's real `window` — only this shim.
 *
 * `theme` (theme-tokens.js) is injected two ways, since a module might
 * render via its own CSS (reads the `--aiwa-*` custom properties this
 * function writes into `:root`) or entirely via JS (reads `ctx.theme`
 * directly, the same token values as plain data). Neither is
 * mandatory — a module that ignores both still runs; it simply isn't
 * presentation-independent, which is an opt-in property per module,
 * not something this project can enforce on code it doesn't control.
 */
export function buildSandboxHtml(moduleCode, moduleId, themeCss, themeTokens, myDomainId) {
  const escapedId = JSON.stringify(moduleId);
  const escapedTheme = JSON.stringify(themeTokens);
  const escapedDomainId = JSON.stringify(myDomainId ?? null);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${themeCss}</style></head><body><script>
(function () {
  'use strict';
  var MODULE_ID = ${escapedId};
  var pending = new Map();
  var nextCallId = 0;
  var peerMessageListeners = [];

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.channel === 'aiwa-ctx-response') {
      var resolver = pending.get(msg.callId);
      if (!resolver) return;
      pending.delete(msg.callId);
      if (msg.error) resolver.reject(new Error(msg.error));
      else resolver.resolve(msg.result);
      return;
    }
    // Inbound: a message the host is pushing IN, not a response to a
    // call this module made — the host initiates this (a peer sent
    // something targeting this module's id via the real transport,
    // §25), it is never something the module itself requests.
    if (msg.channel === 'aiwa-peer-message') {
      for (var i = 0; i < peerMessageListeners.length; i++) peerMessageListeners[i](msg.peerId, msg.data);
    }
  });

  function callHost(method, args) {
    var callId = 'c' + (nextCallId++);
    return new Promise(function (resolve, reject) {
      pending.set(callId, { resolve: resolve, reject: reject });
      window.parent.postMessage({ channel: 'aiwa-ctx-call', moduleId: MODULE_ID, callId: callId, method: method, args: args }, '*');
    });
  }

  window.ctx = {
    storage: {
      get: function (key) { return callHost('storage.get', [key]); },
      set: function (key, value) { return callHost('storage.set', [key, value]); },
    },
    toast: function (message, kind) { return callHost('toast', [message, kind]); },
    commit: function (amount) { return callHost('commit', [amount]); },
    claim: function () { return callHost('claim', []); },
    theme: ${escapedTheme},
    // This domain's own real id, read-only, injected once at mount —
    // needed by basically any contract module to construct events
    // referencing "myself" (a donorDomain, a bid, a vote). Exposing it
    // grants no new capability beyond what every other ctx call already
    // implies (the host already knows and enforces this identity on
    // every postCausalEvent/transferClaim call) — this just lets a
    // module read the same value back rather than guess it.
    myDomainId: ${escapedDomainId},
    // Real-time, peer-addressed — routed through the real transport
    // (§25) to the SAME module id running on the target domain, if it
    // is currently mounted there. Not durable, not part of H_d — this
    // is interaction, not a ledger fact.
    sendToPeer: function (peerId, data) { return callHost('sendToPeer', [peerId, data]); },
    onPeerMessage: function (callback) { peerMessageListeners.push(callback); },
    // The one Conservation primitive that genuinely cannot be generic:
    // a real, signed transfer requires the domain's real keypair, which
    // this sandbox never holds and never will — the host signs, after
    // the module only ever REQUESTS. Nothing about which claim moves
    // where is decided by ctx; conservation-bridge.js's own signature
    // check is what actually authorizes it (§7, Appendix H.18).
    transferClaim: function (claimId, toDomainId) { return callHost('transferClaim', [claimId, toDomainId]); },
    // General-purpose: posts ANY event type to this domain's own H_d.
    // Deliberately the ONLY primitive a genuinely new kind of causal
    // contract (a future auction, an escrow, a vote — anything beyond
    // what this project has built so far) should ever need, so that
    // adding one never means touching this file, the actual security
    // boundary, again. This is safe for the same reason every other
    // event in this whole architecture already is: posting an event is
    // never itself an authorization — the RECEIVING reducer (a new
    // one, written for whatever contract this is) is what decides
    // whether to accept it, exactly like conservation-bridge.js already
    // does for 'transfer' and jackpot-reducer.js already does for
    // 'jackpot-donate'. The one rule that makes this safe regardless of
    // what a module puts in \`payload\`: the host ALWAYS overwrites
    // \`domain\` and \`postedBy\` with this domain's real, actual id
    // before the event is ever posted — a module can request anything
    // it likes, but can never claim to BE a different domain while
    // doing it. A reducer that grants privilege based on any OTHER
    // self-declared field (an amount, a claim id, a vote choice) is
    // responsible for verifying that field itself, the same discipline
    // every reducer in this project already follows.
    postCausalEvent: function (type, payload) { return callHost('postCausalEvent', [type, payload]); },
    // The read-side counterpart: asks the host to compute and return a
    // named, already-materialized view (e.g. 'jackpot', 'myBalance',
    // 'publicProfile') — read-only, so this is safe to make broad in
    // the same spirit as postCausalEvent, without needing a bespoke
    // ctx method per future view either. Which view names exist is the
    // host's own registry (main.js), extendable there without ever
    // touching this file — an unknown name simply resolves to null.
    queryCausalState: function (viewName, params) { return callHost('queryCausalState', [viewName, params]); },
  };

  try {
    ${moduleCode}
  } catch (err) {
    window.parent.postMessage({ channel: 'aiwa-sandbox-error', moduleId: MODULE_ID, error: String(err && err.message || err) }, '*');
  }
})();
</script></body></html>`;
}

/**
 * Loads and mounts a module inside a real sandboxed iframe, after
 * verifying its content hash (module-hash.js) — a module whose fetched
 * code doesn't match its registered hash is never mounted at all, full
 * stop, not mounted-with-a-warning.
 *
 * @param {HTMLElement} container
 * @param {import('./module-registry.js').ModuleEntry} entry
 * @param {(code: string) => Promise<boolean>} verifyFn — injected for
 *   testability of the call shape; defaults to the real
 *   verifyModuleIntegrity from module-hash.js in production use.
 * @param {import('../presentation/theme-tokens.js').ThemeTokens} theme —
 *   defaults to theme-tokens.js's DEFAULT_THEME if omitted, so existing
 *   callers that predate presentation independence keep working
 *   unchanged.
 * @param {{
 *   onStorageGet: (moduleId: string, key: string) => Promise<string|null>,
 *   onStorageSet: (moduleId: string, key: string, value: string) => Promise<void>,
 *   onToast: (moduleId: string, message: string, kind: string) => void,
 *   onCommit: (moduleId: string, amount: number) => Promise<void>,
 *   onClaim: (moduleId: string) => Promise<number>,
 *   onSendToPeer: (moduleId: string, peerId: string, data: any) => Promise<boolean>,
 *   onTransferClaim: (moduleId: string, claimId: string, toDomainId: string) => Promise<boolean>,
 *   onPostCausalEvent: (moduleId: string, type: string, payload: any) => Promise<any>,
 *   onQueryCausalState: (moduleId: string, viewName: string, params: any) => Promise<any>,
 * }} hostHandlers
 */
export async function mountModule(container, entry, code, verifyFn, hostHandlers, theme = DEFAULT_THEME, myDomainId = null) {
  const ok = await verifyFn(code, entry.codeHash);
  if (!ok) {
    throw new Error(`Module '${entry.id}' failed integrity verification — fetched code does not match its registered hash. Refusing to mount.`);
  }

  const iframe = document.createElement('iframe');
  // No allow-same-origin: this is the actual isolation. Adding it back
  // to "fix" a same-origin-looking bug is exactly the kind of change
  // that silently removes the sandbox — don't.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'width:100%;height:100%;border:0';
  iframe.srcdoc = buildSandboxHtml(code, entry.id, themeToCssVariables(theme), theme, myDomainId);

  const onMessage = async (event) => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg) return;

    if (msg.channel === 'aiwa-sandbox-error') {
      console.error(`[module:${entry.id}] error:`, msg.error);
      return;
    }
    if (msg.channel !== 'aiwa-ctx-call' || msg.moduleId !== entry.id) return;

    let result, error;
    try {
      if (msg.method === 'storage.get') result = await hostHandlers.onStorageGet(entry.id, msg.args[0]);
      else if (msg.method === 'storage.set') result = await hostHandlers.onStorageSet(entry.id, msg.args[0], msg.args[1]);
      else if (msg.method === 'toast') result = hostHandlers.onToast(entry.id, msg.args[0], msg.args[1]);
      else if (msg.method === 'commit') result = await hostHandlers.onCommit(entry.id, msg.args[0]);
      else if (msg.method === 'claim') result = await hostHandlers.onClaim(entry.id);
      else if (msg.method === 'sendToPeer') result = await hostHandlers.onSendToPeer(entry.id, msg.args[0], msg.args[1]);
      else if (msg.method === 'transferClaim') result = await hostHandlers.onTransferClaim(entry.id, msg.args[0], msg.args[1]);
      else if (msg.method === 'postCausalEvent') result = await hostHandlers.onPostCausalEvent(entry.id, msg.args[0], msg.args[1]);
      else if (msg.method === 'queryCausalState') result = await hostHandlers.onQueryCausalState(entry.id, msg.args[0], msg.args[1]);
      else throw new Error(`Unknown ctx method: ${msg.method}`);
    } catch (err) {
      error = err.message;
    }
    iframe.contentWindow.postMessage({ channel: 'aiwa-ctx-response', callId: msg.callId, result, error }, '*');
  };

  window.addEventListener('message', onMessage);
  container.appendChild(iframe);

  return {
    unmount() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
    /**
     * Pushes an inbound peer message INTO this already-mounted module —
     * the host-initiated counterpart to ctx.sendToPeer(). Called by
     * main.js when a real transport message (§25) arrives tagged for
     * this exact module id while it happens to be the one currently
     * running; if no module is mounted, or a different one is, the
     * caller simply doesn't call this — there's no queue on this side,
     * a module only ever sees peer messages while it's actually open.
     */
    deliverPeerMessage(peerId, data) {
      iframe.contentWindow.postMessage({ channel: 'aiwa-peer-message', peerId, data }, '*');
    },
  };
}
