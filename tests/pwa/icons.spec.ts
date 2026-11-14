/**
 * App icons (V2-06 06-05 step 4, R-24; PWA_STRATEGY §3.1). The committed PNGs are the renders of the outlined master
 * `app/icon.svg`: `public/icons.json` names the master's SHA-256 (an edited master without a re-render fails), each PNG's
 * IHDR size equals the table, the tile and glyph colours are the token mirror's (`lib/design/tokens.ts`), the glyph is
 * paths only (no font), and the full-bleed variant (maskable, Apple) drops only the tile's rounding. Chromium itself is
 * exercised by `node scripts/design/render-icons.mjs --check` (not in Vitest: the test job has no browser).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { iconGlyph, iconTile } from "@/lib/design/tokens";
import { fullBleed, OUTPUTS, pngSize, sha256 } from "../../scripts/design/render-icons.mjs";

const ROOT = process.cwd();
const master = fs.readFileSync(path.join(ROOT, "app/icon.svg"), "utf8");
const record = JSON.parse(fs.readFileSync(path.join(ROOT, "public/icons.json"), "utf8")) as {
  masterSha256: string;
  outputs: Array<{ file: string; width: number; height: number }>;
};
type Output = { file: string; size: number; fullBleed: boolean };

describe("app icons", () => {
  it("public/icons.json names the current master (re-render after editing app/icon.svg)", () => {
    expect(record.masterSha256).toBe(sha256(Buffer.from(master, "utf8")));
  });

  it.each((OUTPUTS as Output[]).map((o) => [o.file, o.size]))("%s is a %i×%i PNG", (file, size) => {
    expect(pngSize(fs.readFileSync(path.join(ROOT, file as string)))).toEqual({ width: size, height: size });
    expect(record.outputs.find((o) => o.file === file)).toMatchObject({ width: size, height: size });
  });

  it("the master's tile and glyph use the token mirror's colours and the glyph is outlined (no text, no font)", () => {
    expect(/<rect\b[^>]*id="tile"[^>]*fill="([^"]+)"/.exec(master)?.[1]).toBe(iconTile);
    const glyphFills = [...master.matchAll(/<path\b[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(glyphFills.length).toBeGreaterThan(0);
    for (const fill of glyphFills) expect(fill).toBe(iconGlyph);
    expect(master).not.toMatch(/<text\b|font-family|@font-face|<image\b|href=/);
  });

  it("the full-bleed variant removes only the tile's rounding", () => {
    const flat = fullBleed(master) as string;
    expect(/<rect\b[^>]*id="tile"[^>]*\/>/.exec(flat)?.[0]).not.toMatch(/\brx=|\bry=/);
    expect(flat.replace(/<rect\b[^>]*id="tile"[^>]*\/>/, "")).toBe(master.replace(/<rect\b[^>]*id="tile"[^>]*\/>/, ""));
    expect(() => fullBleed("<svg></svg>")).toThrow(/no <rect id="tile"/);
  });
});
