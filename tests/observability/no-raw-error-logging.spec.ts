/**
 * V2-03 03-09c (P1-25, BACKEND H1, T-03-03): server error branches log through `lib/log`, never `console.*`, and a
 * line carries the event and the error's code, never the error object or its message.
 *
 * Each case drives a real server path into its error branch with a synthetic PostgREST-style error whose message holds
 * the row values Postgres would echo back (`Key (phone)=(...)`, an email address). Everything the path writes (stdout,
 * stderr and any `console.*` call) is captured; it must contain the event and `23505` and none of the phone, the email
 * or the message text. Before the sweep these paths printed the raw error through `console.error`.
 *
 * Paths: a labs write (`generateDocumentShareToken`, which replaced `deleteLabDocument` when lab documents became append-only, V2-09a 000110; the patients write case went with the retired `createPatient`, V2-08 08-06a), the prescription PDF route
 * (`GET /api/visits/[id]/prescription-pdf`), the v1 error envelope (`apiError`) (04-03b deleted the cron webhook route and its case).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ServiceContext } from "@/lib/auth/context";

const REQUEST_ID = "3b0e6b8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const TENANT_ID = "7d1c0b9a-8e7f-4a6b-9c5d-4e3f2a1b0c9d";
const USER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DOCUMENT_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const PHONE = "+919000000001";
const EMAIL = "synthetic.user@example.test";
const MESSAGE = `duplicate key value violates unique constraint "patients_phone_key" Key (phone)=(${PHONE}) contact ${EMAIL}`;

/** A thrown error that carries the same text (an exception rather than a returned `error`). */
function thrownPhiError(): Error & { code: string } {
  return Object.assign(new Error(MESSAGE), { code: "23505" });
}

const mocks = vi.hoisted(() => ({ resolveServiceContext: vi.fn(), getSystemDb: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": "3b0e6b8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }),
}));

vi.mock("@/lib/auth/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/context")>()),
  resolveServiceContext: mocks.resolveServiceContext,
}));

vi.mock("@/lib/supabase/system", () => ({ getSystemDb: mocks.getSystemDb }));

import { generateDocumentShareToken } from "@/features/labs/service";
import { GET as getPrescriptionPdf } from "@/app/api/visits/[id]/prescription-pdf/route";
import { apiError } from "@/lib/api/envelope";

type Result = { data: unknown; error: unknown };

/**
 * A minimal chainable stand-in for the Supabase query builder: every filter returns the builder, `.single()` and
 * `await builder` resolve to `respond(table, operation)`.
 */
function fakeDb(respond: (table: string, op: string) => Result): ServiceContext["db"] {
  const builder = (table: string) => {
    let op = "select";
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "insert", "update", "delete", "upsert"]) {
      chain[name] = () => {
        if (name !== "select" || op === "select") op = name;
        return chain;
      };
    }
    for (const name of ["eq", "neq", "in", "is", "order", "limit", "range", "gte", "lte", "lt", "gt", "contains"]) {
      chain[name] = () => chain;
    }
    chain.single = async () => respond(table, op);
    chain.maybeSingle = async () => respond(table, op);
    chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(table, op)).then(resolve, reject);
    return chain;
  };
  return { from: builder, auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as ServiceContext["db"];
}

function ctxWith(db: ServiceContext["db"]): ServiceContext {
  return { userId: USER_ID, tenantId: TENANT_ID, role: "owner", actorType: "user", db };
}

let stdout: MockInstance;
let stderr: MockInstance;
let consoleSpies: MockInstance[];

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolveServiceContext.mockReset();
  mocks.getSystemDb.mockReset();
});

/** Everything the code under test wrote: stream writes and console arguments, serialised. */
function captured(): string {
  const streams = [...stdout.mock.calls, ...stderr.mock.calls].map((call) => String(call[0]));
  const consoleArgs = consoleSpies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call, errorReplacer)));
  return [...streams, ...consoleArgs].join("\n");
}

function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}

/** The JSON lines the logger wrote with `event`. */
function linesFor(event: string): Array<Record<string, unknown>> {
  return [...stdout.mock.calls, ...stderr.mock.calls]
    .map((call) => String(call[0]))
    .filter((chunk) => chunk.startsWith("{"))
    .map((chunk) => JSON.parse(chunk) as Record<string, unknown>)
    .filter((line) => line.event === event);
}

function expectNoRawError(): void {
  const out = captured();
  expect(out).not.toContain(PHONE);
  expect(out).not.toContain("9000000001");
  expect(out).not.toContain(EMAIL);
  expect(out).not.toContain("duplicate key value");
  expect(out).not.toContain("Key (phone)");
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
}

describe("server error branches log the event and code, never the raw error (03-09c)", () => {
  it("labs write: generateDocumentShareToken failure", async () => {
    // The document read throws (a driver error carrying PHI in its text): a fixed result, one tagged line, never the raw text.
    const db = fakeDb(() => {
      throw thrownPhiError();
    });

    const result = await generateDocumentShareToken(ctxWith(db), DOCUMENT_ID);

    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).not.toContain(PHONE);
    // The PHI check first: before the sweep it fails on the raw text, not only on the missing event.
    expectNoRawError();
    const [line] = linesFor("labs.share_token.failed");
    expect(line).toMatchObject({ level: "error", code: "23505", requestId: REQUEST_ID, tenantId: TENANT_ID });
  });

  it("prescription PDF route: an exception becomes a fixed 500 and one line", async () => {
    // The route loads the visit through the shared payload builder (V2-09a); an exception thrown by that read is the branch under test.
    const db = fakeDb(() => {
      throw thrownPhiError();
    });
    mocks.resolveServiceContext.mockResolvedValue({ ok: true, ctx: ctxWith(db) });

    const res = await getPrescriptionPdf(new Request(`http://localhost/api/visits/${DOCUMENT_ID}/prescription-pdf`), {
      params: Promise.resolve({ id: DOCUMENT_ID }),
    });

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
    // The PHI check first: before the sweep it fails on the raw text, not only on the missing event.
    expectNoRawError();
    const [line] = linesFor("prescriptions.pdf_route.failed");
    expect(line).toMatchObject({ level: "error", code: "23505", requestId: REQUEST_ID });
  });

  it("v1 envelope: a 5xx logs the envelope code and request id, not the message or details", async () => {
    const res = await apiError("DATABASE_ERROR", MESSAGE, 500, { detail: `Key (phone)=(${PHONE})` });

    const body = await res.json();
    expect(body.error).toEqual({
      code: "DATABASE_ERROR",
      message: "An internal database error occurred.",
      correlation_id: REQUEST_ID,
    });
    // The PHI check first: before the sweep it fails on the raw text, not only on the missing event.
    expectNoRawError();
    const [line] = linesFor("api.v1.failed");
    // 03-13d M-LOGFIELDS: log words are lower case; the envelope code is written through logWord().
    expect(line).toMatchObject({ level: "error", reason: "database_error", status: 500, requestId: REQUEST_ID });
  });
});
