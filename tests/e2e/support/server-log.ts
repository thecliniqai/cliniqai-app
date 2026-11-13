/**
 * The e2e app server's output capture (V2-03 03-13d, H-LOG). `serve.ts` passes the `next start` child's stdout and
 * stderr through unchanged (Playwright still pipes them) and also appends them to {@link SERVER_STDERR_LOG} /
 * {@link SERVER_STDOUT_LOG}, truncated at server start, so a spec can assert what the server printed: the
 * equivalent of the platform's function log. `*.log` is git-ignored.
 *
 * Plain Node + relative imports only (imported by `serve.ts` via tsx and by specs).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
export const SERVER_LOG_DIR = path.join(ROOT, "playwright");
export const SERVER_STDERR_LOG = path.join(SERVER_LOG_DIR, "e2e-server-stderr.log");
export const SERVER_STDOUT_LOG = path.join(SERVER_LOG_DIR, "e2e-server-stdout.log");

/** The current size of a capture file (0 if it does not exist): the offset to read new output from. */
export function logOffset(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Everything appended to `file` after `offset`. */
export function readLogFrom(file: string, offset: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= offset) return "";
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
