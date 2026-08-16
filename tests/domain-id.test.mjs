import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDomainId, shortDomainLabel } from '../public/js/core/identity/domain-id.js';

test('deriveDomainId is deterministic — same key always gives the same id', async () => {
  const key = new Uint8Array(32).fill(7);
  const id1 = await deriveDomainId(key);
  const id2 = await deriveDomainId(key);
  assert.equal(id1, id2);
});

test('deriveDomainId is the full 64-character SHA-256 hex, not truncated', async () => {
  const key = new Uint8Array(32).fill(7);
  const id = await deriveDomainId(key);
  assert.equal(id.length, 64);
});

test('deriveDomainId differs for different keys', async () => {
  const key1 = new Uint8Array(32).fill(1);
  const key2 = new Uint8Array(32).fill(2);
  assert.notEqual(await deriveDomainId(key1), await deriveDomainId(key2));
});

test('shortDomainLabel truncates for display only', async () => {
  const key = new Uint8Array(32).fill(7);
  const id = await deriveDomainId(key);
  const label = shortDomainLabel(id);
  assert.equal(label.length, 12);
  assert.equal(id.startsWith(label), true);
});
