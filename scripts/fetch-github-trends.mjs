#!/usr/bin/env node
// fetch-github-trends.mjs — the actual "GitHub bot" the user asked for
// (§28's idea agent, deepened at their direct request): a small,
// scheduled script (run by .github/workflows/update-github-trends.yml
// — the bot's real, scheduled execution) that queries GitHub's own
// real, documented, public REST search API (docs.github.com/en/rest/
// search/search — GET /search/repositories, no scraping, no ToS
// violation: this is the exact, official, publicly-documented
// endpoint, unauthenticated rate limit 10 req/min, well within a
// once-daily scheduled run) for recently-created, currently-starred
// repositories, and writes the result to data/github-trends.json — a
// real, versioned, git-history-auditable file IN this repository.
// That committed file, not a live API call, is what the idea agent
// actually reads (idea-agent.js's own collectContextSnapshot()).
//
// Why a committed file and not a live call from the app itself: the
// same §7 discipline as everywhere else in this project — delayed,
// never blocked. The deployed AIWA app is a static site with no
// server; if it called GitHub's API directly from the browser on every
// idea-agent open, that would (a) be a live, blocking, non-partition-
// tolerant network dependency for a feature that is supposed to be
// advisory and optional, and (b) hit GitHub's real rate limits almost
// immediately under any real usage. A file fetched on a schedule and
// committed means the app only ever does a same-origin static fetch of
// its own already-deployed data/github-trends.json — which can be
// stale during a long partition, exactly like every other real trade-
// off already accepted throughout this project, never something that
// blocks the app or the idea agent from working at all.
//
// Untestable in this project's own sandboxed test runner for the same
// reason solana-rpc.js's real RPC calls and webllm-engine.js's real
// WebGPU calls already are — this environment has no network access to
// api.github.com. Real, not a stub: this is the actual script the real
// GitHub Action actually runs. The pure, testable logic (shaping the
// raw API response into what idea-agent.js actually consumes) is
// deliberately split into shapeTrendsFromApiResponse(), exported and
// fully tested without any network access at all — the same
// discipline idea-agent.js itself already follows for the same reason.

const GITHUB_SEARCH_URL = 'https://api.github.com/search/repositories';

/**
 * @param {number} daysBack how far back "recently created" reaches
 * @returns {string} a real GitHub search query string, e.g. 'created:>2026-08-11'
 */
export function buildSearchQuery(daysBack = 14, now = new Date()) {
  const cutoff = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const isoDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD, exactly what GitHub's created: qualifier expects
  return `created:>${isoDate}`;
}

/**
 * Pure transformation from GitHub's real, documented search-repositories
 * response shape (confirmed directly against docs.github.com/en/rest/
 * search/search before this was written — items[].name, .full_name,
 * .description, .language, .stargazers_count, .html_url, .topics) into
 * the small, stable shape idea-agent.js actually consumes. Fully
 * testable with a hand-built fixture matching GitHub's own real
 * response shape — no network access needed for this half.
 *
 * @param {{ items: Array<{ full_name: string, description: string | null, language: string | null, stargazers_count: number, html_url: string, topics?: string[] }> }} apiResponse
 * @param {number} fetchedAt
 * @returns {{ fetchedAt: number, repositories: Array<{ fullName: string, description: string, language: string | null, stars: number, url: string, topics: string[] }> }}
 */
export function shapeTrendsFromApiResponse(apiResponse, fetchedAt = Date.now()) {
  const items = Array.isArray(apiResponse?.items) ? apiResponse.items : [];
  const repositories = items.map((item) => ({
    fullName: item.full_name,
    description: item.description ?? '',
    language: item.language ?? null,
    stars: item.stargazers_count ?? 0,
    url: item.html_url,
    topics: Array.isArray(item.topics) ? item.topics : [],
  }));
  return { fetchedAt, repositories };
}

/**
 * Real network call — the untestable-in-sandbox half, exactly matching
 * solana-rpc.js's own discipline. Not invoked by any test; invoked only
 * by main() below, which only runs when this script is executed
 * directly by the real, scheduled GitHub Action.
 */
async function fetchRealGithubTrends({ daysBack = 14, perPage = 15 } = {}) {
  const query = buildSearchQuery(daysBack);
  const url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`; // optional — raises the rate limit, never required

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub search API returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const { writeFile } = await import('node:fs/promises');
  const apiResponse = await fetchRealGithubTrends();
  const shaped = shapeTrendsFromApiResponse(apiResponse, Date.now());
  await writeFile(new URL('../public/data/github-trends.json', import.meta.url), `${JSON.stringify(shaped, null, 2)}\n`);
  console.log(`Wrote ${shaped.repositories.length} real trending repositories to public/data/github-trends.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
