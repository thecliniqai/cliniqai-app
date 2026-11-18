/**
 * The app's tokens equal the approved CliniQ AI theme (V2-06 plan 06-01b steps 1-2; G2-D addendum 2026-11-14).
 *
 * The approved set is parsed from the verbatim evidence copies of V2-DX `3a78a5d` (`clinic-paper.css`, then
 * `cliniq-ai.css` on top: the cascade the sketches render), with every var() chain resolved. Each name is compared by
 * resolved value with the same name in app/globals.css's `@theme` blocks: values, not spelling. Both copies must still
 * hash to the revision note's SHA-256, so the comparison cannot drift from what G2-D approved.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_MIRROR } from "@/lib/design/tokens";
import { appTokens, approvedTokens, normalise, resolve } from "../../scripts/design/contrast.mjs";

const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE = path.join(ROOT, ".planning/phases/06-design-system-pwa-shell/evidence/06-01b");
const read = (file: string) => fs.readFileSync(file, "utf8");
const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** SHA-256 of the approved files (06-PLAN revision note 2026-11-14, `git show 3a78a5d:<path> | shasum -a 256`). */
const APPROVED_SHA256 = {
  "clinic-paper.approved.css": "4acc7dffe4951bbd8c60bc5a4ceb605728c3991186690b3e3875ce0128cf5bd4",
  "cliniq-ai.approved.css": "6557d4c8c91e35d67a31597521f25c10f27a51da742a2689051c5a02ad600a21",
};

const approved = approvedTokens(
  read(path.join(EVIDENCE, "clinic-paper.approved.css")),
  read(path.join(EVIDENCE, "cliniq-ai.approved.css")),
) as Map<string, string>;
const app = appTokens(read(path.join(ROOT, "app/globals.css"))) as Map<string, string>;

/** Every custom property of the merged approved set (244 names at 3a78a5d). */
const COMPARED = [...approved.keys()];

describe("approved CliniQ AI tokens", () => {
  it("the evidence copies are the approved files (SHA-256 of the revision note)", () => {
    for (const [file, hash] of Object.entries(APPROVED_SHA256)) expect(sha256(path.join(EVIDENCE, file)), file).toBe(hash);
  });

  it("the approved accent is CliniQ Blue #246BCE", () => {
    expect(resolve(approved, "--color-accent")).toBe("#246bce");
  });

  it("compares the whole approved set: palette, semantics, AI-02, status hues, type, radii, shadows, components, PWA", () => {
    expect(COMPARED.length).toBe(244);
    for (const name of ["--color-ai-glyph", "--color-status-with-doctor-border", "--font-display", "--radius-xl", "--pwa-theme-color"]) {
      expect(COMPARED).toContain(name);
    }
    expect(resolve(approved, "--color-status-with-doctor-border")).toBe("#11998d");
    expect(resolve(approved, "--radius-xl")).toBe("20px");
  });

  it("the token mirror equals the approved PWA colours (#FFFFFF for theme, background and icon tile)", () => {
    expect(TOKEN_MIRROR.themeColor).toEqual({ cssVar: "--pwa-theme-color", value: resolve(approved, "--pwa-theme-color") });
    expect(TOKEN_MIRROR.backgroundColor).toEqual({ cssVar: "--pwa-background-color", value: resolve(approved, "--pwa-background-color") });
    expect(TOKEN_MIRROR.iconTile).toEqual({ cssVar: "--pwa-icon-tile", value: resolve(approved, "--pwa-icon-tile") });
    expect(new Set(Object.values(TOKEN_MIRROR).map((m) => m.value))).toEqual(new Set(["#ffffff"]));
  });

  it.each(COMPARED)("%s in app/globals.css resolves to the approved value", (name) => {
    expect(app.has(name), `${name} is defined in app/globals.css`).toBe(true);
    expect(normalise(resolve(app, name)), name).toBe(normalise(resolve(approved, name)));
  });
});
