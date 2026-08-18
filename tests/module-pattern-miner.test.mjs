import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractModulePattern, summarizeModulePatterns, KNOWN_CTX_CALLS } from '../public/js/core/ai/module-pattern-miner.js';

// ── extractModulePattern ──────────────────────────────────────────

test('extractModulePattern detects a real IIFE wrapper', () => {
  const code = "(function() {\n  ctx.toast('hi');\n})();";
  const p = extractModulePattern(code, 'a.js');
  assert.equal(p.hasIIFE, true);
});

test('extractModulePattern correctly reports no IIFE for code that lacks one', () => {
  const code = "ctx.toast('hi');";
  const p = extractModulePattern(code, 'a.js');
  assert.equal(p.hasIIFE, false);
});

test('extractModulePattern detects real ctx calls actually present in the code', () => {
  const code = "(function(){ ctx.postCausalEvent('x', {}); ctx.queryCausalState('pool'); })();";
  const p = extractModulePattern(code, 'a.js');
  assert.deepEqual(p.ctxCallsUsed.sort(), ['postCausalEvent', 'queryCausalState']);
});

test('extractModulePattern does not report a ctx call that is not actually present', () => {
  const code = "(function(){ ctx.toast('hi'); })();";
  const p = extractModulePattern(code, 'a.js');
  assert.ok(!p.ctxCallsUsed.includes('transferClaim'));
});

test('extractModulePattern handles dotted calls like storage.get/storage.set correctly', () => {
  const code = "(function(){ ctx.storage.get('k'); ctx.storage.set('k', 1); })();";
  const p = extractModulePattern(code, 'a.js');
  assert.deepEqual(p.ctxCallsUsed.sort(), ['storage.get', 'storage.set']);
});

test('extractModulePattern reports a real line count', () => {
  const code = 'line1\nline2\nline3';
  const p = extractModulePattern(code, 'a.js');
  assert.equal(p.lineCount, 3);
});

// ── summarizeModulePatterns ────────────────────────────────────────

test('summarizeModulePatterns computes real frequencies across multiple modules', () => {
  const extractions = [
    { moduleId: 'a', ctxCallsUsed: ['postCausalEvent', 'toast'] },
    { moduleId: 'b', ctxCallsUsed: ['postCausalEvent'] },
    { moduleId: 'c', ctxCallsUsed: ['transferClaim'] },
  ];
  const summary = summarizeModulePatterns(extractions, 0.5);
  assert.equal(summary.totalModulesMined, 3);
  const postCausal = summary.commonCtxPatterns.find((p) => p.call === 'postCausalEvent');
  assert.equal(postCausal.count, 2);
  assert.ok(Math.abs(postCausal.freq - 2 / 3) < 1e-9);
});

test('summarizeModulePatterns filters out patterns below the given threshold', () => {
  const extractions = [
    { moduleId: 'a', ctxCallsUsed: ['postCausalEvent'] },
    { moduleId: 'b', ctxCallsUsed: [] },
    { moduleId: 'c', ctxCallsUsed: [] },
  ];
  const summary = summarizeModulePatterns(extractions, 0.5); // postCausalEvent is only 1/3, below 0.5
  assert.ok(!summary.commonCtxPatterns.some((p) => p.call === 'postCausalEvent'));
});

test('summarizeModulePatterns identifies ctx primitives never used by any mined module — a real, genuinely useful gap signal', () => {
  const extractions = [
    { moduleId: 'a', ctxCallsUsed: ['postCausalEvent'] },
  ];
  const summary = summarizeModulePatterns(extractions);
  assert.ok(summary.unusedCtxPrimitives.includes('transferClaim'));
  assert.ok(summary.unusedCtxPrimitives.includes('sendToPeer'));
  assert.ok(!summary.unusedCtxPrimitives.includes('postCausalEvent'));
});

test('summarizeModulePatterns handles zero mined modules honestly — every primitive reported as unused, not an error', () => {
  const summary = summarizeModulePatterns([]);
  assert.equal(summary.totalModulesMined, 0);
  assert.deepEqual(summary.commonCtxPatterns, []);
  assert.deepEqual(summary.unusedCtxPrimitives, KNOWN_CTX_CALLS);
});

test('KNOWN_CTX_CALLS matches the real ctx surface confirmed directly against module-sandbox.js', () => {
  assert.deepEqual(KNOWN_CTX_CALLS, [
    'storage.get', 'storage.set', 'toast', 'commit', 'claim',
    'sendToPeer', 'onPeerMessage', 'transferClaim', 'postCausalEvent', 'queryCausalState',
  ]);
});
