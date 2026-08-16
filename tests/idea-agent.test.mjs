import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectContextSnapshot, buildIdeaSystemPrompt, sanitizeIdeaReply } from '../public/js/core/ai/idea-agent.js';

function registryWith(modules) {
  const registered = {};
  for (const m of modules) registered[m.id] = m;
  return { modules: registered };
}

test('collectContextSnapshot separates my own modules from contacts real modules — real data, never invented', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Tools', author: 'alice' },
    { id: 'b.js', name: 'B', category: 'Games', author: 'bob' },
    { id: 'c.js', name: 'C', category: 'Tools', author: 'alice' },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob']);

  assert.equal(snapshot.myModules.length, 2);
  assert.ok(snapshot.myModules.every((m) => m.author === 'alice'));
  assert.deepEqual(Object.keys(snapshot.contactModules), ['bob']);
  assert.equal(snapshot.contactModules.bob.length, 1);
});

test('a contact with no registered modules is simply absent from contactModules, not an empty-array placeholder', () => {
  const registry = registryWith([{ id: 'a.js', name: 'A', category: 'Tools', author: 'alice' }]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob']); // bob has nothing registered
  assert.deepEqual(snapshot.contactModules, {});
});

test('sharedCategories counts across the WHOLE known registry, not just mine or just contacts', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Tools', author: 'alice' },
    { id: 'b.js', name: 'B', category: 'Tools', author: 'bob' },
    { id: 'c.js', name: 'C', category: 'Games', author: 'carol' },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob', 'carol']);
  assert.equal(snapshot.sharedCategories.Tools, 2);
  assert.equal(snapshot.sharedCategories.Games, 1);
});

test('an empty registry and no contacts produces an honest, empty snapshot, not a crash', () => {
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', []);
  assert.deepEqual(snapshot.myModules, []);
  assert.deepEqual(snapshot.contactModules, {});
  assert.deepEqual(snapshot.sharedCategories, {});
});

test('buildIdeaSystemPrompt reflects a real snapshot precisely — my modules, contact count, top categories', () => {
  const snapshot = {
    myModules: [{ id: 'a.js', name: 'Weather', category: 'Tools', author: 'alice' }],
    contactModules: { bob: [{ id: 'b.js', name: 'Chess', category: 'Games', author: 'bob' }] },
    sharedCategories: { Tools: 3, Games: 1 },
  };
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /Weather \(Tools\)/);
  assert.match(prompt, /1 known contact domain/);
  assert.match(prompt, /Tools x3, Games x1/);
});

test('buildIdeaSystemPrompt handles a genuinely empty snapshot honestly, not with fabricated placeholder data', () => {
  const prompt = buildIdeaSystemPrompt({ myModules: [], contactModules: {}, sharedCategories: {} });
  assert.match(prompt, /none yet/);
  assert.match(prompt, /0 known contact domains/);
  assert.match(prompt, /no network data yet/);
});

test('buildIdeaSystemPrompt explicitly forbids inventing trends — the same discipline as the real reference prompt', () => {
  const prompt = buildIdeaSystemPrompt({ myModules: [], contactModules: {}, sharedCategories: {} });
  assert.match(prompt, /do not invent trends or news/);
});

test('sanitizeIdeaReply truncates at the first leaked instruction marker', () => {
  const leaked = 'Weather Buddy — tracks local conditions\nWhy: fits the Tools pattern.\nNETWORK DATA (your only source of truth...)';
  const clean = sanitizeIdeaReply(leaked);
  assert.equal(clean, 'Weather Buddy — tracks local conditions\nWhy: fits the Tools pattern.');
});

test('sanitizeIdeaReply leaves a genuinely clean reply untouched', () => {
  const clean = 'Trade Ledger — track barters with neighbors\nWhy: several contacts run Tools modules, none for exchange yet.';
  assert.equal(sanitizeIdeaReply(clean), clean);
});

test('sanitizeIdeaReply never returns an empty string even if the whole text matches a marker', () => {
  const allLeak = 'You are a brainstorming assistant inside AIWA';
  const result = sanitizeIdeaReply(allLeak);
  assert.ok(result.length > 0);
});
