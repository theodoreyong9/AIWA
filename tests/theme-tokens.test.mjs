import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, COMPACT_THEME, THEMES, DEFAULT_THEME_ID, themeToCssVariables, getTheme } from '../public/js/core/presentation/theme-tokens.js';

test('two distinct presets exist, with genuinely different values, not the same theme twice', () => {
  assert.notEqual(DEFAULT_THEME.colors.background, COMPACT_THEME.colors.background);
  assert.notEqual(DEFAULT_THEME.font.sizeBase, COMPACT_THEME.font.sizeBase);
});

test('every theme declares the same set of token keys — a module written against one preset does not silently break under another for a missing key', () => {
  const defaultKeys = { colors: Object.keys(DEFAULT_THEME.colors).sort(), font: Object.keys(DEFAULT_THEME.font).sort(), spacing: Object.keys(DEFAULT_THEME.spacing).sort() };
  const compactKeys = { colors: Object.keys(COMPACT_THEME.colors).sort(), font: Object.keys(COMPACT_THEME.font).sort(), spacing: Object.keys(COMPACT_THEME.spacing).sort() };
  assert.deepEqual(defaultKeys, compactKeys);
});

test('themeToCssVariables produces a valid-looking :root block with every color token present', () => {
  const css = themeToCssVariables(DEFAULT_THEME);
  assert.match(css, /^:root \{/);
  assert.match(css, /--aiwa-color-background: #ffffff;/);
  assert.match(css, /--aiwa-color-text-muted: #666666;/); // camelCase -> kebab-case
  assert.match(css, /--aiwa-font-family: system-ui, sans-serif;/);
  assert.match(css, /--aiwa-spacing-md: 0\.8rem;/);
});

test('themeToCssVariables output genuinely differs between presets — not accidentally identical output', () => {
  const defaultCss = themeToCssVariables(DEFAULT_THEME);
  const compactCss = themeToCssVariables(COMPACT_THEME);
  assert.notEqual(defaultCss, compactCss);
});

test('getTheme returns the requested theme by id', () => {
  assert.equal(getTheme('compact').id, 'compact');
  assert.equal(getTheme('default').id, 'default');
});

test('getTheme falls back to the default for an unknown id, rather than throwing — presentation should degrade, not break', () => {
  const result = getTheme('nonexistent-theme-id');
  assert.equal(result.id, DEFAULT_THEME_ID);
});

test('getTheme falls back to the default for a missing id', () => {
  assert.equal(getTheme(undefined).id, DEFAULT_THEME_ID);
});

test('THEMES exposes every declared preset by its own id, keyed consistently', () => {
  assert.equal(THEMES.default.id, 'default');
  assert.equal(THEMES.compact.id, 'compact');
});
