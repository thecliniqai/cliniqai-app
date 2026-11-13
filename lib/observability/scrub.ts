/**
 * Error-sink scrubber (V2-03 03-09b, 03-13d M-SCRUB; P1-25, T-03-03, T-03-14). Everything an error carries into
 * `ops.error_events` or onto the server's stderr (`lib/observability/console-scrub.ts`) passes through here first; the
 * database re-scrubs as a second line with the same rule list (`SCRUB_RULES` ids; shared vectors in
 * `tests/fixtures/scrub-vectors.json`, which both layers' specs run).
 *
 * - {@link scrubMessage}: non-ASCII digits are normalised first (NFKC, then any other `\p{Nd}` → `0`), then
 *   {@link SCRUB_RULES} run in order; whitespace is collapsed and the result cut to {@link MAX_MESSAGE} characters
 *   (after scrubbing, so a cut never leaves part of an identifier unscrubbed).
 * - {@link scrubFrames}: stack frames as `file:line` only (no function names, no columns), relative to the repo,
 *   at most {@link MAX_FRAMES}; a frame outside the allowed character set is dropped.
 * - {@link routePattern}: the route pattern Next reports (`/r/[token]`), never a concrete path: anything after `?`
 *   or `#` is dropped, and a segment that is not a dynamic segment, a route group or a short lower-case static slug
 *   refuses the whole value.
 *
 * Names, addresses and other free text cannot be detected by pattern; they are kept out by storing only the error's
 * message (never request bodies, headers, cookies or query strings) and by the closed column set of the sink.
 */

export const MAX_MESSAGE = 500;
export const MAX_FRAMES = 20;
const MAX_FRAME = 200;
const MAX_ROUTE = 200;
/** Work bound on hostile input: text beyond this is never scanned (the result is cut to MAX_MESSAGE anyway). */
const MAX_SCAN = 8 * MAX_MESSAGE;

/** The characters a stored frame (`file:line`) may contain; the database checks the same set. */
export const FRAME_PATTERN = /^[A-Za-z0-9_./()[\]@~+:-]{1,200}:[0-9]{1,7}$/;
/** The characters a stored route pattern may contain; the database checks the same set. */
export const ROUTE_PATTERN = /^\/[A-Za-z0-9_./()[\]@~+-]{0,199}$/;

export interface ScrubRule {
  /** Stable id; the DB second line names its rules the same way (03-13c). */
  id: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * The canonical rule list. Ordered: row details and structured secrets first, so later rules never see half of a
 * value; generic number and token rules last. Every pattern is linear in the input (no nested unbounded repeats).
 */
export const SCRUB_RULES: ReadonlyArray<ScrubRule> = [
  // Postgres unique/foreign-key details carry row values: `Key (phone)=(+91…) already exists.` The column list (up to
  // 200 characters, nested parentheses allowed: expression indexes) is kept; everything from the value to the end of
  // the text is redacted, so a value containing `)` or a newline cannot leak its tail.
  { id: "pg_key_detail", pattern: /Key \(([^\n]{0,200}?)\)=\([\s\S]*/g, replacement: "Key ($1)=([REDACTED])" },
  // Check-constraint and not-null failures list the whole row (possibly over several lines).
  { id: "pg_failing_row", pattern: /Failing row contains \([\s\S]*/g, replacement: "Failing row contains ([REDACTED])" },
  // `invalid input syntax for type uuid: "…"`, `invalid input value for enum …: "…"`: the quoted value is input.
  { id: "quoted_value", pattern: /:\s*"[^"]*"/g, replacement: ': "[VALUE]"' },
  { id: "quoted_value_single", pattern: /:\s*'[^']*'/g, replacement: ": '[VALUE]'" },
  // Bearer credentials, JWTs and Supabase API keys (any alphabet; the prefix is enough).
  { id: "credential", pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "$1 [TOKEN]" },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, replacement: "[TOKEN]" },
  { id: "supabase_key", pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]*/g, replacement: "[KEY]" },
  // Emails, including IDN, `localhost` and ABHA-style `name@abdm` addresses (no TLD needed).
  { id: "email", pattern: /[^\s@<>"'(),;:[\]]+@[^\s@<>"'(),;:[\]]+/gu, replacement: "[EMAIL]" },
  // URL query strings and fragments (share tokens, phones, emails in `?phone=…`).
  { id: "query", pattern: /\?[^\s"'<>]+/g, replacement: "?[QUERY]" },
  { id: "fragment", pattern: /#[^\s"'<>]*=[^\s"'<>]*/g, replacement: "#[FRAGMENT]" },
  // Token segments of the public share/reschedule paths, whatever their alphabet.
  { id: "path_token", pattern: /\/(r|reschedule|api\/r|reports\/view)\/[^\s/?#"'<>]+/g, replacement: "/$1/[TOKEN]" },
  // UUIDs (tenant, patient, user ids).
  { id: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: "[UUID]" },
  // Long opaque tokens: 16+ characters of token alphabet with a digit and a letter, or 24+ with both letter cases.
  {
    id: "token",
    pattern: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[TOKEN]",
  },
  {
    id: "token_letters",
    pattern: /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{24,}\b/g,
    replacement: "[TOKEN]",
  },
  // PAN (AAAAA9999A).
  { id: "pan", pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, replacement: "[PAN]" },
  // ABHA number (14 digits as 2-4-4-4).
  { id: "abha_number", pattern: /\b\d{2}-\d{4}-\d{4}-\d{4}\b/g, replacement: "[ABHA REDACTED]" },
  // Indian mobiles: +91 / 0 prefixed, bare, spaced or dashed 5-5 and 3-3-4 groups (never the tail of a longer number).
  { id: "mobile", pattern: /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, replacement: "[PHONE REDACTED]" },
  {
    id: "mobile_3_3_4",
    pattern: /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{2}[\s-]\d{3}[\s-]\d{4}(?!\d)/g,
    replacement: "[PHONE REDACTED]",
  },
  // Aadhaar (12 digits as 4-4-4, any separator).
  { id: "aadhaar", pattern: /(?<!\d)\d{4}[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)/g, replacement: "[AADHAAR REDACTED]" },
  // Any other number of 8+ digits written with separators (`98-76-54-32-10`, `+91 (987) 654-3210`, `98765.43210`,
  // dates): each digit may be followed by up to three of space . - _ ( ).
  { id: "separated_number", pattern: /\+?\(?\d(?:[\s._()-]{0,3}\d){7,}\)?/g, replacement: "[NUMBER]" },
  // Any remaining run of 6+ digits (ids, account numbers, OTPs).
  { id: "digit_run", pattern: /\d{6,}/g, replacement: "[NUMBER]" },
];

/** Decimal digits outside ASCII after NFKC (Devanagari, Arabic-Indic, …): turned into `0` so the number rules see them. */
const OTHER_DIGIT = /(?![0-9])\p{Nd}/gu;

function toText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  return "";
}

/** Runs the rule list over `text` without the single-line / length shaping of {@link scrubMessage}. */
export function scrubText(text: string): string {
  let out = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  out = out.normalize("NFKC").replace(OTHER_DIGIT, "0");
  for (const rule of SCRUB_RULES) out = out.replace(rule.pattern, rule.replacement);
  return out;
}

/** The scrubbed, single-line, at most {@link MAX_MESSAGE}-character form of an error message. */
export function scrubMessage(input: unknown): string {
  const text = toText(input);
  if (!text) return "";
  const out = scrubText(text).replace(/\s+/g, " ").trim();
  return out.length > MAX_MESSAGE ? out.slice(0, MAX_MESSAGE) : out;
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

/**
 * A route segment that can only be part of a pattern: a dynamic segment (`[id]`, `[...slug]`, `[[...slug]]`), a route
 * group `(dashboard)`, a parallel-route slot `@modal`, or a lower-case static slug of at most 40 characters whose only
 * digits are a short version suffix (`api`, `v1`, `_not-found`, `favicon.ico`). A concrete id, phone or token segment
 * fails.
 */
const ROUTE_SEGMENT = /^(?:\[{1,2}(?:\.\.\.)?[A-Za-z0-9_]{1,40}\]{1,2}|\([a-z0-9_.-]{1,40}\)|@[a-z][a-z0-9_-]{0,39}|[a-z0-9_.-]{1,40})$/;
const DIGIT = /\d/;
/** A static segment with a digit must be a short slug (`v1`, `oauth2`): a longer one is token- or id-shaped. */
const SHORT_DIGIT_SLUG = /^[a-z]{1,6}\d{1,2}$/;

/** The route pattern without any query or fragment, or `null` if it is not a plain pattern. */
export function routePattern(input: unknown): `/${string}` | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const path = input.split(/[?#]/, 1)[0];
  if (path.length > MAX_ROUTE || !ROUTE_PATTERN.test(path)) return null;
  if (path === "/") return "/";
  const segments = path.slice(1).split("/");
  for (const segment of segments) {
    if (!ROUTE_SEGMENT.test(segment)) return null;
    if (!segment.startsWith("[") && DIGIT.test(segment) && !SHORT_DIGIT_SLUG.test(segment)) return null;
  }
  return path as `/${string}`;
}
