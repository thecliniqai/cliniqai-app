/**
 * V2-03 03-11b (AUTH-03, A00-1, T-03-05): the Send Email hook on the built app, through `proxy.ts`, with the e2e
 * server's `EMAIL_PROVIDER=mailpit` and the local synthetic hook secret (`tests/e2e/support/app-env.ts`).
 *
 * A signed synthetic `recovery` payload is answered 200 and exactly one code email reaches the local Mailpit for that
 * address; a signed `magiclink` payload is answered 200 and nothing arrives; an unsigned or wrongly signed call is
 * answered 401 and nothing arrives. Addresses are synthetic and unique per run.
 *
 * Desktop Chromium only: the route is server to server and device-independent.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Webhook } from "standardwebhooks";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { LOCAL_MAILPIT_API_URL, LOCAL_SEND_EMAIL_HOOK_SECRET } from "../../setup/test-env";

test.use({ storageState: { cookies: [], origins: [] } });

const ONE_DEVICE = "desktop-chrome";
const ONE_DEVICE_REASON = "server-to-server route, proven once (see the file comment)";

function payload(name: string, email: string): string {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, "lint-fixtures/auth-hook", `${name}.json`), "utf8")) as {
    user: Record<string, unknown>;
  };
  return JSON.stringify({ ...f, user: { ...f.user, email } });
}

function signed(body: string, secret = LOCAL_SEND_EMAIL_HOOK_SECRET): Record<string, string> {
  const id = `msg_${randomBytes(12).toString("hex")}`;
  const now = new Date();
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": new Webhook(secret.slice("v1,".length)).sign(id, now, body),
  };
}

function address(label: string): string {
  return `e2e-hook-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

async function mailCount(to: string): Promise<number> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  expect(res.ok).toBe(true);
  return (((await res.json()) as { messages?: unknown[] }).messages ?? []).length;
}

test("a signed recovery call sends exactly one code email to Mailpit; magiclink sends none", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);

  const recoveryTo = address("recovery");
  const body = payload("recovery", recoveryTo);
  const res = await request.post("/api/auth/send-email", { headers: signed(body), data: body });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({});
  await expect.poll(() => mailCount(recoveryTo), { timeout: 10_000 }).toBe(1);

  const magicTo = address("magiclink");
  const magic = payload("magiclink", magicTo);
  const dropped = await request.post("/api/auth/send-email", { headers: signed(magic), data: magic });
  expect(dropped.status()).toBe(200);

  // Settle, then both counts are final: still one recovery email, no magiclink email.
  await new Promise((r) => setTimeout(r, 1_500));
  expect(await mailCount(recoveryTo)).toBe(1);
  expect(await mailCount(magicTo)).toBe(0);
});

test("unsigned and wrongly signed calls are refused with 401 and send nothing", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);

  const to = address("forged");
  const body = payload("recovery", to);
  const unsigned = await request.post("/api/auth/send-email", { headers: { "content-type": "application/json" }, data: body });
  expect(unsigned.status()).toBe(401);
  expect(await unsigned.json()).toEqual({ error: { http_code: 401, message: "Invalid signature" } });

  const other = `v1,whsec_${randomBytes(32).toString("base64")}`;
  const forged = await request.post("/api/auth/send-email", { headers: signed(body, other), data: body });
  expect(forged.status()).toBe(401);

  const get = await request.get("/api/auth/send-email");
  expect(get.status()).toBe(405);

  await new Promise((r) => setTimeout(r, 1_500));
  expect(await mailCount(to)).toBe(0);
});
