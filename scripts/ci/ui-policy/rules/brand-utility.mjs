/**
 * The v1 `brand-*` scale was deleted from app/globals.css by V2-06 06-01a; a `brand-<step>` class would now render
 * nothing. Enforced.
 */
import { classTokens, utilityOf } from "../source.mjs";

const BRAND = /(^|-)brand-\d{2,3}(\/[^\s]*)?$/;

export default {
  id: "brand-utility",
  mode: "enforce",
  reason: "brand-* utilities no longer exist (scale deleted in 06-01a); use accent / accent-* semantic utilities.",
  check(file, sourceFile) {
    return classTokens(sourceFile)
      .filter(({ token }) => BRAND.test(utilityOf(token)))
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
