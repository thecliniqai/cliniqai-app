/**
 * One signed, pinned webhook POST (V2-04 04-03b; P0-12, R-26; V2-03 03-13d M-SSRF-DNS/M-SSRF-V6). Pure: no database,
 * no client factory, no retry policy (the delivery row's backoff and terminal states live in SQL,
 * `webhook_delivery_finish`, migration 000036). Called only by the `webhook.deliver` job handler
 * (`lib/jobs/internal/handlers/webhook-deliver.ts`); ESLint P0-12 refuses an import from anywhere else (R-33).
 *
 * 1. `resolveWebhookTarget`: the byte-level SSRF check resolves the name once (https only unless `allowHttp`).
 * 2. `generateWebhookSignature` over the stored raw body (stable HMAC across retries).
 * 3. `postPinned`: connects to exactly the checked address (SNI and `Host` = the name), follows no redirect, never
 *    reads the body, bounded by {@link WEBHOOK_TIMEOUT_MS}; the runner's `signal` aborts it earlier.
 *
 * Results carry a status and a machine code only (never the response body or an error message).
 */
import http from "node:http";
import https from "node:https";
import { resolveWebhookTarget, type HostResolver } from "./ssrf";
import { postPinned, type RequestImpl } from "./transport";
import { generateWebhookSignature } from "./signer";
import { errorTag } from "@/lib/log";

/** Bound of one delivery attempt (V2-03; R-17). */
export const WEBHOOK_TIMEOUT_MS = 5000;

export interface DeliverWebhookInput {
  endpointUrl: string;
  signingSecret: string;
  /** The stored envelope text, sent and signed byte for byte. */
  rawBody: string;
  /** The runner's abort signal (the handler's `maxDurationMs`). */
  signal?: AbortSignal;
  /** Permit `http:` endpoints (tests only). */
  allowHttp?: boolean;
  /** Hostname resolver for the SSRF check (default: the system resolver). */
  resolve?: HostResolver;
  /** Test seam for the pinned transport (default: `node:https` / `node:http` `request`). */
  request?: RequestImpl;
  /**
   * Legacy test seam: deliver through this `fetch` instead of the pinned transport (no address pinning). Production
   * never passes it.
   */
  fetch?: typeof fetch;
}

export interface DeliverWebhookResult {
  ok: boolean;
  /** HTTP status; 400 for an SSRF refusal (nothing sent), 500 when the request failed or timed out. */
  status: number;
  durationMs: number;
  /** `null` on success; else a machine code (`ssrf_blocked`, `http_503`, `request_failed:<tag>`, `timeout`). */
  errorCode: string | null;
  /** Whether another attempt may succeed. An SSRF refusal never does. */
  retryable: boolean;
}

const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function signalWith(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(WEBHOOK_TIMEOUT_MS);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** The pinned transport's request, with the runner's signal added to the transport's own timeout. */
function requestWithSignal(protocol: string, signal: AbortSignal | undefined, request?: RequestImpl): RequestImpl | undefined {
  if (!signal) return request;
  const send: RequestImpl = request ?? (protocol === "http:" ? http.request : https.request);
  return (options, callback) =>
    send({ ...options, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal }, callback);
}

function failureCode(err: unknown, signal: AbortSignal | undefined): string {
  if (signal?.aborted) return "aborted";
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const code = `request_failed:${errorTag(err)}`.slice(0, 64);
  return CODE.test(code) ? code : "request_failed";
}

export async function deliverWebhook(input: DeliverWebhookInput): Promise<DeliverWebhookResult> {
  const target = await resolveWebhookTarget(input.endpointUrl, {
    allowHttp: input.allowHttp === true,
    resolve: input.resolve,
  });
  if (!target.valid) {
    return { ok: false, status: 400, durationMs: 0, errorCode: "ssrf_blocked", retryable: false };
  }

  const { header: signatureHeader } = generateWebhookSignature(input.rawBody, input.signingSecret);
  const headers = {
    "Content-Type": "application/json",
    "X-ClinicQ-Signature": signatureHeader,
    "User-Agent": "ClinicQ-Webhook/1.0",
  };

  const started = Date.now();
  let status: number;
  try {
    if (input.fetch) {
      const res = await input.fetch(input.endpointUrl, {
        method: "POST",
        headers,
        body: input.rawBody,
        redirect: "manual",
        signal: signalWith(input.signal),
      });
      await res.body?.cancel().catch(() => undefined);
      status = res.status;
    } else {
      // Pinned to the checked address; never follows a redirect (a 3xx is a failed attempt and is retried).
      const res = await postPinned(
        target.target,
        { headers, body: input.rawBody, timeoutMs: WEBHOOK_TIMEOUT_MS },
        requestWithSignal(target.target.url.protocol, input.signal, input.request),
      );
      status = res.status;
    }
  } catch (err) {
    return { ok: false, status: 500, durationMs: Date.now() - started, errorCode: failureCode(err, input.signal), retryable: true };
  }

  const durationMs = Date.now() - started;
  if (status >= 200 && status < 300) return { ok: true, status, durationMs, errorCode: null, retryable: false };
  return { ok: false, status, durationMs, errorCode: `http_${status}`, retryable: true };
}
