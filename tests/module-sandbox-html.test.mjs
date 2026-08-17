// module-sandbox-html.test.mjs — tests only the pure string-generation
// half of module-sandbox.js (buildSandboxHtml). Real DOM/iframe mounting
// (mountModule) remains untestable here for the reason this file's own
// header states — this file exists to confirm the theme-injection
// contract is actually present in the generated markup, not to claim
// the whole sandbox is now verified.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSandboxHtml } from '../public/js/core/modules/module-sandbox.js';
import { DEFAULT_THEME, COMPACT_THEME, themeToCssVariables } from '../public/js/core/presentation/theme-tokens.js';

test('the generated document embeds the theme CSS variables inside a <style> tag', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /<style>:root \{/);
  assert.match(html, /--aiwa-color-background: #ffffff;/);
});

test('a different theme produces genuinely different injected CSS — not the same output regardless of which theme is passed', () => {
  const defaultHtml = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  const compactHtml = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(COMPACT_THEME), COMPACT_THEME);
  assert.notEqual(defaultHtml, compactHtml);
  assert.match(compactHtml, /--aiwa-color-background: #000000;/);
});

test('ctx.theme is embedded as real, parseable JSON data available to the module — not just CSS variables', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  const start = html.indexOf('theme: {');
  assert.notEqual(start, -1, 'ctx.theme assignment must be present in the generated document');
  // Nested braces (theme.colors, theme.font, ...) mean a non-greedy
  // regex stops at the first inner `}` — walk real brace depth instead.
  let depth = 0;
  let end = -1;
  for (let i = start + 'theme: '.length; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, 'theme JSON object must have balanced braces');
  const parsed = JSON.parse(html.slice(start + 'theme: '.length, end));
  assert.deepEqual(parsed, DEFAULT_THEME);
});

test('the module code itself is unchanged by which theme is active — same code, different injected presentation only', () => {
  const moduleCode = "document.body.style.color = 'var(--aiwa-color-text)';";
  const defaultHtml = buildSandboxHtml(moduleCode, 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  const compactHtml = buildSandboxHtml(moduleCode, 'demo.js', themeToCssVariables(COMPACT_THEME), COMPACT_THEME);
  assert.ok(defaultHtml.includes(moduleCode));
  assert.ok(compactHtml.includes(moduleCode));
  // The code string itself is byte-identical in both documents — only
  // the surrounding theme injection differs, which is the actual claim
  // §27.5 makes ("a presentation layer cannot alter module behavior").
});

test('ctx.sendToPeer and ctx.onPeerMessage are present — real-time, peer-addressed', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /sendToPeer: function \(peerId, data\) \{ return callHost\('sendToPeer', \[peerId, data\]\); \}/);
  assert.match(html, /onPeerMessage: function \(callback\) \{ peerMessageListeners\.push\(callback\); \}/);
});

test('the inbound peer-message channel is wired to dispatch to registered listeners, not just declared', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /aiwa-peer-message/);
  assert.match(html, /peerMessageListeners\[i\]\(msg\.peerId, msg\.data\)/);
});

test('ctx.transferClaim is present — the one Conservation primitive that genuinely cannot be generic, since it requires real signing material this sandbox never holds', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /transferClaim: function \(claimId, toDomainId\) \{ return callHost\('transferClaim', \[claimId, toDomainId\]\); \}/);
});

test('ctx.postCausalEvent is present — the one general-purpose primitive a future contract should ever need, so this file never has to grow bespoke methods for every new one', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /postCausalEvent: function \(type, payload\) \{ return callHost\('postCausalEvent', \[type, payload\]\); \}/);
});

test('ctx no longer exposes the earlier bespoke share/issueClaim/jackpot* methods — postCausalEvent replaces all of them', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  for (const stale of ['share:', 'issueClaim:', 'jackpotInit:', 'jackpotDonate:', 'jackpotRelease:']) {
    assert.ok(!html.includes(stale), `${stale} should no longer be a distinct ctx method`);
  }
});

test('ctx.queryCausalState is present — the generic read-side counterpart to postCausalEvent', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /queryCausalState: function \(viewName, params\) \{ return callHost\('queryCausalState', \[viewName, params\]\); \}/);
});

test('ctx.myDomainId is injected as real, read-only data — needed by any contract module to reference itself', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME, 'abc123realdomainid');
  assert.match(html, /myDomainId: "abc123realdomainid"/);
});

test('ctx.myDomainId defaults to null when omitted, rather than throwing', () => {
  const html = buildSandboxHtml('/* code */', 'demo.js', themeToCssVariables(DEFAULT_THEME), DEFAULT_THEME);
  assert.match(html, /myDomainId: null/);
});
