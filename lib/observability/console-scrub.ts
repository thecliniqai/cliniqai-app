/**
 * Console scrubbing (V2-03 03-13d, H-LOG; T-03-03). Next.js prints every uncaught server error itself
 * (`console.error(err)` in the route module, `Log.error` for render errors, `uncaughtException` / `unhandledRejection`
 * listeners): Node's inspector writes the message, the stack and every own property (PostgREST `details` such as
 * `Key (phone)=(…)`), and on Vercel that is the function log, outside the scrubbed sink.
 *
 * {@link installConsoleScrub} (called first in `instrumentation.ts` `register()`, Node.js runtime) wraps the console's
 * output methods once. Every argument passes through the scrubber before it is printed:
 * - an Error or error-like object becomes one string: class name, code (SQLSTATE / PostgREST / upper-snake), Next digest, the scrubbed
 *   message, scrubbed `details` / `hint`, the `cause` chain (depth {@link MAX_CAUSE_DEPTH}) and the stack as
 *   `file:line` frames only (no function names, no own properties, no raw stack text);
 * - any other object becomes its kind (`[Object]`, `[Array(3)]`): never inspected;
 * - a string (or number, bigint) is scrubbed with the shared rule list and cut to {@link MAX_CONSOLE_STRING} characters.
 *
 * Wrappers Next installs before or after this one keep working: each calls the method it found, so every path ends here.
 */
import { errorCodeOf, errorNameOf } from "./error-event";
import { MAX_FRAMES, scrubFrames, scrubMessage, scrubText } from "./scrub";

export const CONSOLE_METHODS = ["error", "warn", "log", "info", "debug", "trace"] as const;
export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];
export const MAX_CONSOLE_STRING = 2000;
export const MAX_CAUSE_DEPTH = 3;
const CONSOLE_FRAMES = Math.min(10, MAX_FRAMES);
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;
const INSTALLED = Symbol.for("clinicos.consoleScrub.installed");

function get(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** An Error, or an object shaped like one (PostgREST / Supabase errors are often plain objects). */
export function isErrorLike(value: unknown): value is object {
  if (value instanceof Error) return true;
  if (value === null || typeof value !== "object") return false;
  if (typeof get(value, "message") !== "string") return false;
  return ["code", "details", "hint", "name", "stack"].some((key) => get(value, key) !== undefined);
}

/** The one-string, scrubbed form of an error-like value. Never throws. */
export function describeError(err: object, root: string, depth = 0): string {
  const name = errorNameOf(err) ?? (err instanceof Error ? "Error" : "ErrorLike");
  const code = errorCodeOf(err);
  const digest = get(err, "digest");
  const parts = [`${name}${code ? ` [${code}]` : ""}: ${scrubMessage(get(err, "message"))}`];
  if (typeof digest === "string" && DIGEST.test(digest)) parts.push(`digest=${digest}`);
  for (const key of ["details", "hint"]) {
    const value = get(err, key);
    if (typeof value === "string" && value) parts.push(`${key}: ${scrubMessage(value)}`);
  }
  const errors = get(err, "errors");
  if (Array.isArray(errors)) parts.push(`errors: ${errors.length}`);
  const frames = scrubFrames(get(err, "stack"), root).slice(0, CONSOLE_FRAMES);
  let text = parts.join(" | ");
  if (frames.length) text += `\n    at ${frames.join("\n    at ")}`;
  const cause = get(err, "cause");
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    text += `\n  [cause] ${isErrorLike(cause) ? describeError(cause, root, depth + 1) : scrubArg(cause, root, depth + 1)}`;
  }
  return text;
}

/** The printable, scrubbed form of one console argument. Never throws. */
export function scrubArg(arg: unknown, root: string, depth = 0): unknown {
  try {
    if (arg === null || arg === undefined || typeof arg === "boolean") return arg;
    if (typeof arg === "string") {
      const out = scrubText(arg);
      return out.length > MAX_CONSOLE_STRING ? out.slice(0, MAX_CONSOLE_STRING) : out;
    }
    if (typeof arg === "number" || typeof arg === "bigint") return scrubText(String(arg));
    if (typeof arg === "symbol" || typeof arg === "function") return `[${typeof arg}]`;
    if (isErrorLike(arg)) return describeError(arg, root, depth);
    if (Array.isArray(arg)) return `[Array(${arg.length})]`;
    return "[Object]";
  } catch {
    return "[unprintable]";
  }
}

type ConsoleLike = Pick<Console, ConsoleMethod>;

/**
 * Wraps `target`'s output methods so every argument is scrubbed first. Idempotent (a second call is a no-op).
 * Returns `true` when it installed the wrappers.
 */
export function installConsoleScrub(target: ConsoleLike = console, root: string = process.cwd()): boolean {
  const marked = target as ConsoleLike & { [INSTALLED]?: true };
  if (marked[INSTALLED]) return false;
  for (const method of CONSOLE_METHODS) {
    const original = target[method];
    if (typeof original !== "function") continue;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      return original.apply(this ?? target, args.map((arg) => scrubArg(arg, root)));
    };
    Object.defineProperty(wrapped, "name", { value: original.name });
    target[method] = wrapped as Console[typeof method];
  }
  Object.defineProperty(marked, INSTALLED, { value: true, enumerable: false });
  return true;
}
