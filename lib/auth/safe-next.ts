/**
 * Safe post-sign-in redirect target (V2-03 03-12c; AUTH-04b, threat T-03-04 open redirect).
 *
 * `/login?next=<path>` (set by `proxy.ts` for a signed-out page request) may send the user back only to a page of
 * this app. `safeNextPath(raw)` returns a same-origin path (`/patients?tab=1#x`) or `null`; the caller falls back to
 * its default page. Client-safe: no server imports.
 *
 * Accepted: a string of at most {@link MAX_NEXT_LENGTH} characters that starts with exactly one `/` (`^/(?![/\\])`).
 * Refused:
 *   - anything else: absolute URLs (`https://…`), scheme URLs (`javascript:…`), protocol-relative `//host`, `/\host`
 *     (browsers treat `\` as `/`), relative paths without a leading slash, empty strings, non-strings;
 *   - control characters (U+0000–U+001F, U+007F–U+009F) anywhere, raw or after decoding: the URL parser strips tab
 *     and newline, so `/\t/evil.example` would become `//evil.example`;
 *   - a raw backslash anywhere, and a backslash in the path after decoding (an encoded one in the query is harmless);
 *   - in the PATH part (before the first `?` or `#`), an encoded slash or backslash (`%2F`, `%5C`, also
 *     double-encoded `%252F`): `/%2F%2Fevil.example` would decode to `//evil.example` in whatever reads it next. The
 *     query string and fragment may carry them (`/reports?date=2026%2F11`): they cannot change the origin;
 *   - a value that does not decode cleanly (malformed `%` escapes) or keeps decoding after
 *     {@link MAX_DECODE_ROUNDS} rounds;
 *   - a value that the URL parser resolves to another origin (a final, independent check).
 */

export const MAX_NEXT_LENGTH = 512;
const MAX_DECODE_ROUNDS = 4;
/** A placeholder origin that can never be a real host (`.invalid` is reserved, RFC 2606). */
const BASE = "https://app.invalid";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ENCODED_SLASH_OR_BACKSLASH = /%(2f|5c)/i;

/** Every form of `raw` from 0 to N rounds of percent-decoding, or null if a round fails or never settles. */
function decodedForms(raw: string): string[] | null {
  const forms = [raw];
  let current = raw;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return forms;
    forms.push(next);
    current = next;
  }
  return null;
}

/** The path part of `value`: everything before the first `?` or `#`. */
function pathPart(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

function isSafeForm(form: string): boolean {
  if (CONTROL.test(form)) return false;
  // The raw path is checked separately (and in every decoded form), so a backslash decoded from the query is harmless.
  if (pathPart(form).includes("\\")) return false;
  // Exactly one leading slash in every decoded form too (`/%2F…` is caught below; this keeps the rule explicit).
  return form.startsWith("/") && !form.startsWith("//");
}

/** The same-origin path to go to after sign-in, or `null` when `raw` is missing or unsafe. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (!/^\/(?![/\\])/.test(raw)) return null;
  if (raw.includes("\\")) return null;

  const forms = decodedForms(raw);
  if (forms === null || !forms.every(isSafeForm)) return null;
  // Encoded slashes are refused in the path (and in every decoded form of it), allowed in the query and fragment.
  const pathForms = decodedForms(pathPart(raw));
  if (pathForms === null || pathForms.some((f) => ENCODED_SLASH_OR_BACKSLASH.test(f) || f.includes("\\"))) return null;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}
