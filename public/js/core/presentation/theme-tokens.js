// theme-tokens.js — closes a real gap: §27.5 states "a presentation
// layer cannot alter module behavior — only how a module's output is
// displayed," and names this as specifically relevant to interplanetary
// deployments ("a bandwidth- or hardware-constrained settlement may
// need a radically different presentation of identical underlying
// state, without every module needing to be rewritten to support it").
// No presentation layer existed at all — every module manipulated its
// own DOM/CSS directly, with nothing shared or switchable. This is
// that layer: plain data (design tokens), not a rendering framework —
// a module that wants to be presentation-independent reads these
// tokens (via CSS custom properties injected into its own sandboxed
// iframe, or via ctx.theme directly for JS-driven rendering); a module
// that ignores them entirely still runs correctly, just isn't
// presentation-independent — that property is opt-in per module, not
// enforced on code this project doesn't control.

/**
 * @typedef {{
 *   id: string,
 *   colors: { background: string, surface: string, text: string, textMuted: string, primary: string, border: string, error: string, success: string },
 *   font: { family: string, sizeBase: string, sizeSmall: string },
 *   spacing: { xs: string, sm: string, md: string, lg: string },
 * }} ThemeTokens
 */

/** The default, full-featured presentation — no constraints assumed. */
export const DEFAULT_THEME = {
  id: 'default',
  colors: {
    background: '#ffffff',
    surface: '#f7f7f8',
    text: '#1a1a1a',
    textMuted: '#666666',
    primary: '#1a1a1a',
    border: '#dddddd',
    error: '#bb3333',
    success: '#1a8a4a',
  },
  font: { family: 'system-ui, sans-serif', sizeBase: '14px', sizeSmall: '11px' },
  spacing: { xs: '0.2rem', sm: '0.4rem', md: '0.8rem', lg: '1.2rem' },
};

/**
 * §27.5's own stated case: a bandwidth- or hardware-constrained
 * settlement. Larger text (cheaper displays, more distance-viewing),
 * higher-contrast, minimal color palette (fewer bytes if a module
 * renders anything as an image, less to reason about on constrained
 * hardware), no muted/secondary text weight (fewer distinctions to
 * render). The SAME module code that respects DEFAULT_THEME's tokens
 * renders correctly under this preset with zero code changes — that
 * is the actual claim being verified, not merely that two presets with
 * different values exist.
 */
export const COMPACT_THEME = {
  id: 'compact',
  colors: {
    background: '#000000',
    surface: '#000000',
    text: '#ffffff',
    textMuted: '#ffffff', // deliberately identical to text — no secondary-weight distinction on constrained hardware
    primary: '#ffffff',
    border: '#ffffff',
    error: '#ffffff',
    success: '#ffffff',
  },
  font: { family: 'monospace', sizeBase: '20px', sizeSmall: '18px' },
  spacing: { xs: '0.3rem', sm: '0.6rem', md: '1rem', lg: '1.6rem' },
};

export const THEMES = { [DEFAULT_THEME.id]: DEFAULT_THEME, [COMPACT_THEME.id]: COMPACT_THEME };
export const DEFAULT_THEME_ID = DEFAULT_THEME.id;

/**
 * A theme's tokens as CSS custom-property declarations — what actually
 * gets injected into a module's sandboxed iframe (see
 * module-sandbox.js's buildSandboxHtml). Pure string generation, no
 * DOM required, fully testable.
 * @param {ThemeTokens} theme
 * @returns {string} a `:root { --aiwa-...: ...; }` CSS block
 */
export function themeToCssVariables(theme) {
  const lines = [];
  for (const [key, value] of Object.entries(theme.colors)) lines.push(`  --aiwa-color-${kebab(key)}: ${value};`);
  lines.push(`  --aiwa-font-family: ${theme.font.family};`);
  lines.push(`  --aiwa-font-size-base: ${theme.font.sizeBase};`);
  lines.push(`  --aiwa-font-size-small: ${theme.font.sizeSmall};`);
  for (const [key, value] of Object.entries(theme.spacing)) lines.push(`  --aiwa-spacing-${key}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

function kebab(camel) {
  return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Looks up a theme by id, falling back to the default rather than
 * throwing — an unknown or missing theme id should degrade to a known-
 * good presentation, not break module rendering entirely.
 * @param {string} id
 * @returns {ThemeTokens}
 */
export function getTheme(id) {
  return THEMES[id] ?? DEFAULT_THEME;
}
