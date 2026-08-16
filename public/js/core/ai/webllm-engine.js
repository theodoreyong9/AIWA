// webllm-engine.js — the one genuinely untestable piece of the idea
// agent: actually loading and running an on-device model via WebGPU in
// a dedicated Worker. Real code, following the exact same discipline as
// solana-wallet.js and solana-rpc.js: no stub, no simulation — the real
// @mlc-ai/web-llm library, the real model, the real streaming
// generation — just unverifiable under `node --test`, since WebGPU and
// real Worker execution don't exist in this sandbox. Every piece of
// logic that COULD be separated into pure, testable code already has
// been (idea-agent.js) — what's left here is irreducibly "make a real
// browser do real GPU work," which no amount of careful factoring turns
// into something Node can check.
//
// Modeled on YourMine's own real initWebLLM()/detectEngine() (ai.js) —
// same library, same Worker-based approach for surviving tab-switching,
// same model-per-device split for memory budget — adapted to run
// standalone (no window.YM_* globals, no localStorage draft state this
// project doesn't need since this is a single idea request, not a
// multi-section code-generation flow).

const WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm';
// Confirmed to exist in WebLLM's official prebuiltAppConfig with full
// WebGPU support — the same two models YourMine's own ai.js uses,
// chosen per-device for GPU memory budget, not hardcoded to one.
const MODEL_MOBILE = 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC'; // ~945MB VRAM
const MODEL_DESKTOP = 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'; // ~5.1GB VRAM

let cachedEngine = null;
let cachedWorker = null;

/**
 * @returns {Promise<{ supported: boolean, reason?: string, isMobile?: boolean, model?: string }>}
 */
export async function detectWebGpuSupport() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { supported: false, reason: 'WebGPU is not available in this browser.' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No WebGPU adapter available on this device.' };
    }
  } catch (err) {
    return { supported: false, reason: `WebGPU adapter request failed: ${err.message}` };
  }
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return { supported: true, isMobile, model: isMobile ? MODEL_MOBILE : MODEL_DESKTOP };
}

function createWorker() {
  const code = `
    import * as webllm from '${WEBLLM_CDN}';
    const handler = new webllm.WebWorkerMLCEngineHandler();
    self.onmessage = (msg) => { handler.onmessage(msg); };
  `;
  const blob = new Blob([code], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  return new Worker(url, { type: 'module' });
}

/**
 * Loads the on-device model in a dedicated Worker (real WebGPU work,
 * genuinely survives tab-switching the way a main-thread engine would
 * not) and returns a real, ready-to-use engine. Caches the engine
 * across calls within one session — reloading a multi-hundred-MB model
 * on every idea request would be its own kind of bug.
 *
 * @param {(progress: { text: string, progress: number }) => void} [onProgress]
 * @returns {Promise<any>} the real WebLLM engine object
 */
export async function loadEngine(onProgress) {
  if (cachedEngine) return cachedEngine;

  const support = await detectWebGpuSupport();
  if (!support.supported) {
    throw new Error(support.reason || 'WebGPU is not supported on this device.');
  }

  if (!window.webllm) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = `
        import * as webllm from '${WEBLLM_CDN}';
        window.webllm = webllm;
        window.dispatchEvent(new Event('aiwa-webllm-loaded'));
      `;
      document.head.appendChild(script);
      window.addEventListener('aiwa-webllm-loaded', resolve, { once: true });
      setTimeout(() => reject(new Error('WebLLM CDN load timed out.')), 30000);
    });
  }

  if (!cachedWorker) cachedWorker = createWorker();
  cachedEngine = await window.webllm.CreateWebWorkerMLCEngine(cachedWorker, support.model, {
    initProgressCallback: (p) => onProgress?.({ text: p.text, progress: p.progress }),
  });
  return cachedEngine;
}

/**
 * Streams a real chat completion from the loaded engine — a real
 * generator yielding real token chunks as they arrive, not a canned
 * response. `stopSignal`, if provided, lets a caller abandon generation
 * early (e.g. the user navigates away) without waiting for the model to
 * finish producing tokens it will never be shown.
 *
 * @param {any} engine
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {number} maxTokens
 * @param {Promise<void>} [stopSignal]
 */
export async function* streamChat(engine, model, messages, maxTokens, stopSignal) {
  const stream = await engine.chat.completions.create({ messages, model, stream: true, max_tokens: maxTokens });
  let stopped = false;
  stopSignal?.then(() => { stopped = true; });

  for await (const chunk of stream) {
    if (stopped) return;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Releases the cached engine and terminates its Worker — call when the app is closing or the feature is genuinely done, not between individual requests. */
export function disposeEngine() {
  try { cachedWorker?.terminate(); } catch { /* already gone */ }
  cachedWorker = null;
  cachedEngine = null;
}
