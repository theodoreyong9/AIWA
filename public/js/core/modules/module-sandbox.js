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

/**
 * Builds the sandboxed iframe's document: the module's verified code,
 * plus a minimal in-iframe `ctx` shim that forwards every call to the
 * host via postMessage and resolves/rejects based on the host's
 * response. The module never sees `window.parent`, never sees the
 * host's real `window` — only this shim.
 */
function buildSandboxHtml(moduleCode, moduleId) {
  const escapedId = JSON.stringify(moduleId);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  'use strict';
  var MODULE_ID = ${escapedId};
  var pending = new Map();
  var nextCallId = 0;

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.channel !== 'aiwa-ctx-response') return;
    var resolver = pending.get(msg.callId);
    if (!resolver) return;
    pending.delete(msg.callId);
    if (msg.error) resolver.reject(new Error(msg.error));
    else resolver.resolve(msg.result);
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
 * @param {{
 *   onStorageGet: (moduleId: string, key: string) => Promise<string|null>,
 *   onStorageSet: (moduleId: string, key: string, value: string) => Promise<void>,
 *   onToast: (moduleId: string, message: string, kind: string) => void,
 *   onCommit: (moduleId: string, amount: number) => Promise<void>,
 *   onClaim: (moduleId: string) => Promise<number>,
 * }} hostHandlers
 */
export async function mountModule(container, entry, code, verifyFn, hostHandlers) {
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
  iframe.srcdoc = buildSandboxHtml(code, entry.id);

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
  };
}
