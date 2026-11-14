/**
 * PWA_STRATEGY §3.5: full-height layouts use dynamic viewport units (`min-h-dvh`), never `100vh` (`h-screen`,
 * `min-h-screen`), which the mobile URL bar and keyboard break. Report mode until 06-04a moves the sites and flips it.
 */
import { classTokens, utilityOf } from "../source.mjs";

const SCREEN = /^(min-h|h|max-h)-(screen|\[100vh\])$/;

export default {
  id: "screen-height",
  mode: "report",
  reason: "100vh height; use the dvh utilities (PWA_STRATEGY §3.5).",
  check(file, sourceFile) {
    return classTokens(sourceFile)
      .filter(({ token }) => SCREEN.test(utilityOf(token)) || /\b100vh\b/.test(token))
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
