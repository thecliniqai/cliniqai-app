/**
 * PR 2 review N5: a database refusal of the Schedule range or the session bootstrap (the INVOKER function answered NULL after the route's session check:
 * a permission, access or active-clinic change in between) is an answer, not an outage. The routes answer 403 `ACCESS_REFUSED` (not 500) and log it at
 * info, never at error level; a failed database call is still 500 with an error line. The layout's speculative read of the pinned clinic logs nothing on a
 * refusal. The context and the database call are fakes here; the SQL refusals are pgTAP (`schedule_range`, `session_bootstrap`).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), rpc: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": "3b0e6b8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }),
}));

vi.mock("@/lib/auth/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/context")>()),
  resolveServiceContext: mocks.resolve,
}));

import { NextRequest } from "next/server";
import { GET as getRange } from "@/app/api/schedule/range/route";
import { GET as getBootstrap } from "@/app/api/session/bootstrap/route";
import { readSessionBootstrap } from "@/features/session/queries";

const USER = "00000000-0000-4000-8000-00000000a001";
const TENANT = "00000000-0000-4000-8000-00000000b001";

let stdout: MockInstance;
let stderr: MockInstance;

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { userId: USER, tenantId: TENANT, role: "receptionist", actorType: "user", db: { rpc: mocks.rpc } } });
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolve.mockReset();
  mocks.rpc.mockReset();
});

/** The logger's JSON lines: `{ level, event, ... }` from both streams. */
function lines(): Array<Record<string, unknown>> {
  return [...stdout.mock.calls, ...stderr.mock.calls]
    .map((call) => String(call[0]))
    .filter((chunk) => chunk.startsWith("{"))
    .map((chunk) => JSON.parse(chunk) as Record<string, unknown>)
    .filter((line) => typeof line.event === "string" && /^(schedule\.range|session\.bootstrap)\./.test(line.event));
}

const rangeRequest = () => new NextRequest("http://localhost:3000/api/schedule/range?from=2031-03-03&to=2031-03-09");
const bootstrapRequest = () => new NextRequest("http://localhost:3000/api/session/bootstrap");

describe("GET /api/schedule/range: a database refusal", () => {
  it("answers 403 ACCESS_REFUSED with a fixed body, logged at info and never as an error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await getRange(rangeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden", code: "ACCESS_REFUSED" });
    expect(lines().map((l) => [l.level, l.event])).toEqual([["info", "schedule.range.refused"]]);
  });

  it("a failed call is still 500 and an error line", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const res = await getRange(rangeRequest());
    expect(res.status).toBe(500);
    expect(lines().map((l) => [l.level, l.event])).toEqual([["error", "schedule.range.failed"]]);
  });
});

describe("GET /api/session/bootstrap: a database refusal", () => {
  it("answers 403 ACCESS_REFUSED, logged at info and never as an error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await getBootstrap(bootstrapRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden", code: "ACCESS_REFUSED" });
    expect(lines().map((l) => [l.level, l.event])).toEqual([["info", "session.bootstrap.refused"]]);
  });

  it("a failed call is still 500 and an error line", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    expect((await getBootstrap(bootstrapRequest())).status).toBe(500);
    expect(lines().map((l) => [l.level, l.event])).toEqual([["error", "session.bootstrap.failed"]]);
  });
});

describe("the layout's speculative read of the pinned clinic", () => {
  it("logs nothing when the database refuses (a pinned clinic the user left, a locked clinic), and is not used", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await readSessionBootstrap(db as any, TENANT, { speculative: true })).toEqual({ ok: false, reason: "refused" });
    expect(lines()).toEqual([]);
  });

  it("still logs a failed call as an error", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await readSessionBootstrap(db as any, TENANT, { speculative: true })).toEqual({ ok: false, reason: "failed" });
    expect(lines().map((l) => [l.level, l.event])).toEqual([["error", "session.bootstrap.failed"]]);
  });
});
