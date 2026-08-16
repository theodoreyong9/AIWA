import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeModuleHash } from '../public/js/core/modules/module-hash.js';
import { loadVerifiedModuleCode } from '../public/js/core/modules/module-loader.js';

function withFetchStub(response, fn) {
  const original = global.fetch;
  global.fetch = async () => response;
  return fn().finally(() => {
    global.fetch = original;
  });
}

test('loadVerifiedModuleCode returns the code when it matches the registered hash', async () => {
  const code = "ctx.toast('hi');";
  const hash = await computeModuleHash(code);
  const entry = { id: 'demo.js', codeHash: hash, codeUrl: 'https://example.com/demo.js' };

  await withFetchStub({ ok: true, text: async () => code }, async () => {
    const result = await loadVerifiedModuleCode(entry);
    assert.equal(result, code);
  });
});

test('loadVerifiedModuleCode rejects code that does not match the registered hash — a silent swap behind the same URL', async () => {
  const originalCode = "ctx.toast('hi');";
  const swappedCode = "ctx.toast('hi'); exfiltrate();";
  const hash = await computeModuleHash(originalCode);
  const entry = { id: 'demo.js', codeHash: hash, codeUrl: 'https://example.com/demo.js' };

  await withFetchStub({ ok: true, text: async () => swappedCode }, async () => {
    await assert.rejects(() => loadVerifiedModuleCode(entry), /failed integrity verification/);
  });
});

test('loadVerifiedModuleCode rejects on a failed HTTP fetch', async () => {
  const entry = { id: 'demo.js', codeHash: 'irrelevant', codeUrl: 'https://example.com/missing.js' };

  await withFetchStub({ ok: false, status: 404, text: async () => '' }, async () => {
    await assert.rejects(() => loadVerifiedModuleCode(entry), /HTTP 404/);
  });
});
