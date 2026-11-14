/**
 * Focus and target-size assertions for the keyboard specs (V2-06 06-02a, R-14; 06-UI-SPEC "Focus treatment").
 *
 * - `tokenColor(name)` resolves a token from app/globals.css (var() chains followed) to `rgb(r, g, b)`, so the specs
 *   compare against the token, never a typed hex.
 * - `expectFocusRing(locator)` checks the element is focused and draws the approved ring: a solid outline ≥ 2 px in
 *   the `ring` colour with a positive offset (outside the control), and the white `ring-halo` box-shadow between.
 *
 * Plain TypeScript (no `import.meta`): Playwright compiles imported modules to CommonJS (06-07 wave note).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Locator } from "@playwright/test";
import { ROOT } from "../../support/app-env";

let tokens: Map<string, string> | null = null;

function tokenMap(): Map<string, string> {
  if (tokens) return tokens;
  const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  tokens = new Map();
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
  return tokens;
}

/** The token's value with every `var(--x)` resolved. */
export function tokenValue(name: string, seen: string[] = []): string {
  const value = tokenMap().get(name);
  if (value === undefined) throw new Error(`token ${name} is not defined in app/globals.css`);
  if (seen.includes(name)) throw new Error(`token cycle at ${name}`);
  return value.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (_m, ref: string) => tokenValue(ref, [...seen, name]));
}

/** A hex token as the browser's computed `rgb(r, g, b)` string. */
export function tokenColor(name: string): string {
  const hex = tokenValue(name).toLowerCase();
  const m = /^#([0-9a-f]{6})$/.exec(hex);
  if (!m) throw new Error(`token ${name} is ${hex}, not a 6-digit hex`);
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  outlineOffset: number;
  boxShadow: string;
}

export async function focusStyle(locator: Locator): Promise<FocusStyle> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: parseFloat(s.outlineWidth),
      outlineColor: s.outlineColor,
      outlineOffset: parseFloat(s.outlineOffset),
      boxShadow: s.boxShadow,
    };
  });
}

/** The element has focus and shows the approved ring outside the control, on the white halo. */
export async function expectFocusRing(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} has focus`).toBeFocused();
  const style = await focusStyle(locator);
  expect(style.outlineStyle, `${what}: outline style`).toBe("solid");
  expect(style.outlineWidth, `${what}: outline width`).toBeGreaterThanOrEqual(2);
  expect(style.outlineColor, `${what}: outline colour is the ring token`).toBe(tokenColor("--color-ring"));
  expect(style.outlineOffset, `${what}: the ring sits outside the control`).toBeGreaterThan(0);
  expect(style.boxShadow, `${what}: the white halo`).toContain(tokenColor("--color-ring-halo"));
}

/** The border-box height and width in CSS px. */
export async function boxSize(locator: Locator): Promise<{ width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box (not rendered)");
  return { width: box.width, height: box.height };
}
