/**
 * Server logger (V2-03 03-09a, ruling R-6: in-house, typed, no pino). One JSON line per call: `ts`, `level`, then the
 * sanitised fields of {@link LogFields}. `info` goes to stdout, `warn` and `error` to stderr, written directly (never
 * through `console`). Reads no environment.
 *
 *   log.error({ event: "billing.payment_failed", requestId: await getRequestId(), code: errorTag(err) });
 *
 * `errorTag` is re-exported here because it is the only way an error may enter a line (as `code`).
 */
import { sanitiseFields, type LogFields, type LogLevel } from "./fields";

export { errorTag } from "@/lib/errors/error-tag";
export type { LogFields, LogLevel, LogRoute, LogWord } from "./fields";
export { logWord } from "./fields";

function write(level: LogLevel, fields: LogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...sanitiseFields(fields) }) + "\n";
  const stream = level === "info" ? process.stdout : process.stderr;
  try {
    stream.write(line);
  } catch {
    // A logger must never take the request down with it (closed pipe, unavailable stream).
  }
}

export const log = {
  info(fields: LogFields): void {
    write("info", fields);
  },
  warn(fields: LogFields): void {
    write("warn", fields);
  },
  error(fields: LogFields): void {
    write("error", fields);
  },
};
