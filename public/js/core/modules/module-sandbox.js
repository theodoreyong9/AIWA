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

export async function mountModule(container, entry, code, verifyFn, hostHandlers) {
  const ok = await verifyFn(code, entry.codeHash);
  if (!ok) {
    throw new Error(`Module '${entry.id}' failed integrity verification — fetched code does not match its registered hash. Refusing to mount.`);
  }

  const iframe = document.createElement('iframe');
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
