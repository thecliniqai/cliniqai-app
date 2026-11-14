/**
 * Pixel comparison for the value-neutral proof (V2-06 plan 06-01a step 7; R-24: no image library is added).
 *
 * `compareRgba` is the pure counting rule, unit-tested in tests/design/png-diff.spec.ts. `diffPngs` decodes two PNG
 * files inside a headless Chromium page (Playwright's bundled browser; `data:` only, every network request aborted)
 * and runs `compareRgba` there on the decoded RGBA buffers.
 *
 * A pixel "differs" when the largest of its four channel deltas exceeds `threshold` (default 8 of 255). When the two
 * images have different sizes, the overlapping area is compared and every pixel outside it counts as differing.
 */
import { readFileSync } from "node:fs";

export const DEFAULT_CHANNEL_THRESHOLD = 8;

/**
 * Counts differing pixels of two RGBA buffers.
 * @param {{ data: ArrayLike<number>, width: number, height: number }} a
 * @param {{ data: ArrayLike<number>, width: number, height: number }} b
 * @param {number} threshold largest allowed channel delta (0-255) for a pixel to count as equal
 * @returns {{ width: number, height: number, total: number, differing: number, ratio: number, sizeMismatch: boolean }}
 */
export function compareRgba(a, b, threshold) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const total = width * height;
  const ow = Math.min(a.width, b.width);
  const oh = Math.min(a.height, b.height);
  let differing = total - ow * oh;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(a.data[ia + c] - b.data[ib + c]) > threshold) {
          differing++;
          break;
        }
      }
    }
  }
  return {
    width,
    height,
    total,
    differing,
    ratio: total === 0 ? 0 : differing / total,
    sizeMismatch: a.width !== b.width || a.height !== b.height,
  };
}

/** Opens a page that can load nothing but `data:`/`blob:` URLs. */
export async function openDiffPage(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("data:") || url.startsWith("blob:") ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto("about:blank");
  return { page, close: () => context.close() };
}

/**
 * Decodes two PNG files in the page and compares them with `compareRgba`.
 * @returns {Promise<ReturnType<typeof compareRgba>>}
 */
export async function diffPngs(page, fileA, fileB, threshold = DEFAULT_CHANNEL_THRESHOLD) {
  const a = readFileSync(fileA).toString("base64");
  const b = readFileSync(fileB).toString("base64");
  return page.evaluate(
    async ({ a, b, threshold, compareSrc }) => {
      const compare = new Function(`return (${compareSrc})`)();
      const decode = async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return { data, width: bitmap.width, height: bitmap.height };
      };
      return compare(await decode(a), await decode(b), threshold);
    },
    { a, b, threshold, compareSrc: compareRgba.toString() },
  );
}
