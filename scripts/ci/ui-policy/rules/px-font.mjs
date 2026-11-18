/** DESIGN_SYSTEM §3.2, §10: font sizes come from the type scale (`text-caption` …), never `text-[11px]`. */
import { classTokens, utilityOf } from "../source.mjs";

const PX_FONT = /^text-\[\d+(\.\d+)?(px|rem|em)\]$/;

export default {
  id: "px-font",
  mode: "report",
  reason: "Arbitrary font size; use the type scale (DESIGN_SYSTEM §3.2).",
  check(file, sourceFile) {
    return classTokens(sourceFile)
      .filter(({ token }) => PX_FONT.test(utilityOf(token)))
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
