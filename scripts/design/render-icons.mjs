#!/usr/bin/env node
/**
 * App icon renderer (V2-06 06-05 step 4, ruling R-24; PWA_STRATEGY §3.1). Renders the outlined SVG master `app/icon.svg`
 * with Playwright's Chromium (an existing devDependency; no image library) into the PNGs the manifest and iOS use:
 *
 *   public/icon-192.png           192×192  purpose "any"       (the master as drawn: rounded tile)
 *   public/icon-512.png           512×512  purpose "any"
 *   public/icon-maskable-512.png  512×512  purpose "maskable"  (full-bleed tile: the master's `#tile` with rx 0; the
 *                                                               glyph already sits inside the 80 % safe zone)
 *   app/apple-icon.png            180×180  opaque               (full-bleed too: iOS masks it and shows no transparency)
 *
 * Chromium loads only `file:` URLs; every other request is aborted, so rendering never touches the network.
 * `public/icons.json` records the master's SHA-256 and each output's size.
 *
 * Usage: node scripts/design/render-icons.mjs [--check]
 *   --check  re-renders into a temp dir and exits 1 when a committed PNG is missing, its IHDR size differs from the
 *            table, the rendered size differs, or `public/icons.json` names another master SHA-256 (the master was
 *            edited without re-rendering). Pixels are not compared: Chromium's anti-aliasing differs across platforms.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MASTER = "app/icon.svg";
const RECORD = "public/icons.json";

/** Output path, pixel size, and whether the tile is full-bleed (maskable / Apple). */
export const OUTPUTS = [
  { file: "public/icon-192.png", size: 192, fullBleed: false },
  { file: "public/icon-512.png", size: 512, fullBleed: false },
  { file: "public/icon-maskable-512.png", size: 512, fullBleed: true },
  { file: "app/apple-icon.png", size: 180, fullBleed: true },
];

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** The master with its `#tile` rect made full-bleed (rx/ry 0). Throws when the master has no such rect. */
export function fullBleed(svg) {
  const tile = /<rect\b[^>]*\bid="tile"[^>]*\/>/.exec(svg);
  if (!tile) throw new Error(`${MASTER}: no <rect id="tile" …/> to make full-bleed`);
  const flat = tile[0].replace(/\s(rx|ry)="[^"]*"/g, "");
  return svg.replace(tile[0], flat);
}

/** Width and height from a PNG's IHDR chunk, or null when `buffer` is not a PNG. */
export function pngSize(buffer) {
  const SIGNATURE = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== SIGNATURE) return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function render(svg, outputs, outDir) {
  const work = mkdtempSync(join(tmpdir(), "render-icons-"));
  const browser = await chromium.launch();
  try {
    for (const out of outputs) {
      const svgFile = join(work, `${out.size}-${out.fullBleed ? "full" : "tile"}.svg`);
      writeFileSync(svgFile, out.fullBleed ? fullBleed(svg) : svg);
      const html = join(work, `${out.size}-${out.fullBleed ? "full" : "tile"}.html`);
      writeFileSync(
        html,
        `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}img{display:block}</style></head>` +
          `<body><img id="icon" width="${out.size}" height="${out.size}" src="${pathToFileURL(svgFile).href}"></body></html>`,
      );
      const page = await browser.newPage({ viewport: { width: out.size, height: out.size }, deviceScaleFactor: 1 });
      await page.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
      await page.goto(pathToFileURL(html).href);
      await page.locator("#icon").evaluate((img) => img.decode());
      const png = await page.locator("#icon").screenshot({ omitBackground: !out.fullBleed, type: "png" });
      writeFileSync(join(outDir, out.file.replace(/\//g, "__")), png);
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const svg = readFileSync(join(REPO, MASTER), "utf8");
  const masterSha = sha256(Buffer.from(svg, "utf8"));
  const outDir = mkdtempSync(join(tmpdir(), "render-icons-out-"));
  await render(svg, OUTPUTS, outDir);

  const problems = [];
  const record = { $comment: `Rendered by scripts/design/render-icons.mjs from ${MASTER}; do not edit.`, master: MASTER, masterSha256: masterSha, outputs: [] };
  for (const out of OUTPUTS) {
    const rendered = readFileSync(join(outDir, out.file.replace(/\//g, "__")));
    const size = pngSize(rendered);
    if (!size || size.width !== out.size || size.height !== out.size) problems.push(`${out.file}: rendered ${JSON.stringify(size)}, expected ${out.size}×${out.size}`);
    record.outputs.push({ file: out.file, width: out.size, height: out.size, purpose: out.fullBleed ? "full-bleed" : "any" });
    if (check) {
      const target = join(REPO, out.file);
      if (!existsSync(target)) {
        problems.push(`${out.file}: missing (run node scripts/design/render-icons.mjs)`);
        continue;
      }
      const committed = pngSize(readFileSync(target));
      if (!committed || committed.width !== out.size || committed.height !== out.size) {
        problems.push(`${out.file}: committed PNG is ${JSON.stringify(committed)}, expected ${out.size}×${out.size}`);
      }
    } else {
      writeFileSync(join(REPO, out.file), rendered);
    }
  }
  rmSync(outDir, { recursive: true, force: true });

  if (check) {
    const recordFile = join(REPO, RECORD);
    const committed = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : null;
    if (!committed) problems.push(`${RECORD}: missing`);
    else if (committed.masterSha256 !== masterSha) problems.push(`${RECORD}: master SHA-256 differs from ${MASTER} (re-render the icons)`);
  } else {
    writeFileSync(join(REPO, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  }

  for (const p of problems) console.error(`render-icons: ${p}`);
  console.log(problems.length ? `render-icons: FAIL (${problems.length})` : check ? "render-icons: check PASS" : `render-icons: wrote ${OUTPUTS.length} PNGs and ${RECORD}`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
