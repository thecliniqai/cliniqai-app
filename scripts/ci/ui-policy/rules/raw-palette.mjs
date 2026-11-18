/**
 * DESIGN_SYSTEM §2.3, §10: components use semantic colour utilities only. Reports Tailwind default-palette colour
 * utilities everywhere, and raw `v1-*` token utilities outside components/ui/** (the primitives). The palette reset
 * (`--color-*: initial`, FRONTEND_MIGRATION_PLAN M5) is what finally removes them.
 *
 * V2-06 06-08 (06-01b wave note): the approved CliniQ AI raw layer (`app/globals.css` first `@theme` block: `mineral-*`,
 * `primary-*`, `brass-*`, `teal-550`, `success|warning|danger|info-50/600`, `focus`, `focus-halo`) is reported
 * everywhere, primitives included: those names exist only to feed the semantic layer. Their Tailwind look-alikes
 * (`teal-50` … `teal-700`, `white`) are already default-palette names above. Semantic names that share a prefix
 * (`success-bg`, `danger-solid`, `ring-halo`, the `focus-ring` utility) are not raw and stay unreported.
 */
import { classTokens, utilityOf } from "../source.mjs";

const PROPS = String.raw`(bg|text|border(?:-[xytrblse])?|outline|ring|ring-offset|divide|from|via|to|fill|stroke|decoration|caret|placeholder|accent|shadow)`;
const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE = new RegExp(String.raw`^${PROPS}-((${HUES})-(50|[1-9]00|950)|black|white)(\/[^\s]*)?$`);
const RAW_V1 = new RegExp(String.raw`^${PROPS}-v1-[a-z0-9-]+(\/[^\s]*)?$`);
const RAW_APPROVED = new RegExp(
  String.raw`^${PROPS}-((mineral|primary|brass)-\d+|teal-550|(success|warning|danger|info)-(50|600)|focus(-halo)?)(\/[^\s]*)?$`,
);

export default {
  id: "raw-palette",
  mode: "report",
  reason: "Raw palette colour utility; use a semantic token utility (DESIGN_SYSTEM §2.3).",
  check(file, sourceFile) {
    const primitives = file.startsWith("components/ui/");
    return classTokens(sourceFile)
      .filter(({ token }) => {
        const u = utilityOf(token);
        return PALETTE.test(u) || RAW_APPROVED.test(u) || (!primitives && RAW_V1.test(u));
      })
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
