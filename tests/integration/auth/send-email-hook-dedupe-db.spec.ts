/**
 * V2-04 04-03c (R-43; proposed ADR-0005 A3; T-04-23): the Send Email hook dedupes Supabase Auth's `webhook-id` in the
 * shared inbound store, so a retry that lands on another server instance does not send the auth email again. Local
 * stack + Mailpit, the real route and the real Mailpit sender; "two instances" = the route's per-instance memory
 * cleared between the calls (`resetHookDedupeForTests`), exactly what a second Vercel instance sees.
 *
 * - The same signed delivery on two instances → exactly one Mailpit message (before 04-03c: two).
 * - A first attempt that fails at the provider → the retry (another instance, same id) sends once.
 * - Another instance holding the id unfinished (in flight) → hook error 409, nothing sent, so Supabase Auth retries.
 * - The shared store failing (stubbed) → the email is still sent (fails open) and a code-only warning is logged.
 * - An id outside `^[A-Za-z0-9_.-]{1,128}$` skips the shared layer (still sent, no row).
 * - The stored row holds provider, id, timestamps, outcome and attempts only: no address, code or token.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";
import { POST, resetHookDedupeForTests } from "@/app/api/auth/send-email/route";
import * as systemDb from "@/lib/supabase/system";
import { signedWebhookHeaders } from "../../security/guard/engine";
import { LOCAL_MAILPIT_API_URL, LOCAL_SEND_EMAIL_HOOK_SECRET } from "../../setup/test-env";
import { deleteInboundEvents, inboundEvent, seedInboundEvent } from "../../messaging/inbound-helpers";

const ROOT = path.resolve(__dirname, "../../..");
const FROM = "no-reply@auth.example.com";
const SETTLE_MS = 1_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ids: string[] = [];

function address(label: string): string {
  return `dedupe-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

async function mailCount(to: string): Promise<number> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  return (((await res.json()) as { messages?: unknown[] }).messages ?? []).length;
}

function recovery(email: string): string {
  const f = JSON.parse(readFileSync(path.join(ROOT, "lint-fixtures/auth-hook/recovery.json"), "utf8")) as {
    user: Record<string, unknown>;
  };
  return JSON.stringify({ ...f, user: { ...f.user, email } });
}

/** One signed delivery (fixed body and headers) that can be posted any number of times. */
function signedDelivery(body: string, id?: string) {
  let headers: Record<string, string>;
  if (id) {
    const at = new Date();
    headers = {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
      "webhook-signature": new Webhook(LOCAL_SEND_EMAIL_HOOK_SECRET.slice("v1,".length)).sign(id, at, body),
    };
  } else {
    headers = signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body);
  }
  ids.push(headers["webhook-id"]);
  const post = async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/auth/send-email", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      })
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { id: headers["webhook-id"], post };
}

/** A request on "another instance": the per-instance memory is empty. */
async function onAnotherInstance<T>(call: () => Promise<T>): Promise<T> {
  resetHookDedupeForTests();
  return call();
}

let logLines: string[];

beforeEach(() => {
  resetHookDedupeForTests();
  vi.stubEnv("SEND_EMAIL_HOOK_SECRET", LOCAL_SEND_EMAIL_HOOK_SECRET);
  vi.stubEnv("EMAIL_PROVIDER", "mailpit");
  vi.stubEnv("MAILPIT_API_URL", LOCAL_MAILPIT_API_URL);
  vi.stubEnv("EMAIL_FROM", FROM);
  logLines = [];
  for (const stream of [process.stdout, process.stderr]) {
    const realWrite = stream.write.bind(stream);
    vi.spyOn(stream, "write").mockImplementation((chunk: unknown, ...rest: unknown[]) => {
      const text = String(chunk);
      if (text.includes('"event":"auth.email.')) logLines.push(...text.trim().split("\n"));
      return (realWrite as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  deleteInboundEvents(ids.filter((id) => /^[A-Za-z0-9_.-]{1,128}$/.test(id)));
});

describe("Send Email hook: shared webhook-id record across instances (R-43)", () => {
  it("the same signed delivery on two instances sends exactly one email (before: two)", async () => {
    const email = address("two-instances");
    const delivery = signedDelivery(recovery(email));
    expect(await delivery.post()).toEqual({ status: 200, json: {} });
    expect(await onAnotherInstance(delivery.post)).toEqual({ status: 200, json: {} });
    await sleep(SETTLE_MS);
    expect(await mailCount(email)).toBe(1);
    expect(inboundEvent("supabase_auth_hook", delivery.id)).toMatchObject({ outcome: "processed", processed: true, attempts: 1 });
    expect(logLines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ event: "auth.email.duplicate", reason: "webhook_id_seen" })
    );
  });

  it("a first attempt that fails at the provider: the retry on another instance sends once", async () => {
    const email = address("retry");
    const delivery = signedDelivery(recovery(email));
    vi.stubEnv("MAILPIT_API_URL", "http://127.0.0.1:1");
    expect((await delivery.post()).status).toBe(500);
    expect(inboundEvent("supabase_auth_hook", delivery.id)).toMatchObject({ outcome: "failed", processed: false });

    vi.stubEnv("MAILPIT_API_URL", LOCAL_MAILPIT_API_URL);
    expect(await onAnotherInstance(delivery.post)).toEqual({ status: 200, json: {} });
    expect(await onAnotherInstance(delivery.post)).toEqual({ status: 200, json: {} });
    await sleep(SETTLE_MS);
    expect(await mailCount(email)).toBe(1);
    expect(inboundEvent("supabase_auth_hook", delivery.id)).toMatchObject({ outcome: "processed", attempts: 2 });
  });

  it("another instance sending the same id right now → 409 hook error and nothing sent", async () => {
    const email = address("in-flight");
    const delivery = signedDelivery(recovery(email));
    seedInboundEvent("supabase_auth_hook", delivery.id, { ageMinutes: 0, outcome: null });
    expect(await delivery.post()).toEqual({
      status: 409,
      json: { error: { http_code: 409, message: "Email is already being sent" } },
    });
    await sleep(SETTLE_MS);
    expect(await mailCount(email)).toBe(0);
  });

  it("the shared store failing does not block the email (fails open) and logs a code only", async () => {
    const email = address("store-down");
    const delivery = signedDelivery(recovery(email));
    const real = systemDb.getSystemDb;
    vi.spyOn(systemDb, "getSystemDb").mockImplementation((reason) => {
      if (reason === "auth.send_email_hook") throw new Error("synthetic store outage");
      return real(reason);
    });
    expect(await delivery.post()).toEqual({ status: 200, json: {} });
    await sleep(SETTLE_MS);
    expect(await mailCount(email)).toBe(1);
    expect(inboundEvent("supabase_auth_hook", delivery.id)).toBeNull();
    const lines = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toContainEqual(expect.objectContaining({ event: "auth.email.dedupe_unavailable", level: "warn", code: "Error" }));
    expect(logLines.join("\n")).not.toContain(email);
  });

  it("an id of an unexpected shape skips the shared layer (still sent once, no row)", async () => {
    const email = address("odd-id");
    const oddId = `msg#${randomBytes(6).toString("hex")}`;
    const delivery = signedDelivery(recovery(email), oddId);
    expect(await delivery.post()).toEqual({ status: 200, json: {} });
    await sleep(SETTLE_MS);
    expect(await mailCount(email)).toBe(1);
    expect(inboundEvent("supabase_auth_hook", oddId.replace("#", "-"))).toBeNull();
  });

  it("the stored row holds provider, id, timestamps, outcome and attempts only (no address, code or token)", async () => {
    const email = address("row-shape");
    const body = recovery(email);
    const delivery = signedDelivery(body);
    expect((await delivery.post()).status).toBe(200);
    const event = inboundEvent("supabase_auth_hook", delivery.id)!;
    const row = JSON.parse(event.raw) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["attempts", "dedupe_key", "id", "outcome", "processed_at", "provider", "received_at"]);
    expect(row.dedupe_key).toBe(delivery.id);
    const data = (JSON.parse(body) as { email_data: Record<string, string> }).email_data;
    for (const value of [email, data.token, data.token_hash].filter(Boolean)) expect(event.raw).not.toContain(value);
  });
});
