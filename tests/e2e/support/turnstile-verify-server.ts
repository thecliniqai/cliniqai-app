/**
 * Loopback fake of Cloudflare's Turnstile siteverify (V2-05 05-07b, R-46). Used by Playwright's global setup (the e2e
 * app server runs with a Cloudflare test secret and `TURNSTILE_VERIFY_URL` pointing here) and by the Vitest specs of
 * invite acceptance. No test lane ever reaches challenges.cloudflare.com.
 *
 * `POST /turnstile/v0/siteverify` with a form body (`secret`, `response`, optional `remoteip`) answers like Cloudflare:
 *   - a widget token starting `fail` → `{ success: false, "error-codes": ["invalid-input-response"] }`;
 *   - a token starting `slow` → the answer is delayed by `slowMs` (default 5 s, past the 3 s client timeout);
 *   - a token starting `wronghost` → success with the hostname `evil.example.test`;
 *   - a token starting `http500` → HTTP 500;
 *   - no secret or no token → `{ success: false, "error-codes": ["missing-input-secret" | "missing-input-response"] }`;
 *   - anything else → `{ success: true, hostname: <hostname option, default "localhost">, ... }`.
 * The server records, per request, only whether a secret and a token were present and the token's length (never their
 * values).
 *
 * Plain Node + relative imports only (loaded by the Playwright runner via tsx and by Vitest).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface SiteverifyRequest {
  hadSecret: boolean;
  hadToken: boolean;
  tokenLength: number;
}

export interface TurnstileVerifyServer {
  url: string;
  port: number;
  requests: SiteverifyRequest[];
  close(): Promise<void>;
}

export const SITEVERIFY_PATH = "/turnstile/v0/siteverify";

export async function startTurnstileVerifyServer(
  options: { port?: number; hostname?: string; slowMs?: number } = {},
): Promise<TurnstileVerifyServer> {
  const requests: SiteverifyRequest[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== SITEVERIFY_PATH) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const secret = form.get("secret") ?? "";
      const token = form.get("response") ?? "";
      requests.push({ hadSecret: secret.length > 0, hadToken: token.length > 0, tokenLength: token.length });
      const json = (status: number, payload: unknown) =>
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(payload));
      if (!secret) return json(200, { success: false, "error-codes": ["missing-input-secret"] });
      if (!token) return json(200, { success: false, "error-codes": ["missing-input-response"] });
      if (token.startsWith("http500")) return json(500, { error: "synthetic" });
      if (token.startsWith("fail")) return json(200, { success: false, "error-codes": ["invalid-input-response"] });
      const ok = {
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: token.startsWith("wronghost") ? "evil.example.test" : (options.hostname ?? "localhost"),
        "error-codes": [],
        action: "invite-accept",
      };
      if (token.startsWith("slow")) {
        const t = setTimeout(() => {
          timers.delete(t);
          if (!res.writableEnded) json(200, ok);
        }, options.slowMs ?? 5000);
        timers.add(t);
        return;
      }
      json(200, ok);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}${SITEVERIFY_PATH}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
