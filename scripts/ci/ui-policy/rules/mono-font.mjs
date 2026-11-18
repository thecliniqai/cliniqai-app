/**
 * The approved type has no monospace face for product text: tokens, counts, IDs, phone numbers and money are Inter with
 * tabular figures (`tabular-nums`), token numbers Manrope (06-UI-SPEC Typography; `cliniq-ai.css` §3). V2-06 06-09e
 * (design review M4) moved every `font-mono` off the product screens; enforced so it does not come back. The one
 * exception is Developer settings (`components/settings/developer/`), where the monospace face sets machine strings
 * (API key prefixes, signing secrets, event names, JSON payloads) apart as code, until V2-12 rebuilds those screens.
 */
import { classTokens, utilityOf } from "../source.mjs";

const CODE_SCREENS = /(^|\/)components\/settings\/developer\//;

export default {
  id: "mono-font",
  mode: "enforce",
  reason: "monospace in product text; use tabular-nums (Inter) for numbers, IDs and phones (06-UI-SPEC Typography).",
  check(file, sourceFile) {
    if (CODE_SCREENS.test(file.replace(/\\/g, "/"))) return [];
    return classTokens(sourceFile)
      .filter(({ token }) => utilityOf(token) === "font-mono")
      .map(({ token, line }) => ({ line, detail: token }));
  },
};
