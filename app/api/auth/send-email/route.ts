/**
 * POST /api/auth/send-email: the Supabase Auth Send Email hook (V2-03 03-11b; AUTH-03, A00-1, PO-A3; threats T-03-05,
 * T-03-06). Public by design: Supabase Auth calls it server to server, so it is authenticated by the Standard Webhooks
 * signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`), not by a session.
 *
 * Order:
 *   1. body larger than 64 KiB → 413; no secret configured, missing/invalid signature or a timestamp outside the
 *      library's 5-minute tolerance → 401. Nothing is parsed and nothing is sent before the signature verifies.
 *   2. the payload is zod-parsed (→ 400 if malformed).
 *   3. `email_action_type`:
 *        - `magiclink` → 200, no send (A00-1: closes the existing-user mailbox bypass through `/otp`);
 *        - `signup`, `recovery`, `invite` → one code email to `user.email`;
 *        - `email_change` → the `token` code to the current address and the `token_new` code to the new address
 *          (secure email change is on everywhere; any other shape is refused with 400);
 *        - `password_changed_notification` → the code-free security notice (03-11a wave note);
 *        - anything else (e.g. `reauthentication`, other notifications) → 200, no send, logged.
 *   4. 200 only after the provider accepted every message; `EMAIL_PROVIDER=disabled` → 503, a provider failure → 500,
 *      both in the hook error shape `{ error: { http_code, message } }` so Supabase Auth surfaces the failure.
 *
 * Logs carry the event, the action type, the provider, a count and the request id; never an address, a code, a token
 * hash or a provider message.
 */
import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { EmailDisabledError, getEmailSender, type EmailMessage } from "@/lib/email";
import { renderAuthEmail, type AuthEmailKind } from "@/lib/email/templates/auth";
import { serverEnv } from "@/lib/env-server";
import { errorTag, log, logWord, type LogWord } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const MODULE = "auth.email";

const email = z.string().email().max(320);

const payloadSchema = z.object({
  user: z
    .object({
      email,
      new_email: z.union([email, z.literal("")]).optional(),
    })
    .passthrough(),
  email_data: z
    .object({
      email_action_type: z.string().min(1).max(64),
      token: z.string().max(64).optional(),
      token_new: z.string().max(64).optional(),
    })
    .passthrough(),
});

type HookPayload = z.infer<typeof payloadSchema>;

/** The hook error shape Supabase Auth reads from a non-2xx response. */
function hookError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: { http_code: status, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function ok(): NextResponse {
  return NextResponse.json({}, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** The action type for a log line: a known shape, or a fixed marker (it is signed input, but still not free text). */
function actionLabel(action: string): LogWord {
  return /^[a-z_]{1,40}$/.test(action) ? logWord(action) : "unrecognised";
}

type Delivery = { kind: AuthEmailKind; to: string; code?: string };

/** What to send for a verified payload: deliveries, `drop` (200, nothing sent) or `invalid` (400). */
function deliveriesFor(payload: HookPayload): Delivery[] | "drop" | "invalid" {
  const { user, email_data: data } = payload;
  switch (data.email_action_type) {
    case "magiclink":
      return "drop";
    case "signup":
    case "recovery":
    case "invite":
      return [{ kind: data.email_action_type, to: user.email, code: data.token }];
    case "email_change":
      // Secure email change (double_confirm_changes) is on in every environment: `token` belongs to the current address
      // and `token_new` to the new one (verified against local GoTrue, evidence/03-11b/gotrue-hook-shapes.jsonl).
      if (!data.token || !data.token_new || !user.new_email) return "invalid";
      return [
        { kind: "email_change", to: user.email, code: data.token },
        { kind: "email_change", to: user.new_email, code: data.token_new },
      ];
    case "password_changed_notification":
      return [{ kind: "password_changed", to: user.email }];
    default:
      return "drop";
  }
}

async function readBody(request: NextRequest): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  return new TextDecoder().decode(bytes);
}

function verified(secret: string | undefined, body: string, request: NextRequest): boolean {
  if (!secret) return false;
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };
  try {
    // Supabase shows the secret as `v1,whsec_<base64>`; the library takes `whsec_<base64>`. It compares in constant
    // time, accepts any one of several space-separated signatures (secret rotation) and enforces a 5-minute tolerance.
    new Webhook(secret.slice("v1,".length)).verify(body, headers, { jsonParse: false });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = await getRequestId();

  let secret: string | undefined;
  try {
    secret = serverEnv().SEND_EMAIL_HOOK_SECRET;
  } catch {
    // An environment the schema refuses authenticates nothing (fail closed).
  }

  const body = await readBody(request);
  if (body === null) {
    log.warn({ event: "auth.email.refused", requestId, module: MODULE, reason: "too_large", status: 413 });
    return hookError(413, "Payload too large");
  }
  if (!verified(secret, body, request)) {
    log.warn({ event: "auth.email.refused", requestId, module: MODULE, reason: secret ? "bad_signature" : "no_secret", status: 401 });
    return hookError(401, "Invalid signature");
  }

  let payload: HookPayload;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(body));
    if (!parsed.success) throw new Error("invalid");
    payload = parsed.data;
  } catch {
    log.warn({ event: "auth.email.refused", requestId, module: MODULE, reason: "invalid_payload", status: 400 });
    return hookError(400, "Invalid payload");
  }

  const action = actionLabel(payload.email_data.email_action_type);
  const deliveries = deliveriesFor(payload);
  if (deliveries === "drop") {
    log.info({
      event: "auth.email.dropped",
      requestId,
      module: MODULE,
      action,
      reason: action === "magiclink" ? "magiclink" : "unsupported_action",
    });
    return ok();
  }
  if (deliveries === "invalid") {
    log.warn({ event: "auth.email.refused", requestId, module: MODULE, action, reason: "invalid_payload", status: 400 });
    return hookError(400, "Invalid payload");
  }

  let provider = "unknown";
  try {
    const messages: EmailMessage[] = deliveries.map((d) => ({ to: d.to, ...renderAuthEmail(d.kind, d.code) }));
    const sender = getEmailSender();
    provider = sender.provider;
    for (const message of messages) await sender.send(message);
  } catch (err) {
    const disabled = err instanceof EmailDisabledError;
    const status = disabled ? 503 : 500;
    log.error({ event: "auth.email.failed", requestId, module: logWord(`${MODULE}.${provider}`), action, code: errorTag(err), status });
    return hookError(status, disabled ? "Email delivery is disabled" : "Email could not be sent");
  }

  log.info({ event: "auth.email.sent", requestId, module: logWord(`${MODULE}.${provider}`), action, count: deliveries.length });
  return ok();
}
