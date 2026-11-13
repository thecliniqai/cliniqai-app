/**
 * V2-03 03-09a (BACKEND H2, T-03-07): on the built app, `proxy.ts` gives every request its own `x-request-id` UUID and
 * a caller cannot choose it. Unauthenticated `GET /api/health` (an early-return path of the proxy).
 */
import { expect, test } from "../fixtures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.use({ storageState: { cookies: [], origins: [] } });

test("two GET /api/health calls return two different request-id UUIDs", async ({ request }) => {
  const first = await request.get("/api/health");
  const second = await request.get("/api/health");
  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);
  const a = first.headers()["x-request-id"];
  const b = second.headers()["x-request-id"];
  expect(a).toMatch(UUID);
  expect(b).toMatch(UUID);
  expect(a).not.toBe(b);
});

test("a spoofed inbound x-request-id is replaced", async ({ request }) => {
  const spoofedId = "11111111-2222-4333-8444-555555555555";
  for (const value of ["spoofed", spoofedId]) {
    const res = await request.get("/api/health", { headers: { "x-request-id": value } });
    expect(res.status()).toBe(200);
    const id = res.headers()["x-request-id"];
    expect(id).toMatch(UUID);
    expect(id).not.toBe(value);
  }
});
