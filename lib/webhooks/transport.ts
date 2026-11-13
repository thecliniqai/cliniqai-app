/**
 * Pinned webhook delivery (V2-03 03-13d, M-SSRF-DNS; review E-2, IND M-1, T-03-11). The request connects to the one
 * address {@link resolveWebhookTarget} checked, never to a fresh DNS answer: `host` is that address, while TLS SNI,
 * certificate verification and the `Host` header use the endpoint's name. A rebinding name that answers a public
 * address for the check and a private one afterwards is therefore never connected to the private one.
 *
 * Plain `node:https` (no new dependency): no redirect is followed (a 3xx is a failed delivery), the response body is
 * never read, and the whole exchange is bounded by `timeoutMs`.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { WebhookTarget } from "./ssrf";

export type RequestImpl = (options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) => http.ClientRequest;

export interface PinnedPostInput {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

/** The request options a pinned delivery uses (exported for the spec). */
export function pinnedRequestOptions(target: WebhookTarget, input: PinnedPostInput): https.RequestOptions {
  const { url } = target;
  return {
    protocol: url.protocol,
    host: target.address,
    family: target.family,
    port: target.port,
    path: `${url.pathname}${url.search}`,
    method: "POST",
    // SNI and certificate check against the name, not the pinned address (an IP literal needs neither).
    ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }),
    headers: { ...input.headers, host: url.host, "content-length": String(Buffer.byteLength(input.body)) },
    agent: false,
    signal: AbortSignal.timeout(input.timeoutMs),
  };
}

/** POSTs `body` to the pinned address. Resolves with the HTTP status; rejects on a connect, TLS or timeout error. */
export function postPinned(
  target: WebhookTarget,
  input: PinnedPostInput,
  requestImpl?: RequestImpl,
): Promise<{ status: number }> {
  const send: RequestImpl = requestImpl ?? (target.url.protocol === "http:" ? http.request : https.request);
  return new Promise((resolve, reject) => {
    let req: http.ClientRequest;
    try {
      req = send(pinnedRequestOptions(target, input), (res) => {
        const status = res.statusCode ?? 0;
        // Never read the body: it is not used, and a large or slow body must not hold the job.
        res.destroy();
        resolve({ status });
      });
    } catch (err) {
      reject(err);
      return;
    }
    req.on("error", reject);
    req.end(input.body);
  });
}
