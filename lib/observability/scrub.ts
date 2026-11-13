/**
 * Error-sink scrubber (V2-03 03-09b, P1-25, T-03-03, T-03-14). Everything an error carries into `ops.error_events`
 * passes through here first; the database re-scrubs emails, query strings and digit runs as a second line.
 *
 * - {@link scrubMessage}: Postgres row details (`Key (…)=(…)`, `Failing row contains (…)`), quoted values after a
 *   colon, emails, URL query strings, UUIDs, JWTs, bearer credentials, long tokens, PAN, Indian mobiles (with
 *   `stripPiiFromText` for +91/bare mobiles, Aadhaar and ABHA, plus spaced and 0-prefixed mobiles) and digit runs of
 *   6 or more; then whitespace is collapsed and the result cut to {@link MAX_MESSAGE} characters.
 * - {@link scrubFrames}: stack frames as `file:line` only (no function names, no columns), relative to the repo,
 *   at most {@link MAX_FRAMES}; a frame outside the allowed character set is dropped.
 * - {@link routePattern}: the route pattern Next reports (`/r/[token]`), never a concrete path; anything after `?`
 *   or `#` is dropped and a value outside the allowed character set is refused.
 *
 * Names, addresses and other free text cannot be detected by pattern; they are kept out by storing only the error's
 * message (never request bodies, headers, cookies or query strings) and by the closed column set of the sink.
 */
import { stripPiiFromText } from "@/lib/ai/sanitizer";

export const MAX_MESSAGE = 500;
export const MAX_FRAMES = 20;
const MAX_FRAME = 200;
const MAX_ROUTE = 200;

/** The characters a stored frame (`file:line`) may contain; the database checks the same set. */
export const FRAME_PATTERN = /^[A-Za-z0-9_./()[\]@~+:-]{1,200}:[0-9]{1,7}$/;
/** The characters a stored route pattern may contain; the database checks the same set. */
export const ROUTE_PATTERN = /^\/[A-Za-z0-9_./()[\]@~+-]{0,199}$/;

/** Ordered: details and structured secrets first, so later rules never see half of a value. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Postgres unique/foreign-key details carry row values: `Key (phone)=(+91…) already exists.` Greedy to the line's
  // last `)`, so a value containing `)` cannot leak its tail.
  [/Key \(([^)\n]*)\)=\(.*\)/g, "Key ($1)=([REDACTED])"],
  // Check-constraint and not-null failures list the whole row.
  [/Failing row contains \(.*\)/g, "Failing row contains ([REDACTED])"],
  // `invalid input syntax for type uuid: "…"`, `invalid input value for enum …: "…"`: the quoted value is input.
  [/:\s*"[^"\n]*"/g, ': "[VALUE]"'],
  [/:\s*'[^'\n]*'/g, ": '[VALUE]'"],
  // Bearer credentials and JWTs.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, "[TOKEN]"],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  // URL query strings and fragments (share tokens, phones, emails in `?phone=…`).
  [/\?[^\s"'<>]+/g, "?[QUERY]"],
  [/#[^\s"'<>]*=[^\s"'<>]*/g, "#[FRAGMENT]"],
  // UUIDs (tenant, patient, user ids).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[UUID]"],
  // Long opaque tokens: 16+ characters of token alphabet with at least one digit and one letter.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, "[TOKEN]"],
  // PAN (AAAAA9999A).
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, "[PAN]"],
];

/** Mobiles that `stripPiiFromText` misses: spaced or dashed groups, 0- and +91-prefixed. */
const SPACED_MOBILE = /(?:\+?91[\s-]?|\b0)?[6-9]\d{4}[\s-]\d{5}\b/g;
const SPACED_MOBILE_ALT = /(?:\+?91[\s-]?|\b0)?[6-9]\d{2}[\s-]\d{3}[\s-]\d{4}\b/g;
/** Any remaining run of 6+ digits (ids, account numbers, unspaced Aadhaar fragments). */
const DIGIT_RUN = /\d{6,}/g;

function toText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  return "";
}

/** The scrubbed, single-line, at most {@link MAX_MESSAGE}-character form of an error message. */
export function scrubMessage(input: unknown): string {
  let text = toText(input);
  if (!text) return "";
  // Bound the work on hostile input before running the patterns.
  if (text.length > 8 * MAX_MESSAGE) text = text.slice(0, 8 * MAX_MESSAGE);
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  text = text.replace(SPACED_MOBILE, "[PHONE REDACTED]").replace(SPACED_MOBILE_ALT, "[PHONE REDACTED]");
  text = stripPiiFromText(text);
  text = text.replace(DIGIT_RUN, "[NUMBER]");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_MESSAGE ? text.slice(0, MAX_MESSAGE) : text;
}

/** `/abs/repo/.next/server/x.js` → `.next/server/x.js`; outside the repo only the last two segments are kept. */
function relativeFile(file: string, root: string): string {
  let f = file.replace(/^file:\/\//, "").replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, "");
  f = f.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "");
  const base = root.endsWith("/") ? root : `${root}/`;
  if (f.startsWith(base)) return f.slice(base.length);
  if (f.startsWith("/")) return f.split("/").filter(Boolean).slice(-2).join("/");
  return f;
}

/** Frames `file:line` from a stack, relative to `root`, at most {@link MAX_FRAMES}. Never throws. */
export function scrubFrames(stack: unknown, root: string): string[] {
  if (typeof stack !== "string" || stack.length === 0) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n").slice(0, 200)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    // `at fn (file:line:col)` or `at file:line:col`; the function name and column are dropped. Route-group folders
    // (`app/(dashboard)/…`) keep their parentheses: the location starts after the last " (".
    const location = trimmed.endsWith(")") && trimmed.includes(" (")
      ? trimmed.slice(trimmed.lastIndexOf(" (") + 2, -1)
      : trimmed.slice(3);
    const match = /^(.+):(\d+):\d+$/.exec(location);
    if (!match) continue;
    const frame = `${relativeFile(match[1], root)}:${match[2]}`;
    if (frame.length <= MAX_FRAME && FRAME_PATTERN.test(frame)) frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** The route pattern without any query or fragment, or `null` if it is not a plain pattern. */
export function routePattern(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const path = input.split(/[?#]/, 1)[0];
  if (path.length > MAX_ROUTE || !ROUTE_PATTERN.test(path)) return null;
  return path;
}
