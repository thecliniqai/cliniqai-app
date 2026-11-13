/**
 * Loopback fake of the Pwned Passwords range API (V2-03 03-12a, FT-05). Used by Playwright's global setup (the e2e
 * app server runs `PWNED_CHECK=on` with `PWNED_API_BASE_URL` pointing here) and by the DB-lane integration specs.
 * No test lane ever reaches api.pwnedpasswords.com.
 *
 * `GET /range/<5 hex>` answers like the real API with `Add-Padding: true`: `SUFFIX:COUNT` lines (CRLF), padding lines
 * with count 0, and the suffixes of {@link BREACHED_FIXTURE_PASSWORDS} that share the prefix with a count above 0.
 * The server records only the requested prefix and whether padding was asked for (what k-anonymity lets it see).
 *
 * Plain Node + relative imports only (loaded by the Playwright runner via tsx and by Vitest).
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

/** Synthetic passwords the fake lists as breached. Each meets the 10-character policy, so only FT-05 rejects it. */
export const BREACHED_FIXTURE_PASSWORDS: readonly string[] = ["Synthetic-Breached-Pass-01", "Synthetic-Breached-Pass-02"];

export interface RangeRequest {
  prefix: string;
  padding: boolean;
}

export interface PwnedRangeServer {
  url: string;
  port: number;
  /** Every range request received (prefix only). */
  requests: RangeRequest[];
  close(): Promise<void>;
}

function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
}

function rangeBody(prefix: string, breached: readonly string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    // Random padding and filler suffixes; a filler never equals a real suffix in practice (35 random hex characters).
    lines.push(`${randomBytes(18).toString("hex").toUpperCase().slice(0, 35)}:${i % 2 === 0 ? 0 : 1 + i}`);
  }
  for (const password of breached) {
    const hex = sha1Hex(password);
    if (hex.startsWith(prefix)) lines.push(`${hex.slice(5)}:${1000 + lines.length}`);
  }
  return lines.join("\r\n");
}

export async function startPwnedRangeServer(
  options: { port?: number; breached?: readonly string[] } = {},
): Promise<PwnedRangeServer> {
  const breached = options.breached ?? BREACHED_FIXTURE_PASSWORDS;
  const requests: RangeRequest[] = [];
  const server = http.createServer((req, res) => {
    const match = /^\/range\/([0-9A-Fa-f]{5})$/.exec(req.url ?? "");
    if (req.method !== "GET" || !match) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const prefix = match[1].toUpperCase();
    requests.push({ prefix, padding: String(req.headers["add-padding"]).toLowerCase() === "true" });
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }).end(rangeBody(prefix, breached));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
