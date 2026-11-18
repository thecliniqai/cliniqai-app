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
 * 03-13a (review D Lows, I-2):
 *   - Time budget: the messages are sent in parallel and the provider calls are aborted after
 *     {@link HOOK_SEND_BUDGET_MS}, below GoTrue's hook timeout ({@link GOTRUE_HOOK_TIMEOUT_MS}). Past the budget the
 *     answer is 500 "Email could not be sent", so GoTrue gets a failure it can report instead of timing out on its
 *     own while the email may still go out.
 *   - `webhook-id` dedupe: a verified delivery is remembered by its `webhook-id` for {@link DEDUPE_TTL_MS} (longer
 *     than the 5-minute signature tolerance). A replay or a GoTrue retry of a delivery that succeeded answers 200 and
 *     sends nothing; one that arrives while the first is still sending waits for it and shares its answer; after a
 *     failure the next attempt sends again. The memory is per server instance (at most {@link DEDUPE_MAX_ENTRIES}),
 *     so a retry that lands on another instance can still re-send the same code: harmless (the same code to the same
 *     address); a shared store arrives with the V2-04 outbox.
 *
 * 04-03c (R-43; proposed ADR-0005 amendment A3): the shared layer. After the signature check and the per-instance
 * memory, the delivery's `webhook-id` is recorded in the shared inbound store (`features/auth/system`:
 * `authHookDeliveryBegin` → `inbound_webhook_begin('supabase_auth_hook', id)`, migration 000037), so a retry that
 * lands on another instance is not sent again: `duplicate` → 200, nothing sent; `in_flight` (another instance is
 * sending it now) → hook error 409, so Supabase Auth retries later; `process` → send, then `authHookDeliveryFinish`
 * (`processed`, or `failed` so the next retry sends). An id outside `^[A-Za-z0-9_.-]{1,128}$` skips the shared layer.
 * The shared layer fails OPEN: a database error is logged and the email is sent. The table holds the provider, the id
 * and timestamps only.
 *
 * 04-00b: every provider call carries an idempotency key derived from the signed `webhook-id` and the message's index
 * ({@link idempotencyKeyFor}). Resend answers a repeated key with the first result and sends nothing, so a retry that
 * lands on another instance (past the per-instance memory above) does not send the code twice.
 *
 * Logs carry the event, the action type, the provider, a count and the request id; never an address, a code, a token
 * hash or a provider message.
 */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { authHookDeliveryBegin, authHookDeliveryFinish } from "@/features/auth/system";
import { EmailDisabledError, getEmailSender, type EmailMessage } from "@/lib/email";
import { renderAuthEmail, type AuthEmailKind } from "@/lib/email/templates/auth";
import { serverEnv } from "@/lib/env-server";
import { errorTag, log, logWord, type LogWord } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const MODULE = "auth.email";

/**
 * GoTrue's HTTP hook timeout (v2.197.0 `hookshttp`: 5 s; the local binary's error reads "Failed to reach hook within
 * maximum time of %f seconds"). Not measurable on the CLI stack (the hook is off locally); a hosted change would
 * surface as hook timeouts in the Auth logs.
 */
export const GOTRUE_HOOK_TIMEOUT_MS = 5_000;
/** Time the provider calls may take in total, leaving room for the request itself under GoTrue's timeout. */
export const HOOK_SEND_BUDGET_MS = 3_500;
export const DEDUPE_TTL_MS = 10 * 60_000;
export const DEDUPE_MAX_ENTRIES = 1_000;

type Outcome = { status: 200 } | { status: 409 | 500 | 503; message: string };

/** `webhook-id` → the outcome of that delivery (pending while it is being sent). Per instance; see the header. */
const deliveries = new Map<string, { expires: number; outcome: Promise<Outcome> }>();

function remembered(id: string, now: number): Promise<Outcome> | null {
  const entry = deliveries.get(id);
  if (!entry) return null;
  if (entry.expires <= now) {
    deliveries.delete(id);
    return null;
  }
  return entry.outcome;
}

function remember(id: string, outcome: Promise<Outcome>, now: number): void {
  for (const [key, entry] of deliveries) if (entry.expires <= now) deliveries.delete(key);
  while (deliveries.size >= DEDUPE_MAX_ENTRIES) {
    const oldest = deliveries.keys().next();
    if (oldest.done) break;
    deliveries.delete(oldest.value);
  }
  deliveries.set(id, { expires: now + DEDUPE_TTL_MS, outcome });
}

/** Test seam: forgets every remembered delivery. */
export function resetHookDedupeForTests(): void {
  deliveries.clear();
}

class BudgetExceededError extends Error {
  readonly code = "hook_budget_exceeded";
  constructor() {
    super("The email provider did not answer within the hook budget");
    this.name = "BudgetExceededError";
  }
}

/**
 * 04-00b: the provider idempotency key of message `index` of the delivery `webhookId`: `auth-email/<sha256 hex>/<n>`.
 * Hashed so the outbound header has a fixed shape whatever the (signed) inbound id holds; per message because an
 * `email_change` delivery sends two different messages. `null` without an id (nothing to derive it from).
 */
export function idempotencyKeyFor(webhookId: string, index: number): string | null {
  if (!webhookId) return null;
  return `auth-email/${createHash("sha256").update(webhookId, "utf8").digest("hex")}/${index}`;
}

/** Sends every message in parallel; rejects once the budget is spent, aborting the provider calls. */
async function sendWithinBudget(
  send: (message: EmailMessage, signal: AbortSignal, index: number) => Promise<unknown>,
  messages: EmailMessage[],
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new BudgetExceededError());
      reject(new BudgetExceededError());
    }, HOOK_SEND_BUDGET_MS);
  });
  try {
    await Promise.race([Promise.all(messages.map((m, i) => send(m, controller.signal, i))), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

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
function deliveriesForPayload(payload: HookPayload): Delivery[] | "drop" | "invalid" {
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
  const planned = deliveriesForPayload(payload);
  if (planned === "drop") {
    log.info({
      event: "auth.email.dropped",
      requestId,
      module: MODULE,
      action,
      reason: action === "magiclink" ? "magiclink" : "unsupported_action",
    });
    return ok();
  }
  if (planned === "invalid") {
    log.warn({ event: "auth.email.refused", requestId, module: MODULE, action, reason: "invalid_payload", status: 400 });
    return hookError(400, "Invalid payload");
  }

  // The signature covers `webhook-id`, so only a holder of the hook secret can choose it.
  const webhookId = request.headers.get("webhook-id") ?? "";
  const earlier = remembered(webhookId, Date.now());
  if (earlier) {
    const previous = await earlier;
    if (previous.status === 200) {
      log.info({ event: "auth.email.duplicate", requestId, module: MODULE, action, reason: "webhook_id_seen" });
      return ok();
    }
    // The earlier attempt failed: this one sends again, unless another retry has already started.
    const current = remembered(webhookId, Date.now());
    if (current && current !== earlier) {
      const shared = await current;
      return shared.status === 200 ? ok() : hookError(shared.status, shared.message);
    }
  }

  const outcome = deliverOnce(planned, action, requestId, webhookId);
  remember(webhookId, outcome, Date.now());
  const result = await outcome;
  if (result.status !== 200 && deliveries.get(webhookId)?.outcome === outcome) deliveries.delete(webhookId);
  return result.status === 200 ? ok() : hookError(result.status, result.message);
}

/** 04-03c: the shared `webhook-id` record around {@link deliver} (fails open; see the header). */
async function deliverOnce(planned: Delivery[], action: LogWord, requestId: string | undefined, webhookId: string): Promise<Outcome> {
  const shared = await authHookDeliveryBegin(webhookId);
  if (shared === "duplicate") {
    log.info({ event: "auth.email.duplicate", requestId, module: MODULE, action, reason: "webhook_id_seen" });
    return { status: 200 };
  }
  if (shared === "in_flight") {
    log.info({ event: "auth.email.duplicate", requestId, module: MODULE, action, reason: "in_flight", status: 409 });
    return { status: 409, message: "Email is already being sent" };
  }
  const result = await deliver(planned, action, requestId, webhookId);
  if (shared === "process" || shared === "unavailable") {
    await authHookDeliveryFinish(webhookId, result.status === 200 ? "processed" : "failed");
  }
  return result;
}

async function deliver(planned: Delivery[], action: LogWord, requestId: string | undefined, webhookId: string): Promise<Outcome> {
  let provider = "unknown";
  try {
    const messages: EmailMessage[] = planned.map((d) => ({ to: d.to, ...renderAuthEmail(d.kind, d.code) }));
    const sender = getEmailSender();
    provider = sender.provider;
    await sendWithinBudget((message, signal, index) => {
      const idempotencyKey = idempotencyKeyFor(webhookId, index);
      return sender.send(message, idempotencyKey ? { signal, idempotencyKey } : { signal });
    }, messages);
  } catch (err) {
    const disabled = err instanceof EmailDisabledError;
    const status = disabled ? 503 : 500;
    log.error({ event: "auth.email.failed", requestId, module: logWord(`${MODULE}.${provider}`), action, code: errorTag(err), status });
    return { status, message: disabled ? "Email delivery is disabled" : "Email could not be sent" };
  }
  log.info({ event: "auth.email.sent", requestId, module: logWord(`${MODULE}.${provider}`), action, count: planned.length });
  return { status: 200 };
}
