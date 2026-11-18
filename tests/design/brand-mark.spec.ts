/**
 * BrandMark (V2-06 06-01b step 5). Rendered with react-dom/server (no jsdom), as tests/components/phone-input.spec.ts:
 * the small geometry below 32 px and the full one from 32 px, a distinct gradient per instance that each ring names,
 * the accessible name "CliniQ AI" or none when decorative, and the full geometry equal to the approved icon master's.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark, MARK_GEOMETRY } from "@/components/brand/brand-mark";
import { PRODUCT_NAME } from "@/lib/design/brand";

const render = (props: Parameters<typeof BrandMark>[0]) => renderToStaticMarkup(createElement(BrandMark, props));
const circles = (html: string) => [...html.matchAll(/<circle\b[^>]*>/g)].map((m) => m[0]);

/** The drawable elements of an SVG string, in the MARK_GEOMETRY shape. */
function drawn(svg: string) {
  return [...svg.matchAll(/<(path|circle)\b([^>]*?)\/?>/g)].map((m) => {
    const a = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const width = a["stroke-width"] === undefined ? undefined : Number(a["stroke-width"]);
    return m[1] === "path"
      ? { tag: "path", d: a.d.replace(/\s+(?=[A-Z])/g, ""), strokeWidth: width, paint: a.stroke.startsWith("url(") ? "ring" : "ink" }
      : { tag: "circle", cx: Number(a.cx), cy: Number(a.cy), r: Number(a.r), ...(width === undefined ? {} : { strokeWidth: width }), paint: a.fill === "none" ? "ink" : "ink-fill" };
  });
}

describe("BrandMark", () => {
  it("draws the small mark below 32 px (no earpieces) and the full mark from 32 px", () => {
    const small = render({ size: 24 });
    expect(small).toContain('data-mark="small"');
    expect(circles(small)).toHaveLength(1); // the chest piece only
    expect(small).toContain('width="24"');
    expect(drawn(small)).toEqual(MARK_GEOMETRY.small);

    const full = render({ size: 36 });
    expect(full).toContain('data-mark="full"');
    expect(circles(full)).toHaveLength(3); // two earpieces + the chest piece
    expect(drawn(full)).toEqual(MARK_GEOMETRY.full);

    expect(render({ size: 31 })).toContain('data-mark="small"');
    expect(render({ size: 32 })).toContain('data-mark="full"');
  });

  it("gives two marks in one tree distinct gradient ids, and each ring paints with its own gradient", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, createElement(BrandMark, { size: 36 }), createElement(BrandMark, { size: 20 })));
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const svgs = html.split("</svg>").filter((s) => s.includes("<svg"));
    svgs.forEach((svg, i) => {
      const refs = [...svg.matchAll(/stroke="url\(#([^)]+)\)"/g)].map((m) => m[1]);
      expect(refs).toEqual([ids[i]]);
      expect(svg).toContain(`<linearGradient id="${ids[i]}"`);
    });
  });

  it('is an image named "CliniQ AI", or hidden from assistive technology when decorative', () => {
    const named = render({ size: 44 });
    expect(PRODUCT_NAME).toBe("CliniQ AI");
    expect(named).toMatch(/<svg[^>]*role="img"/);
    expect(named).toMatch(/<svg[^>]*aria-label="CliniQ AI"/);
    expect(named).not.toContain("aria-hidden");

    const decorative = render({ size: 56, decorative: true });
    expect(decorative).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(decorative).not.toContain("aria-label");
    expect(decorative).not.toContain('role="img"');
  });

  it("draws the brand colours (ring CliniQ Blue to Care Teal, Midnight stethoscope), not theme tokens", () => {
    const html = render({ size: 36 });
    expect(html).toContain('stop-color="#246BCE"');
    expect(html).toContain('stop-color="#2CBDAF"');
    expect(html).toContain('stroke="#0B1A42"');
    expect(html).not.toContain("var(--");
  });

  it("the full geometry is the approved icon master's mark, element for element", () => {
    const master = fs.readFileSync(path.join(process.cwd(), "scripts/design/brand/icon.svg"), "utf8");
    expect(drawn(master)).toEqual(MARK_GEOMETRY.full);
  });
});
