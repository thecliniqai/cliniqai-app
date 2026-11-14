/**
 * The few design-token values non-CSS code needs (V2-06 plan 06-01a step 3; 06-01b step 2): the web app manifest's
 * theme and background colours and the app icon's tile colour. `app/globals.css` stays the single source: each entry
 * names the CSS custom property it mirrors, and tests/design/tokens.spec.ts fails when a value here differs from what
 * that property resolves to in the CSS. Change the CSS first, then this mirror.
 *
 * There is no glyph colour: the approved CliniQ AI icon masters carry the brand's own colours (the logo is never
 * recoloured), so only the tile colour is a token.
 */
export interface TokenMirror {
  /** The CSS custom property in app/globals.css. */
  readonly cssVar: `--${string}`;
  /** Its resolved value (lowercase hex). */
  readonly value: `#${string}`;
}

export const TOKEN_MIRROR = {
  themeColor: { cssVar: "--color-surface", value: "#ffffff" },
  backgroundColor: { cssVar: "--color-canvas", value: "#f7f6f3" },
  iconTile: { cssVar: "--pwa-icon-tile", value: "#ffffff" },
} as const satisfies Record<string, TokenMirror>;

export const themeColor = TOKEN_MIRROR.themeColor.value;
export const backgroundColor = TOKEN_MIRROR.backgroundColor.value;
export const iconTile = TOKEN_MIRROR.iconTile.value;
