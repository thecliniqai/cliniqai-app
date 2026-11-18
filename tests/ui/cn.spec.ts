/**
 * `cn()` and the project's theme scales (V2-06 06-02a). Before the fix `tailwind-merge` read `text-body-sm` as a text
 * colour and dropped it next to `text-fg` (the gallery's buttons rendered at the inherited 16 px), and it kept both of
 * two conflicting `min-h-*` sizes. The scale list must name exactly the tokens app/globals.css defines.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_SCALES, cn } from "@/lib/utils";

const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Names of `--<prefix>-<name>:` declarations, without Tailwind's `--x--sub` companion properties. */
function defined(prefix: string): string[] {
  const names = new Set<string>();
  for (const m of css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+?)\\s*:`, "g"))) {
    if (!m[1].includes("--")) names.add(m[1]);
  }
  return [...names].sort();
}

describe("cn", () => {
  it("keeps a type-scale size next to a text colour", () => {
    expect(cn("text-body-sm", "text-fg")).toBe("text-body-sm text-fg");
    expect(cn("text-label", "text-(--button-primary-fg)")).toBe("text-label text-(--button-primary-fg)");
    expect(cn("text-caption font-semibold", "text-fg-muted")).toBe("text-caption font-semibold text-fg-muted");
  });

  it("lets the later of two sizes, shadows, radii or trackings win", () => {
    expect(cn("text-body-sm", "text-label")).toBe("text-label");
    expect(cn("min-h-control-dense", "min-h-7")).toBe("min-h-7");
    expect(cn("size-control-dense", "size-7")).toBe("size-7");
    expect(cn("shadow-hairline", "shadow-popover")).toBe("shadow-popover");
    expect(cn("rounded-md", "rounded-pill")).toBe("rounded-pill");
    expect(cn("tracking-caps", "tracking-title")).toBe("tracking-title");
  });

  it("keeps a variant's size apart from the base size", () => {
    expect(cn("min-h-control-dense", "touch:min-h-control")).toBe("min-h-control-dense touch:min-h-control");
    expect(cn("text-input", "touch:text-base", "text-fg")).toBe("text-input touch:text-base text-fg");
  });

  it("names exactly the theme tokens app/globals.css defines", () => {
    expect([...THEME_SCALES.text].sort()).toEqual(defined("text"));
    expect([...THEME_SCALES.spacing].sort()).toEqual(defined("spacing"));
    expect([...THEME_SCALES.shadow].sort()).toEqual(defined("shadow"));
    expect([...THEME_SCALES.tracking].sort()).toEqual(defined("tracking"));
    expect(defined("radius")).toContain("pill");
  });
});
