import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, shapeTrendsFromApiResponse } from '../scripts/fetch-github-trends.mjs';

// ── buildSearchQuery ──────────────────────────────────────────────

test('buildSearchQuery produces a real GitHub created: qualifier, YYYY-MM-DD', () => {
  const q = buildSearchQuery(14, new Date('2026-08-18T00:00:00Z'));
  assert.equal(q, 'created:>2026-08-04');
});

test('buildSearchQuery respects a different lookback window', () => {
  const q7 = buildSearchQuery(7, new Date('2026-08-18T00:00:00Z'));
  const q30 = buildSearchQuery(30, new Date('2026-08-18T00:00:00Z'));
  assert.equal(q7, 'created:>2026-08-11');
  assert.equal(q30, 'created:>2026-07-19');
});

// ── shapeTrendsFromApiResponse ────────────────────────────────────
// Fixture matches GitHub's own real, documented response shape —
// confirmed against docs.github.com/en/rest/search/search before this
// file was written (items[].full_name, .description, .language,
// .stargazers_count, .html_url, .topics).

function realShapedFixture() {
  return {
    items: [
      { full_name: 'octocat/quine-relay', description: 'An uroboros program with 50 programming languages', language: 'Ruby', stargazers_count: 2492, html_url: 'https://github.com/octocat/quine-relay', topics: ['esoteric', 'quine'] },
      { full_name: 'someuser/verbal-expressions', description: 'JavaScript Regular expressions made easy', language: 'JavaScript', stargazers_count: 483, html_url: 'https://github.com/someuser/verbal-expressions', topics: [] },
    ],
  };
}

test('shapeTrendsFromApiResponse extracts exactly the fields idea-agent.js needs, from a real response shape', () => {
  const shaped = shapeTrendsFromApiResponse(realShapedFixture(), 1234567890);
  assert.equal(shaped.fetchedAt, 1234567890);
  assert.equal(shaped.repositories.length, 2);
  assert.deepEqual(shaped.repositories[0], {
    fullName: 'octocat/quine-relay',
    description: 'An uroboros program with 50 programming languages',
    language: 'Ruby',
    stars: 2492,
    url: 'https://github.com/octocat/quine-relay',
    topics: ['esoteric', 'quine'],
  });
});

test('shapeTrendsFromApiResponse handles a repository with no description and no topics, real fields GitHub can genuinely omit', () => {
  const response = { items: [{ full_name: 'x/y', description: null, language: null, stargazers_count: 0, html_url: 'https://github.com/x/y' }] };
  const shaped = shapeTrendsFromApiResponse(response);
  assert.equal(shaped.repositories[0].description, '');
  assert.equal(shaped.repositories[0].language, null);
  assert.deepEqual(shaped.repositories[0].topics, []);
});

test('shapeTrendsFromApiResponse handles a malformed or empty API response without throwing', () => {
  assert.deepEqual(shapeTrendsFromApiResponse({}).repositories, []);
  assert.deepEqual(shapeTrendsFromApiResponse(null).repositories, []);
  assert.deepEqual(shapeTrendsFromApiResponse({ items: 'not-an-array' }).repositories, []);
});

test('shapeTrendsFromApiResponse defaults fetchedAt to a real timestamp when omitted', () => {
  const before = Date.now();
  const shaped = shapeTrendsFromApiResponse(realShapedFixture());
  const after = Date.now();
  assert.ok(shaped.fetchedAt >= before && shaped.fetchedAt <= after);
});
