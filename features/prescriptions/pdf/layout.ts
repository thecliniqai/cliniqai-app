import type { PrescriptionPdfPayload } from "./types";

/**
 * The page geometry of a printed prescription (V2-09c 09C-04, R-12), shared by the PDF document and the print view so the two honour the same paper and the
 * same margins. Pure and isomorphic. Lengths are in points (the PDF's unit; CSS `pt` is the same).
 */

/** The paper sizes' scale for every length (A4 is the design size) and the page heights the margins are checked against, in points. */
export const PAPER = { A4: { scale: 1, height: 841.89 }, A5: { scale: 0.9, height: 595.28 } } as const;
export const DEFAULT_TOP_MARGIN = 110;
export const DEFAULT_BOTTOM_MARGIN = 60;
/** The least of the page that must stay for the prescription itself, whatever the margins say (the settings refuse more; this keeps a stored value from blanking a page). */
export const MIN_CONTENT_HEIGHT = 220;

/** The margins to honour on pre-printed paper: the clinic's own (points), each within 0..300, and together leaving room for the prescription. */
export function effectiveMargins(payload: Pick<PrescriptionPdfPayload, "letterhead_margins" | "paper_size">): { top: number; bottom: number } {
  const pageHeight = PAPER[payload.paper_size === "A5" ? "A5" : "A4"].height;
  const clamp = (n: number | undefined, fallback: number) => Math.min(300, Math.max(0, Number.isFinite(n) ? (n as number) : fallback));
  let top = clamp(payload.letterhead_margins?.top, DEFAULT_TOP_MARGIN);
  let bottom = clamp(payload.letterhead_margins?.bottom, DEFAULT_BOTTOM_MARGIN);
  const room = pageHeight - MIN_CONTENT_HEIGHT;
  if (top + bottom > room) {
    const ratio = room / (top + bottom);
    top = Math.floor(top * ratio);
    bottom = Math.floor(bottom * ratio);
  }
  return { top, bottom };
}

