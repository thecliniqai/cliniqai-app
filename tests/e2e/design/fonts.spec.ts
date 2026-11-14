/**
 * Local fonts (V2-06 06-01b step 3; R-4, R-43; PWA_STRATEGY §3.9), on the built app, signed out, desktop Chromium:
 *   - `/login`: body text renders in Inter from a loaded face; at most two font files are fetched on first load, all
 *     from `/_next/static/media/` on the loopback server, none of them IBM Plex or Devanagari;
 *   - every Inter and Manrope face the page declares has exactly the approved `unicode-range` of its `@font-face` in
 *     the V2-DX files at `3a78a5d` (evidence copies), so each subset downloads only for its characters;
 *   - a "₹" drawn in body text loads the Inter face whose range covers U+20B9 (Latin Extended), so ₹ is Inter's;
 *   - `/offline`: the product name renders in Manrope from a loaded face.
 * Before 06-01b: no `@font-face` existed and the system font rendered.
 *
 * Runs in the PR lane on desktop-chrome only (font loading does not depend on the device).
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "font loading is checked once, on desktop Chromium");
});

const EVIDENCE = path.join(ROOT, ".planning/phases/06-design-system-pwa-shell/evidence/06-01b");

/** Code-point intervals of a `unicode-range` value (`U+0000-00FF`, `U+20AC`, `U+4??` wildcards), merged and sorted. */
function ranges(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of value.split(",").map((p) => p.trim().replace(/^u\+/i, "")).filter(Boolean)) {
    if (part.includes("?")) out.push([parseInt(part.replace(/\?/g, "0"), 16), parseInt(part.replace(/\?/g, "f"), 16)]);
    else if (part.includes("-")) {
      const [a, b] = part.split("-");
      out.push([parseInt(a, 16), parseInt(b, 16)]);
    } else out.push([parseInt(part, 16), parseInt(part, 16)]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** The approved `@font-face` ranges per family, from the verbatim evidence copies (Inter: base; Manrope: brand). */
function approvedFaces(): Array<{ family: string; range: Array<[number, number]> }> {
  const css = ["clinic-paper.approved.css", "cliniq-ai.approved.css"].map((f) => fs.readFileSync(path.join(EVIDENCE, f), "utf8")).join("\n");
  const faces: Array<{ family: string; range: Array<[number, number]> }> = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family:\s*"([^"]+)"/.exec(m[1])?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(m[1])?.[1];
    if ((family === "Inter" || family === "Manrope") && range) faces.push({ family, range: ranges(range) });
  }
  return faces;
}

interface FaceInfo {
  family: string;
  unicodeRange: string;
  status: string;
}

const faces = (page: Page) =>
  page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), unicodeRange: f.unicodeRange, status: f.status })),
  ) as Promise<FaceInfo[]>;

test("/login renders body text in Inter from local files; ≤ 2 font requests, none Plex or Devanagari", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "font" || /\.(woff2?|ttf|otf)(\?|$)/.test(req.url())) fontRequests.push(req.url());
  });
  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);

  const bodyFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFamily).toMatch(/^"?Inter"?,/);
  const all = await faces(page);
  expect(all.some((f) => f.family === "Inter" && f.status === "loaded"), JSON.stringify(all)).toBe(true);

  expect(fontRequests.length, fontRequests.join("\n")).toBeGreaterThan(0);
  expect(fontRequests.length, fontRequests.join("\n")).toBeLessThanOrEqual(2);
  for (const url of fontRequests) {
    const u = new URL(url);
    expect(u.hostname, url).toBe("127.0.0.1");
    expect(u.pathname, url).toMatch(/^\/_next\/static\/media\/[^/]+\.woff2$/);
    expect(url, url).not.toMatch(/plex|devanagari|noto/i);
  }
});

test("each Inter and Manrope face has the approved unicode-range (one face per subset file)", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);
  const served = (await faces(page)).filter((f) => f.family === "Inter" || f.family === "Manrope");
  const approved = approvedFaces();
  expect(approved).toHaveLength(4);
  const key = (f: { family: string; range: Array<[number, number]> }) => `${f.family} ${JSON.stringify(f.range)}`;
  expect(served.map((f) => key({ family: f.family, range: ranges(f.unicodeRange) })).sort()).toEqual(approved.map(key).sort());
});

test("₹ in body text loads Inter's Latin Extended face, so the rupee sign is drawn by Inter", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);
  const RUPEE = 0x20b9;
  const covering = (list: FaceInfo[]) =>
    list.filter((f) => f.family === "Inter" && ranges(f.unicodeRange).some(([a, b]) => a <= RUPEE && RUPEE <= b));
  expect(covering(await faces(page))).toHaveLength(1);

  await page.evaluate(() => {
    const p = document.createElement("p");
    p.textContent = "Fee ₹1,499";
    document.body.appendChild(p);
  });
  await expect
    .poll(async () => {
      await page.evaluate(() => document.fonts.ready);
      return covering(await faces(page))[0]?.status;
    })
    .toBe("loaded");
  expect(await page.evaluate(() => document.fonts.check('16px "Inter"', "₹"))).toBe(true);
});

test("/offline renders the product name in Manrope from a loaded face", async ({ page }) => {
  await page.goto("/offline");
  await page.evaluate(() => document.fonts.ready);
  const name = page.getByText("CliniQ AI", { exact: true });
  await expect(name).toBeVisible();
  expect(await name.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Manrope"?,/);
  const all = await faces(page);
  expect(all.some((f) => f.family === "Manrope" && f.status === "loaded"), JSON.stringify(all)).toBe(true);
});
