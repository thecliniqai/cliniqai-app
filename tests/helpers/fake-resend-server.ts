/**
 * V2-04 04-00b: a loopback stand-in for Resend's `POST /emails`, so the Resend sender and the Send Email hook can be
 * exercised over real HTTP without contacting Resend.
 *
 * It behaves like the API on the points the sender depends on: the bearer key must match (else 401 with Resend's error
 * shape); a repeated `Idempotency-Key` answers the first result again and delivers nothing (Resend keeps keys for 24 h);
 * an accepted send answers `{ id }`. `mode` forces a status, a hang (never answers) or a redirect. Every request is
 * recorded (method, path, lower-cased headers, parsed body); `delivered` counts the messages it would have sent.
 *
 * `fetchVia(server)` is a transport that sends a call for the real Resend URL to this server instead and refuses any
 * other URL, so a spec can prove the URL the sender targets without the network.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RESEND_API_URL } from "@/lib/email/resend";

/** The real transport, captured before a spec replaces the global `fetch` with {@link fetchVia}. */
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown> | null;
}

export type FakeResendMode = { kind: "ok" } | { kind: "status"; status: number } | { kind: "hang" } | { kind: "redirect"; location: string };

export interface FakeResendServer {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Messages the fake accepted for delivery (a replayed idempotency key is not a new delivery). */
  readonly delivered: Array<{ id: string; to: unknown; idempotencyKey: string | null }>;
  mode: FakeResendMode;
  /** One-shot modes, used before `mode` (first entry first). */
  readonly queue: FakeResendMode[];
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeResend(expectedKey: string): Promise<FakeResendServer> {
  const requests: RecordedRequest[] = [];
  const delivered: FakeResendServer["delivered"] = [];
  const idempotent = new Map<string, { status: number; body: string }>();
  const hanging = new Set<import("node:http").ServerResponse>();
  let counter = 0;

  const state = {
    mode: { kind: "ok" } as FakeResendMode,
    queue: [] as FakeResendMode[],
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        body = null;
      }
      requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      const mode = state.queue.shift() ?? state.mode;
      if (mode.kind === "hang") {
        hanging.add(res);
        res.on("close", () => hanging.delete(res));
        return;
      }
      if (mode.kind === "redirect") {
        res.writeHead(307, { location: mode.location });
        res.end();
        return;
      }
      if (mode.kind === "status") {
        // Resend's error shape; its message can quote the recipient, which the sender must never surface.
        const to = Array.isArray(body?.to) ? String(body.to[0]) : "";
        send(mode.status, { statusCode: mode.status, name: "application_error", message: `Could not send to ${to}` });
        return;
      }
      if (req.method !== "POST" || req.url !== "/emails") return send(404, { statusCode: 404, name: "not_found", message: "Not found" });
      if (req.headers.authorization !== `Bearer ${expectedKey}`) {
        return send(401, { statusCode: 401, name: "missing_api_key", message: "Missing or invalid API key" });
      }
      const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null;
      if (key && idempotent.has(key)) {
        const first = idempotent.get(key)!;
        res.writeHead(first.status, { "content-type": "application/json" });
        res.end(first.body);
        return;
      }
      counter += 1;
      const id = `fake-resend-${counter}`;
      delivered.push({ id, to: body?.to, idempotencyKey: key });
      const answer = JSON.stringify({ id });
      if (key) idempotent.set(key, { status: 200, body: answer });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(answer);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    delivered,
    get mode() {
      return state.mode;
    },
    set mode(value: FakeResendMode) {
      state.mode = value;
    },
    queue: state.queue,
    reset() {
      requests.length = 0;
      delivered.length = 0;
      idempotent.clear();
      state.queue.length = 0;
      state.mode = { kind: "ok" };
      for (const res of hanging) res.destroy();
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A transport that sends calls for {@link RESEND_API_URL} to `server` (same path) and refuses every other URL. */
export function fetchVia(server: Pick<FakeResendServer, "url">, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);
    if (url !== RESEND_API_URL) throw new TypeError(`fake transport refuses ${new URL(url).host}`);
    return realFetch(`${server.url}${new URL(url).pathname}`, init);
  }) as typeof fetch;
}
