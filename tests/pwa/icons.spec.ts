/**
 * App icons (V2-06 06-05 step 4; revised by 06-01b step 5, R-24, R-42; PWA_STRATEGY §3.1). The committed icons are
 * the approved CliniQ AI masters and their renders:
 *   - both masters and the SVG favicon hash to the approved SHA-256 (06-PLAN revision note; brand-kit favicon per the
 *     G2-D addendum's CTO ruling), and `public/icons.json` records exactly those;
 *   - each PNG is its table size, and its corner pixels prove the variant: the "any" icons keep the rounded tile's
 *     transparent corners, the maskable and Apple icons are opaque to the corner in the tile colour (`iconTile`);
 *   - the masters are outlined drawings (no text, font or external image), the tile is the token mirror's colour;
 *   - the favicon is the small mark (no earpieces) with the same paths as `BrandMark` below 32 px.
 * Chromium itself is exercised by `node scripts/design/render-icons.mjs --check` (not in Vitest: no browser there).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { iconTile } from "@/lib/design/tokens";
import { MARK_GEOMETRY } from "@/components/brand/brand-mark";
import { cornerProblems, decodePng, FAVICON, iconRecord, MASTERS, OUTPUTS, pngSize, sha256 } from "../../scripts/design/render-icons.mjs";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file));
const record = JSON.parse(read("public/icons.json").toString("utf8"));
type Output = { file: string; size: number; master: "icon" | "maskable"; corners: "opaque" | "transparent" };

describe("app icons", () => {
  it.each([MASTERS.icon, MASTERS.maskable, FAVICON].map((m) => [m.file, m.sha256]))("%s is the approved file (%s)", (file, hash) => {
    expect(sha256(read(file as string))).toBe(hash);
  });

  it("public/icons.json records the current masters, favicon and outputs (re-render after a master changes)", () => {
    expect(record).toEqual(iconRecord());
  });

  it.each((OUTPUTS as Output[]).map((o) => [o.file, o.size, o.corners]))("%s is a %i px PNG with %s corners", (file, size, corners) => {
    const png = read(file as string);
    expect(pngSize(png)).toEqual({ width: size, height: size });
    expect(cornerProblems(png, corners, iconTile)).toEqual([]);
  });

  it("the Apple icon is opaque to the corner (iOS shows no transparency) and the any-purpose icon is not", () => {
    const apple = decodePng(read("app/apple-icon.png"));
    expect(apple.pixel(0, 0)).toEqual([255, 255, 255, 255]);
    const any = decodePng(read("public/icon-192.png"));
    expect(any.pixel(0, 0)[3]).toBe(0);
    // The mark itself is drawn: the centre-left of the ring is CliniQ Blue-ish, not the tile.
    const ring = any.pixel(Math.round(192 * 0.2), Math.round(192 * 0.55));
    expect(ring[2]).toBeGreaterThan(ring[0] + 60);
  });

  it("the masters are outlined drawings on the token tile colour", () => {
    for (const m of [MASTERS.icon, MASTERS.maskable]) {
      const svg = read(m.file).toString("utf8");
      expect(/<rect\b[^>]*fill="([^"]+)"/.exec(svg)?.[1].toLowerCase(), m.file).toBe(iconTile);
      expect(svg, m.file).not.toMatch(/<text\b|font-family|@font-face|<image\b|href=/);
    }
    expect(/<rect\b[^>]*rx="0"/.test(read(MASTERS.maskable.file).toString("utf8"))).toBe(true);
  });

  it("the SVG favicon is the small mark, element for element (below 32 px, brand-kit rule)", () => {
    const svg = read(FAVICON.file).toString("utf8");
    const drawn = [...svg.matchAll(/<(path|circle)\b([^>]*?)\/?>/g)].map((m) => {
      const a = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
      const width = a["stroke-width"] === undefined ? undefined : Number(a["stroke-width"]);
      return m[1] === "path"
        ? { tag: "path", d: a.d.replace(/\s+(?=[A-Z])/g, ""), strokeWidth: width, paint: a.stroke.startsWith("url(") ? "ring" : "ink" }
        : { tag: "circle", cx: Number(a.cx), cy: Number(a.cy), r: Number(a.r), ...(width === undefined ? {} : { strokeWidth: width }), paint: a.fill === "none" ? "ink" : "ink-fill" };
    });
    expect(drawn).toEqual(MARK_GEOMETRY.small);
    expect(svg).not.toMatch(/<text\b|font-family|<image\b/);
  });
});
