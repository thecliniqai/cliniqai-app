import { useId } from "react";
import { PRODUCT_NAME } from "@/lib/design/brand";

/**
 * The CliniQ AI mark (V2-06 06-01b step 5; brand kit v1.0 via V2-DX `3a78a5d`): a blue-to-teal ring, the Q, around a
 * Midnight stethoscope whose tube is the tail. Geometry is `shared/proto.js` `mark()` at `3a78a5d`, which equals the
 * kit's `02-mark/svg/cliniq-ai-mark-color.svg` and `cliniq-ai-mark-small-color.svg`.
 *
 * - At `size` ≥ 32 px the full mark draws; below 32 px the small mark (no earpieces, heavier strokes), the kit's rule.
 * - The colours are literal here and only here: the brand forbids recolouring the logo, so they are not theme tokens.
 * - Each instance takes its gradient id from `useId()`, so two marks on one page never share an id.
 * - It is an image named "CliniQ AI" unless `decorative` (next to a visible product name): then it is hidden from
 *   assistive technology.
 *
 * Works in Server and Client Components (no state, no effects).
 */

const RING_FROM = "#246BCE"; // CliniQ Blue
const RING_TO = "#2CBDAF"; // Care Teal, light end of the ring gradient
const INK = "#0B1A42"; // Midnight

export type MarkElement =
  | { tag: "path"; d: string; strokeWidth: number; paint: "ring" | "ink" }
  | { tag: "circle"; cx: number; cy: number; r: number; strokeWidth?: number; paint: "ink" | "ink-fill" };

/** The two drawings of the mark, in the order the brand files draw them (viewBox `4 4 86 86`). */
export const MARK_GEOMETRY: { full: readonly MarkElement[]; small: readonly MarkElement[] } = {
  full: [
    { tag: "path", d: "M34.88 80.24A36 36 0 1 1 81.21 53.48", strokeWidth: 10, paint: "ring" },
    { tag: "path", d: "M35 30V43C35 52.5 40.5 58 46 58C51.5 58 57 52.5 57 43V30", strokeWidth: 4.6, paint: "ink" },
    { tag: "circle", cx: 35, cy: 28.5, r: 3.9, paint: "ink-fill" },
    { tag: "circle", cx: 57, cy: 28.5, r: 3.9, paint: "ink-fill" },
    { tag: "path", d: "M46 58V65C46 75.5 53 82 63 82H71", strokeWidth: 4.6, paint: "ink" },
    { tag: "circle", cx: 78.5, cy: 82, r: 6.6, strokeWidth: 4.4, paint: "ink" },
  ],
  small: [
    { tag: "path", d: "M32.51 79.38A36 36 0 1 1 81.65 51.01", strokeWidth: 13, paint: "ring" },
    { tag: "path", d: "M34 28V42C34 53 40 58 46 58C52 58 58 53 58 42V28", strokeWidth: 7.5, paint: "ink" },
    { tag: "path", d: "M46 58V64C46 75 53 82 63 82H70", strokeWidth: 7.5, paint: "ink" },
    { tag: "circle", cx: 78, cy: 82, r: 7, strokeWidth: 6.5, paint: "ink" },
  ],
};

/** Below this size the small mark draws (brand kit: "use mark-small below 32 px"). */
export const SMALL_MARK_BELOW = 32;

export interface BrandMarkProps {
  /** Rendered width and height in CSS pixels. */
  size?: number;
  /** Hide from assistive technology (use when the product name is visible next to the mark). */
  decorative?: boolean;
  className?: string;
}

export function BrandMark({ size = 36, decorative = false, className }: BrandMarkProps) {
  const gradientId = `cq-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const elements = size < SMALL_MARK_BELOW ? MARK_GEOMETRY.small : MARK_GEOMETRY.full;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": PRODUCT_NAME };
  return (
    <svg
      width={size}
      height={size}
      viewBox="4 4 86 86"
      className={className}
      focusable="false"
      data-mark={size < SMALL_MARK_BELOW ? "small" : "full"}
      {...a11y}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={RING_FROM} />
          <stop offset="1" stopColor={RING_TO} />
        </linearGradient>
      </defs>
      {elements.map((el, i) => {
        if (el.tag === "path") {
          const stroke = el.paint === "ring" ? `url(#${gradientId})` : INK;
          return <path key={i} d={el.d} fill="none" stroke={stroke} strokeWidth={el.strokeWidth} strokeLinecap="round" />;
        }
        return el.paint === "ink-fill" ? (
          <circle key={i} cx={el.cx} cy={el.cy} r={el.r} fill={INK} />
        ) : (
          <circle key={i} cx={el.cx} cy={el.cy} r={el.r} fill="none" stroke={INK} strokeWidth={el.strokeWidth} />
        );
      })}
    </svg>
  );
}
