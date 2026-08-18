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

// ── Deepened, contextual, personalized signals ────────────────────

test('collectContextSnapshot: trendingCategories weights only the most recently registered modules, not an all-time count', () => {
  const registry = registryWith([
    { id: 'old1.js', name: 'Old1', category: 'Tools', author: 'bob', registeredAt: 100 },
    { id: 'old2.js', name: 'Old2', category: 'Tools', author: 'bob', registeredAt: 100 },
    { id: 'old3.js', name: 'Old3', category: 'Tools', author: 'bob', registeredAt: 100 },
    { id: 'new1.js', name: 'New1', category: 'Games', author: 'carol', registeredAt: 999999 },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob', 'carol']);
  // Tools dominates all-time (3 vs 1), but Games is the only category among the most-recent slice.
  assert.equal(snapshot.trendingCategories[0].category, 'Games');
});

test('collectContextSnapshot: categoryGaps lists categories contacts have that this domain itself has none of', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Tools', author: 'alice', registeredAt: 1 },
    { id: 'b.js', name: 'B', category: 'Games', author: 'bob', registeredAt: 1 },
    { id: 'c.js', name: 'C', category: 'Social', author: 'carol', registeredAt: 1 },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob', 'carol']);
  assert.deepEqual(snapshot.categoryGaps, ['Games', 'Social']);
});

test('collectContextSnapshot: categoryGaps is empty once this domain already covers every contact category', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Tools', author: 'alice', registeredAt: 1 },
    { id: 'b.js', name: 'B', category: 'Tools', author: 'bob', registeredAt: 1 },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob']);
  assert.deepEqual(snapshot.categoryGaps, []);
});

test('collectContextSnapshot: multiContactOverlap requires 2+ DISTINCT contacts, not just 2+ modules from one contact', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Games', author: 'bob', registeredAt: 1 },
    { id: 'b.js', name: 'B', category: 'Games', author: 'bob', registeredAt: 1 }, // same contact, second module, same category
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob']);
  assert.deepEqual(snapshot.multiContactOverlap, [], 'one prolific contact must not count as a multi-contact pattern');
});

test('collectContextSnapshot: multiContactOverlap fires once 2 distinct contacts independently share a category', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Games', author: 'bob', registeredAt: 1 },
    { id: 'b.js', name: 'B', category: 'Games', author: 'carol', registeredAt: 1 },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob', 'carol']);
  assert.deepEqual(snapshot.multiContactOverlap, [{ category: 'Games', contactCount: 2 }]);
});

test('collectContextSnapshot: own pinned modules and published data pass through untouched, defaulting to empty when omitted', () => {
  const registry = registryWith([]);
  const withOwn = collectContextSnapshot(registry, 'alice', [], { pinnedModuleIds: ['x.js'], publishedData: { 'x.js': { mood: 'curious' } } });
  assert.deepEqual(withOwn.myPinnedModuleIds, ['x.js']);
  assert.deepEqual(withOwn.myPublishedData, { 'x.js': { mood: 'curious' } });

  const withoutOwn = collectContextSnapshot(registry, 'alice', []);
  assert.deepEqual(withoutOwn.myPinnedModuleIds, []);
  assert.deepEqual(withoutOwn.myPublishedData, {});
});

test('buildIdeaSystemPrompt weaves in the real pinned-module, published-data, trending, gap, and overlap signals', () => {
  const registry = registryWith([
    { id: 'a.js', name: 'A', category: 'Games', author: 'bob', registeredAt: 1 },
    { id: 'b.js', name: 'B', category: 'Games', author: 'carol', registeredAt: 1 },
  ]);
  const snapshot = collectContextSnapshot(registry, 'alice', ['bob', 'carol'], { pinnedModuleIds: ['x.js', 'y.js'], publishedData: { 'x.js': { rank: 1500 } } });
  const prompt = buildIdeaSystemPrompt(snapshot);

  assert.match(prompt, /2 module\(s\) pinned/);
  assert.match(prompt, /x\.js \(rank\)/);
  assert.match(prompt, /Games \(2 contacts independently\)/);
});

test('buildIdeaSystemPrompt honestly states the absence of a signal rather than fabricating one', () => {
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', []);
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /nothing pinned/);
  assert.match(prompt, /published no module data yet/);
  assert.match(prompt, /no category yet shared by 2 or more distinct contacts/);
});

test('sanitizeIdeaReply also catches leakage of the newly added instruction phrases', () => {
  const leaked = 'A great module idea.\n\nTRENDING categories should really include this one.';
  const cleaned = sanitizeIdeaReply(leaked);
  assert.equal(cleaned, 'A great module idea.');
});

// ── External GitHub trends: real, clearly-separated, never invented ──

test('collectContextSnapshot passes externalTrends through untouched, defaulting to null', () => {
  const registry = registryWith([]);
  const trends = { fetchedAt: 1000, repositories: [{ fullName: 'x/y', description: 'd', language: 'Rust', stars: 10, url: 'https://github.com/x/y', topics: [] }] };
  const withTrends = collectContextSnapshot(registry, 'alice', [], {}, trends);
  assert.deepEqual(withTrends.externalTrends, trends);

  const withoutTrends = collectContextSnapshot(registry, 'alice', []);
  assert.equal(withoutTrends.externalTrends, null);
});

test('buildIdeaSystemPrompt honestly states no external trends are available rather than fabricating any', () => {
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', []); // no externalTrends passed at all
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /EXTERNAL SOFTWARE TRENDS: none available right now/);
});

test('buildIdeaSystemPrompt includes real external trend data when present, clearly labeled and separated from AIWA network data', () => {
  const trends = {
    fetchedAt: Date.now(),
    repositories: [{ fullName: 'octocat/quine-relay', description: 'x', language: 'Ruby', stars: 2492, url: 'https://github.com/octocat/quine-relay', topics: ['esoteric'] }],
  };
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', [], {}, trends);
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /octocat\/quine-relay \(Ruby, 2492★\)/);
  assert.match(prompt, /NOT this AIWA network, for inspiration only/);
  assert.match(prompt, /fetched today/);
});

test('buildIdeaSystemPrompt states real staleness for old external trend data rather than presenting it as current', () => {
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const trends = { fetchedAt: twoDaysAgo, repositories: [{ fullName: 'x/y', description: '', language: null, stars: 1, url: 'https://github.com/x/y', topics: [] }] };
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', [], {}, trends);
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /fetched 2 days ago — may be stale/);
});

test('buildIdeaSystemPrompt treats the honest, uninitialized placeholder file (fetchedAt: null, empty repositories) the same as no data at all', () => {
  const placeholder = { fetchedAt: null, repositories: [] };
  const snapshot = collectContextSnapshot(registryWith([]), 'alice', [], {}, placeholder);
  const prompt = buildIdeaSystemPrompt(snapshot);
  assert.match(prompt, /EXTERNAL SOFTWARE TRENDS: none available right now/);
});

test('external trend data is never merged into sharedCategories/trendingCategories — the AIWA-network-only fields stay untouched by it', () => {
  const registry = registryWith([{ id: 'a.js', name: 'A', category: 'Tools', author: 'alice', registeredAt: 1 }]);
  const trends = { fetchedAt: Date.now(), repositories: [{ fullName: 'x/y', description: '', language: 'Games', stars: 999, url: 'https://github.com/x/y', topics: [] }] };
  const snapshot = collectContextSnapshot(registry, 'alice', [], {}, trends);
  assert.deepEqual(snapshot.sharedCategories, { Tools: 1 }); // no phantom "Games" entry from the external repo's language field
});
