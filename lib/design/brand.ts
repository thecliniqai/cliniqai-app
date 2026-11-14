/**
 * The product's name (PO ruling 2026-11-14: "CliniQ AI" is a fixed brand name; V2-06 06-01b step 4, R-41).
 *
 * Exact case. The AI-06 L1 checker masks exactly this string (`BRAND_NAME` in scripts/ci/ai-l1-greps.mjs), so it is
 * not read as an AI feature claim; any other spelling ("Cliniq AI", "CliniQ-AI") is checked as AI copy. Use this
 * constant for every surface V2-06 creates (manifest, titles, `/offline`, the shell); other strings that name the
 * product belong to their owner phases (G2-D addendum).
 */
export const PRODUCT_NAME = "CliniQ AI";
