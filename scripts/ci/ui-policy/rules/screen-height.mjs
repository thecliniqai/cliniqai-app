/**
 * PWA_STRATEGY §3.3/§3.5: full-height layouts use the dynamic-viewport utilities `min-h-app`/`h-app` (app/globals.css,
 * `dvh` with a `vh` fallback), never `100vh` (`h-screen`, `min-h-screen`, `max-h-screen`, `[100vh]`), which the mobile
 * URL bar and keyboard break. Enforced since 06-04a moved the 20 v1 sites (PWA §10 "0 `min-h-screen`/`h-screen`").
 */
import { classTokens, utilityOf } from "../source.mjs";

const SCREEN = /^(min-h|h|max-h)-(screen|\[100vh\])$/;

export default {
  id: "screen-height",
  mode: "enforce",
  reason: "100vh height; use min-h-app / h-app (dvh with a vh fallback; PWA_STRATEGY §3.3).",
  check(file, sourceFile) {
    return classTokens(sourceFile)
      .filter(({ token }) => SCREEN.test(utilityOf(token)) || /\b100vh\b/.test(token))
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
