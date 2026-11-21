/**
 * V2-09b 09B-06a, ruling R-U (review S-1 / A-5): the request-body gate of `proxy.ts`. The server-action body limit is 4 MB for every action and Next reads
 * the body before an action authenticates, so the proxy answers 413, before anything reads the body, to a non-GET/HEAD request that may carry more than
 * 1 MB (a `content-length` over 1 MB or not a number, or a body with no length) unless the caller is signed in and the path is an upload page
 * (`/consultation/…`, `/patients/…`). Driven through the real `proxy` against the local stack's GoTrue with a real session (no body is ever sent: the
 * gate reads headers only). Synthetic users only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { proxy, PROXY_MAX_BODY_BYTES } from "@/proxy";
import { publicEnv } from "@/lib/env";
import { createUnlinkedUser } from "../helpers/tenants";

const COOKIE = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const MB = 1024 * 1024;
const VISIT = "c1160000-0000-4000-8000-000000002001";

function encodeSession(session: Session): string {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

let session: Session;

function request(
  path: string,
  opts: { method?: string; length?: string | null; signedIn?: boolean; chunked?: boolean; stream?: boolean } = {},
): NextRequest {
  const headers = new Headers({ "next-action": "0123456789abcdef" });
  if (opts.length !== undefined && opts.length !== null) headers.set("content-length", opts.length);
  if (opts.chunked) headers.set("transfer-encoding", "chunked");
  if (opts.signedIn) headers.set("cookie", `${COOKIE}=${encodeSession(session)}`);
  // A body stream of unknown length (nothing is read from it: the gate looks at headers and at whether there is a body).
  const body = opts.stream ? new ReadableStream({ start: (c) => c.close() }) : undefined;
  const init = { method: opts.method ?? "POST", headers, body, ...(body ? { duplex: "half" } : {}) };
  return new NextRequest(`http://localhost${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
}

const passedOn = (res: Response) => res.status === 200 && res.headers.get("x-middleware-next") === "1";

beforeAll(async () => {
  const user = await createUnlinkedUser();
  const { data, error } = await user.client.auth.getSession();
  if (error || !data.session) throw new Error(`no session for the synthetic user: ${error?.message ?? "none"}`);
  session = data.session;
});

describe("R-U: the proxy refuses large or unsized bodies before any action reads them", () => {
  it("is 1 MB", () => {
    expect(PROXY_MAX_BODY_BYTES).toBe(MB);
  });

  it("a signed-out POST of 2 MB to a public page (the login page's actions) is 413 with the request id", async () => {
    const res = await proxy(request("/login", { length: String(2 * MB) }));
    expect(res.status).toBe(413);
    expect(res.headers.get("x-request-id")).toMatch(/\S/);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("a signed-out POST of 2 MB to the consult page is 413 (an upload page needs a session)", async () => {
    expect((await proxy(request(`/consultation/${VISIT}`, { length: String(2 * MB) }))).status).toBe(413);
    expect((await proxy(request("/patients/abc", { length: String(2 * MB) }))).status).toBe(413);
  });

  it("a body with no content-length (a stream, chunked) and a content-length that is not a number are 413", async () => {
    expect((await proxy(request("/login", { length: null, stream: true }))).status).toBe(413);
    expect((await proxy(request("/login", { method: "PUT", length: null, stream: true }))).status).toBe(413);
    expect((await proxy(request("/login", { method: "DELETE", length: null, chunked: true }))).status).toBe(413);
    expect((await proxy(request("/login", { length: "12abc" }))).status).toBe(413);
  });

  it("a signed-in POST of 2 MB to a page that is not an upload page is 413", async () => {
    expect((await proxy(request("/today", { length: String(2 * MB), signedIn: true }))).status).toBe(413);
    expect((await proxy(request("/settings", { length: String(2 * MB), signedIn: true }))).status).toBe(413);
  });

  it("a signed-in POST of 4 MB to the consult page or the patient record passes to the action", async () => {
    expect(passedOn(await proxy(request(`/consultation/${VISIT}`, { length: String(4 * MB), signedIn: true })))).toBe(true);
    expect(passedOn(await proxy(request("/patients/abc", { length: String(4 * MB), signedIn: true })))).toBe(true);
  });

  it("small bodies, bodiless POSTs and deletes, and GETs pass whoever sends them", async () => {
    expect(passedOn(await proxy(request("/login", { length: "512" })))).toBe(true);
    expect(passedOn(await proxy(request("/login", { length: String(MB) })))).toBe(true);
    expect(passedOn(await proxy(request("/login", { method: "DELETE", length: null })))).toBe(true);
    expect(passedOn(await proxy(request("/login", { length: null })))).toBe(true);
    expect(passedOn(await proxy(request("/login", { method: "GET", length: String(50 * MB) })))).toBe(true);
  });
});
