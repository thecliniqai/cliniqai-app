/**
 * Contrast as a test (V2-06 06-01b step 7). Every pair of lib/design/contrast-pairs.ts, measured from the tokens
 * app/globals.css ships (WCAG 2.2 relative luminance), meets its minimum; the list covers every gated pair of V2-DX's
 * contrast evidence at `3a78a5d` with the same ratio (so the app renders what was approved); the focus ring passes on
 * canvas and surface but not on the accent fill, which is why it sits on the white halo; and the committed report is
 * the tool's current output.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS } from "@/lib/design/contrast-pairs";
import { appTokens, contrastRatio, measurePairs, resolve } from "../../scripts/design/contrast.mjs";

const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE = path.join(ROOT, ".planning/phases/06-design-system-pwa-shell/evidence/06-01b");
const tokens = appTokens(fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8")) as Map<string, string>;
const results = measurePairs(tokens, CONTRAST_PAIRS) as Array<(typeof CONTRAST_PAIRS)[number] & { ratio: number; pass: boolean }>;
const ratioOf = (fg: string, bg: string) => contrastRatio(resolve(tokens, fg), resolve(tokens, bg));

interface DxPair {
  fg: string;
  bg: string;
  min: number;
  kind: string;
  ratio: number;
}

describe("token contrast (WCAG 2.2)", () => {
  it.each(results.map((r) => [r.fg, r.bg, r.min, r]))("%s on %s ≥ %s:1", (_fg, _bg, min, r) => {
    expect((r as { ratio: number }).ratio).toBeGreaterThanOrEqual((min as number) - 1e-9);
  });

  it("covers every gated pair of the V2-DX evidence at 3a78a5d (169), at the approved ratio", () => {
    const dx = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "v2-dx-contrast.approved.json"), "utf8")) as { brand: DxPair[] };
    const gated = dx.brand.filter((p) => p.kind === "text" || p.kind === "non-text");
    expect(gated).toHaveLength(169);
    const name = (n: string) => (tokens.has(`--color-${n}`) ? `--color-${n}` : `--${n}`);
    for (const p of gated) {
      const mine = results.find((r) => r.fg === name(p.fg) && r.bg === name(p.bg));
      expect(mine, `${p.fg} on ${p.bg}`).toBeDefined();
      expect(mine!.min, `${p.fg} on ${p.bg} minimum`).toBeGreaterThanOrEqual(p.min);
      expect(mine!.ratio, `${p.fg} on ${p.bg}`).toBeCloseTo(p.ratio, 1);
    }
  });

  it("text tokens reach 4.5:1 on canvas, surface, sunken and selected (v1 fg-subtle, Tailwind gray-400, failed on white)", () => {
    for (const bg of ["--color-canvas", "--color-surface", "--color-sunken", "--color-selected"]) {
      for (const fg of ["--color-fg", "--color-fg-secondary", "--color-fg-muted", "--color-fg-subtle", "--color-fg-placeholder"]) {
        expect(ratioOf(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio("#99a1af", "#ffffff")).toBeLessThan(4.5); // v1 gray-400 (oklch 70.7% 0.022 261.3 ≈ #99a1af)
  });

  it("the focus ring #3A80D9 is ≥ 3:1 on canvas and surface (3.99:1) and only 1.29:1 on CliniQ Blue, so it needs the halo", () => {
    expect(resolve(tokens, "--color-ring")).toBe("#3a80d9");
    expect(ratioOf("--color-ring", "--color-canvas")).toBeCloseTo(3.99, 2);
    expect(ratioOf("--color-ring", "--color-surface")).toBeGreaterThanOrEqual(3);
    expect(ratioOf("--color-ring", "--color-ring-halo")).toBeGreaterThanOrEqual(3);
    expect(resolve(tokens, "--color-ring-halo")).toBe("#ffffff");
    expect(ratioOf("--color-ring", "--color-accent")).toBeCloseTo(1.29, 2);
  });

  it("the With-doctor border #11998D reaches 3.29:1 on its teal wash", () => {
    expect(ratioOf("--color-status-with-doctor-border", "--color-status-with-doctor-bg")).toBeCloseTo(3.29, 2);
  });

  it("the committed evidence report is the tool's current output", () => {
    const report = fs.readFileSync(path.join(EVIDENCE, "contrast.md"), "utf8");
    const failed = results.filter((r) => !r.pass).length;
    expect(report).toContain(`**${results.length} pairs, ${results.length - failed} pass, ${failed} fail.**`);
    for (const r of results) expect(report, `${r.fg} on ${r.bg}`).toContain(`${r.ratio.toFixed(2)}:1`);
  });
});
