/**
 * The counting rule of the value-neutral proof (V2-06 06-01a step 7, scripts/design/png-diff.mjs): a pixel differs
 * when its largest channel delta exceeds the threshold; size mismatches count the non-overlapping area as differing.
 */
import { describe, expect, it } from "vitest";
import { compareRgba } from "../../scripts/design/png-diff.mjs";

type Rgba = [number, number, number, number];
function image(width: number, height: number, fill: Rgba, overrides: Record<number, Rgba> = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(overrides[i] ?? fill, i * 4);
  return { data, width, height };
}

describe("compareRgba", () => {
  const white: Rgba = [255, 255, 255, 255];

  it("equal images have no differing pixels", () => {
    const r = compareRgba(image(4, 3, white), image(4, 3, white), 8);
    expect(r).toMatchObject({ differing: 0, total: 12, ratio: 0, sizeMismatch: false });
  });

  it("a delta of exactly the threshold is equal; one more differs (largest channel decides)", () => {
    const a = image(2, 1, [100, 100, 100, 255]);
    const b = image(2, 1, [100, 100, 100, 255], { 0: [108, 100, 100, 255], 1: [100, 100, 91, 255] });
    const r = compareRgba(a, b, 8);
    expect(r.differing).toBe(1);
    expect(r.ratio).toBe(0.5);
  });

  it("an alpha-only change counts", () => {
    const r = compareRgba(image(1, 1, white), image(1, 1, [255, 255, 255, 0]), 8);
    expect(r.differing).toBe(1);
  });

  it("a size mismatch compares the overlap and counts every other pixel as differing", () => {
    const r = compareRgba(image(2, 2, white), image(2, 3, white), 8);
    expect(r).toMatchObject({ width: 2, height: 3, total: 6, differing: 2, sizeMismatch: true });
  });
});
