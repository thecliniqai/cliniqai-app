/** DESIGN_SYSTEM §10: no arbitrary colour values in classes (`bg-[#1769e0]`, `text-[rgb(...)]`); use semantic tokens. */
import { classTokens, utilityOf } from "../source.mjs";

const ARBITRARY_COLOR = /^[a-z-]+-\[(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|color)\([^\]]*\))\](\/[^\s]*)?$/;

export default {
  id: "arbitrary-color",
  mode: "report",
  reason: "Arbitrary colour in a class; use a semantic token utility (DESIGN_SYSTEM §2.3, §10).",
  check(file, sourceFile) {
    return classTokens(sourceFile)
      .filter(({ token }) => ARBITRARY_COLOR.test(utilityOf(token)))
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
