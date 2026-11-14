/**
 * DESIGN_SYSTEM §2.3, §10: components use semantic colour utilities only. Reports Tailwind default-palette colour
 * utilities everywhere, and raw `v1-*` token utilities outside components/ui/** (the primitives). The palette reset
 * (`--color-*: initial`, FRONTEND_MIGRATION_PLAN M5) is what finally removes them.
 */
import { classTokens, utilityOf } from "../source.mjs";

const PROPS = String.raw`(bg|text|border(?:-[xytrblse])?|outline|ring|ring-offset|divide|from|via|to|fill|stroke|decoration|caret|placeholder|accent|shadow)`;
const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE = new RegExp(String.raw`^${PROPS}-((${HUES})-(50|[1-9]00|950)|black|white)(\/[^\s]*)?$`);
const RAW_V1 = new RegExp(String.raw`^${PROPS}-v1-[a-z0-9-]+(\/[^\s]*)?$`);

export default {
  id: "raw-palette",
  mode: "report",
  reason: "Raw palette colour utility; use a semantic token utility (DESIGN_SYSTEM §2.3).",
  check(file, sourceFile) {
    const primitives = file.startsWith("components/ui/");
    return classTokens(sourceFile)
      .filter(({ token }) => {
        const u = utilityOf(token);
        return PALETTE.test(u) || (!primitives && RAW_V1.test(u));
      })
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
