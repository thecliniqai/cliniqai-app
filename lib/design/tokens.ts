/**
 * The few design-token values non-CSS code needs (V2-06 plan 06-01a step 3): the web app manifest's theme and
 * background colours and the app icon's tile and glyph (06-05). `app/globals.css` stays the single source: each
 * entry names the semantic CSS variable it mirrors, and tests/design/tokens.spec.ts fails when a value here differs
 * from what that variable resolves to in the CSS. Change the CSS first, then this mirror.
 */
export interface TokenMirror {
  /** The semantic CSS custom property in app/globals.css. */
  readonly cssVar: `--color-${string}`;
  /** Its resolved value (lowercase hex). */
  readonly value: `#${string}`;
}

export const TOKEN_MIRROR = {
  themeColor: { cssVar: "--color-surface", value: "#ffffff" },
  backgroundColor: { cssVar: "--color-canvas", value: "#f7f6f3" },
  iconTile: { cssVar: "--color-accent", value: "#1769e0" },
  iconGlyph: { cssVar: "--color-fg-on-accent", value: "#ffffff" },
} as const satisfies Record<string, TokenMirror>;

export const themeColor = TOKEN_MIRROR.themeColor.value;
export const backgroundColor = TOKEN_MIRROR.backgroundColor.value;
export const iconTile = TOKEN_MIRROR.iconTile.value;
export const iconGlyph = TOKEN_MIRROR.iconGlyph.value;
