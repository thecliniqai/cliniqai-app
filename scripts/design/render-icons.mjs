#!/usr/bin/env node
/**
 * App icon renderer (V2-06 06-05 step 4; revised by 06-01b step 5, rulings R-24 and R-42; PWA_STRATEGY §3.1).
 * Renders the approved CliniQ AI masters with Playwright's Chromium (an existing devDependency; no image library):
 *
 *   master scripts/design/brand/icon.svg           (V2-DX 3a78a5d 002-icon/icon.svg, verbatim: white rounded tile)
 *     public/icon-192.png           192×192  purpose "any"       rounded tile, transparent corners
 *     public/icon-512.png           512×512  purpose "any"
 *     app/apple-icon.png            180×180  opaque               transparent corners filled with the tile colour
 *                                                                (iOS rounds the corners itself and shows no alpha)
 *   master scripts/design/brand/icon-maskable.svg  (V2-DX 3a78a5d 002-icon/icon-maskable.svg, verbatim: full-bleed)
 *     public/icon-maskable-512.png  512×512  purpose "maskable"  the mark inside the 80 % safe zone
 *
 * The SVG favicon `app/icon.svg` is not rendered: it is the brand kit's small-mark favicon, vendored verbatim (CTO
 * ruling in the G2-D addendum 2026-11-14: the small mark below 32 px). `public/icons.json` records the SHA-256 of both
 * masters and the favicon with their sources; each must equal the approved value below (06-PLAN revision note).
 *
 * Chromium loads only `file:` URLs; every other request is aborted, so rendering never touches the network.
 *
 * Usage: node scripts/design/render-icons.mjs [--check]
 *   --check  re-renders into a temp dir and exits 1 when a committed PNG is missing or not its table size, a master or
 *            the favicon differs from its approved SHA-256 or from `public/icons.json`, or a committed PNG's corner
 *            pixels are wrong (Apple and maskable: opaque tile colour; 192/512 "any": transparent). Other pixels are
 *            not compared: Chromium's anti-aliasing differs across platforms.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RECORD = "public/icons.json";

/** The tile colour of the approved masters (`--pwa-icon-tile`, mirrored as `iconTile` in lib/design/tokens.ts). */
export const TILE = "#ffffff";

/** Approved inputs: path in the repo, SHA-256 (06-PLAN revision note 2026-11-14 / G2-D addendum), source. */
export const MASTERS = {
  icon: {
    file: "scripts/design/brand/icon.svg",
    sha256: "d00c53383cf1b983e3a43d211bdf3b885b8838ac128d3edc13df0f76218cd179",
    source: "v2/phase-dx-design-exploration 3a78a5d:.planning/sketches/002-icon/icon.svg (verbatim)",
  },
  maskable: {
    file: "scripts/design/brand/icon-maskable.svg",
    sha256: "ae10346ea5b93d7ef61d2ab1d6fe0c7d922e6d790ef3fed4b32d79b01e16af53",
    source: "v2/phase-dx-design-exploration 3a78a5d:.planning/sketches/002-icon/icon-maskable.svg (verbatim)",
  },
};
export const FAVICON = {
  file: "app/icon.svg",
  sha256: "83acd5aef745527cdced68d7a30d59e70e96a2a916cf564f711759a36f8d3f6f",
  source: "CliniQ AI brand kit v1.0 03-favicon/favicon.svg (verbatim; mark-small geometry = 3a78a5d shared/proto.js mark() below 32 px)",
};

/**
 * Output path, pixel size, master, and what its corners must be: "transparent" (rounded tile, purpose any) or
 * "opaque" (Apple: corners filled with TILE; maskable: the master is full-bleed already).
 */
export const OUTPUTS = [
  { file: "public/icon-192.png", size: 192, master: "icon", corners: "transparent", purpose: "any" },
  { file: "public/icon-512.png", size: 512, master: "icon", corners: "transparent", purpose: "any" },
  { file: "public/icon-maskable-512.png", size: 512, master: "maskable", corners: "opaque", purpose: "maskable" },
  { file: "app/apple-icon.png", size: 180, master: "icon", corners: "opaque", purpose: "apple-touch-icon" },
];

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Width and height from a PNG's IHDR chunk, or null when `buffer` is not a PNG. */
export function pngSize(buffer) {
  const SIGNATURE = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== SIGNATURE) return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what Chromium's screenshots are) into RGBA rows.
 * Returns { width, height, pixel(x, y) -> [r, g, b, a] }. Throws on any other PNG kind.
 */
export function decodePng(buffer) {
  const size = pngSize(buffer);
  if (!size) throw new Error("not a PNG");
  const ihdr = buffer.subarray(16, 29);
  const [depth, colourType, , , interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
  if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType}, interlace ${interlace})`);
  }
  const channels = colourType === 6 ? 4 : 3;
  const idat = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.subarray(at + 4, at + 8).toString("ascii");
    if (type === "IDAT") idat.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const data = inflateSync(Buffer.concat(idat));
  const stride = size.width * channels;
  const out = Buffer.alloc(size.height * stride);
  for (let y = 0; y < size.height; y++) {
    const filter = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const raw = data[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v;
      if (filter === 0) v = raw;
      else if (filter === 1) v = raw + a;
      else if (filter === 2) v = raw + b;
      else if (filter === 3) v = raw + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${filter}`);
      out[y * stride + x] = v & 0xff;
    }
  }
  return {
    ...size,
    pixel(x, y) {
      const i = y * stride + x * channels;
      return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255];
    },
  };
}

const hex = ([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** Problems with the four corner pixels of a rendered icon, given what its corners must be. */
export function cornerProblems(buffer, corners, tile = TILE) {
  const png = decodePng(buffer);
  const problems = [];
  const points = [
    [0, 0],
    [png.width - 1, 0],
    [0, png.height - 1],
    [png.width - 1, png.height - 1],
  ];
  for (const [x, y] of points) {
    const px = png.pixel(x, y);
    if (corners === "opaque" && (px[3] !== 255 || hex(px) !== tile)) problems.push(`corner ${x},${y} is ${hex(px)} alpha ${px[3]}, expected opaque ${tile}`);
    if (corners === "transparent" && px[3] !== 0) problems.push(`corner ${x},${y} has alpha ${px[3]}, expected 0 (rounded tile)`);
  }
  return problems;
}

async function render(outDir) {
  const { chromium } = await import("@playwright/test");
  const work = mkdtempSync(join(tmpdir(), "render-icons-"));
  const browser = await chromium.launch();
  try {
    for (const out of OUTPUTS) {
      const svgFile = join(REPO, MASTERS[out.master].file);
      const fill = out.corners === "opaque" ? TILE : "transparent";
      const html = join(work, `${out.size}-${out.master}.html`);
      writeFileSync(
        html,
        `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:${fill}}img{display:block}</style></head>` +
          `<body><img id="icon" width="${out.size}" height="${out.size}" src="${pathToFileURL(svgFile).href}"></body></html>`,
      );
      const page = await browser.newPage({ viewport: { width: out.size, height: out.size }, deviceScaleFactor: 1 });
      await page.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
      await page.goto(pathToFileURL(html).href);
      await page.locator("#icon").evaluate((img) => img.decode());
      const png = await page.locator("#icon").screenshot({ omitBackground: out.corners === "transparent", type: "png" });
      writeFileSync(join(outDir, out.file.replace(/\//g, "__")), png);
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

/** The record `public/icons.json` holds for the current inputs. */
export function iconRecord() {
  const entry = (m) => ({ file: m.file, sha256: sha256(readFileSync(join(REPO, m.file))), source: m.source });
  return {
    $comment: "Rendered by scripts/design/render-icons.mjs from the approved masters; do not edit.",
    masters: { icon: entry(MASTERS.icon), maskable: entry(MASTERS.maskable) },
    favicon: entry(FAVICON),
    outputs: OUTPUTS.map((o) => ({ file: o.file, width: o.size, height: o.size, master: MASTERS[o.master].file, purpose: o.purpose, corners: o.corners })),
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const problems = [];
  for (const input of [MASTERS.icon, MASTERS.maskable, FAVICON]) {
    const actual = sha256(readFileSync(join(REPO, input.file)));
    if (actual !== input.sha256) problems.push(`${input.file}: SHA-256 ${actual} is not the approved ${input.sha256}`);
  }
  const outDir = mkdtempSync(join(tmpdir(), "render-icons-out-"));
  await render(outDir);

  for (const out of OUTPUTS) {
    const rendered = readFileSync(join(outDir, out.file.replace(/\//g, "__")));
    const size = pngSize(rendered);
    if (!size || size.width !== out.size || size.height !== out.size) problems.push(`${out.file}: rendered ${JSON.stringify(size)}, expected ${out.size}×${out.size}`);
    for (const p of cornerProblems(rendered, out.corners)) problems.push(`${out.file} (rendered): ${p}`);
    if (check) {
      const target = join(REPO, out.file);
      if (!existsSync(target)) {
        problems.push(`${out.file}: missing (run node scripts/design/render-icons.mjs)`);
        continue;
      }
      const committed = readFileSync(target);
      const committedSize = pngSize(committed);
      if (!committedSize || committedSize.width !== out.size || committedSize.height !== out.size) {
        problems.push(`${out.file}: committed PNG is ${JSON.stringify(committedSize)}, expected ${out.size}×${out.size}`);
      } else {
        for (const p of cornerProblems(committed, out.corners)) problems.push(`${out.file}: ${p}`);
      }
    } else {
      writeFileSync(join(REPO, out.file), rendered);
    }
  }
  rmSync(outDir, { recursive: true, force: true });

  const record = iconRecord();
  if (check) {
    const recordFile = join(REPO, RECORD);
    const committed = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : null;
    if (!committed) problems.push(`${RECORD}: missing`);
    else if (JSON.stringify(committed) !== JSON.stringify(record)) problems.push(`${RECORD}: differs from the current masters (re-render the icons)`);
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
