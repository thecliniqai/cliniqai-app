/**
 * The token layers of app/globals.css (V2-06 plan 06-01a steps 2-3; DESIGN_SYSTEM §2.3-§2.4, §10).
 *
 * Parses the CSS the app ships and checks: every DESIGN_SYSTEM §2.3 semantic name (CSS spelling of §2.4) is defined
 * in `@theme inline` and resolves to a raw palette value; the semantic layer holds references only; every semantic the
 * codemod table can write exists (a missing one would render nothing); lib/design/tokens.ts equals the CSS; the v1
 * brand scale and the dead `:root` block are gone; `body` paints with semantic variables.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_MIRROR } from "@/lib/design/tokens";

const ROOT = path.resolve(__dirname, "../..");
const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const COLOR_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/design/color-map.json"), "utf8"));

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const blocks = [...CSS.matchAll(/@theme(?:\s+(inline|static))?\s*\{([^}]*)\}/g)];
const raw = new Map<string, string>();
const semantic = new Map<string, string>();
const component = new Map<string, string>();
for (const b of blocks) {
  for (const [k, v] of declarations(b[2])) (b[1] === "inline" ? semantic : b[1] === "static" ? component : raw).set(k, v);
}

const LITERAL_COLOR = /^(#[0-9a-f]{3,8}|oklch\([^)]*\)|rgb\([^)]*\))$/i;

function resolve(name: string, seen: string[] = []): string {
  const value = semantic.get(name) ?? component.get(name) ?? raw.get(name);
  if (value === undefined) throw new Error(`${[...seen, name].join(" -> ")} is not defined`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return ref ? resolve(ref[1], [...seen, name]) : value;
}

const FAMILY = (f: string) => ["bg", "fg", "border", "solid"].map((p) => `${f}-${p}`);
const STATUSES = ["booked", "waiting", "with-doctor", "to-bill", "done", "no-show", "cancelled"];
/** DESIGN_SYSTEM §2.3 semantic tokens in their §2.4 CSS spelling (fg-default -> fg, border-default -> border). */
const DESIGN_SYSTEM_SEMANTICS = [
  "canvas", "surface", "sunken", "selected",
  "fg", "fg-muted", "fg-subtle", "fg-placeholder", "fg-disabled", "fg-on-accent",
  "border", "border-subtle", "border-control",
  "accent", "accent-hover", "accent-pressed", "accent-subtle", "accent-fg", "ring",
  ...FAMILY("success"), ...FAMILY("warning"), ...FAMILY("danger"), ...FAMILY("info"),
  ...STATUSES.flatMap((s) => [`status-${s}-bg`, `status-${s}-fg`]),
  "alert-allergy-bg", "alert-allergy-fg", "scrim",
]; // prettier-ignore

/** Every semantic utility suffix the codemod table can write. */
function codemodSemantics(): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") out.add(v);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  for (const group of Object.values(COLOR_MAP.map) as object[]) add(group);
  for (const [file, entries] of Object.entries(COLOR_MAP.fileOverrides)) if (file !== "$comment") add(entries);
  for (const [name, entry] of Object.entries(COLOR_MAP.named)) {
    if (name === "$comment") continue;
    const utilities = typeof entry === "string" ? [entry] : Object.values(entry as Record<string, string>);
    for (const u of utilities) out.add(u.replace(/^(text|placeholder)-/, ""));
  }
  return [...out].sort();
}

describe("app/globals.css token layers", () => {
  it("defines every DESIGN_SYSTEM §2.3 semantic in @theme inline, resolving to a raw palette colour", () => {
    for (const name of DESIGN_SYSTEM_SEMANTICS) {
      expect(semantic.has(`--color-${name}`), `--color-${name} in @theme inline`).toBe(true);
      expect(resolve(`--color-${name}`)).toMatch(LITERAL_COLOR);
    }
  });

  it("the semantic layer only references the raw layer (values live in one place)", () => {
    expect(semantic.size).toBeGreaterThanOrEqual(DESIGN_SYSTEM_SEMANTICS.length);
    for (const [name, value] of semantic) {
      expect(value, name).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      expect(raw.has(value.slice(4, -1)), `${name} -> ${value} is defined`).toBe(true);
    }
  });

  it("every semantic the colour codemod can write exists, so no codemodded class renders nothing", () => {
    const written = codemodSemantics();
    expect(written).toContain("accent");
    for (const name of written) expect(semantic.has(`--color-${name}`), `--color-${name}`).toBe(true);
  });

  it("has no v1 brand scale and no :root block left", () => {
    expect(CSS).not.toMatch(/--color-brand-/);
    expect(CSS).not.toMatch(/:root\s*\{/);
  });

  it("paints body with semantic variables", () => {
    const body = /(?:^|\n)body\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(declarations(body.replace(/^\s*([a-z-]+)\s*:/gm, "--$1:")).get("--background-color")).toBe("var(--color-canvas)");
    expect(declarations(body.replace(/^\s*([a-z-]+)\s*:/gm, "--$1:")).get("--color")).toBe("var(--color-fg)");
  });

  it("lib/design/tokens.ts equals the CSS value of each variable it mirrors", () => {
    for (const [key, mirror] of Object.entries(TOKEN_MIRROR)) {
      expect(resolve(mirror.cssVar).toLowerCase(), key).toBe(mirror.value);
    }
  });

  it("keeps the v1 radii the old :root block applied and the v1 font (approved values land in 06-01b)", () => {
    // The v1 :root block overrode Tailwind's --radius-xs…xl, which every rounded-* utility reads: deleting it without
    // keeping these would change every rounded corner (the neutral screenshot diff caught it).
    expect(Object.fromEntries([...raw].filter(([k]) => k.startsWith("--radius-")))).toEqual({
      "--radius-xs": "4px",
      "--radius-sm": "6px",
      "--radius-md": "8px",
      "--radius-lg": "12px",
      "--radius-xl": "16px",
    });
    expect(raw.get("--font-sans")).toMatch(/^Inter,/);
  });
});
