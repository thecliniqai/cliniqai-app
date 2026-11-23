/**
 * V2-09d 09D-01a (A-10): the per-request memo (`lib/auth/request-memo.ts`) and the clinic zone read on top of it
 * (`getTenantTimeZone`). One request scope = one `headers()` object (a fake here, as Next resolves it once per request).
 *
 * - a successful zone read is shared by every later reader of the request;
 * - a failed read answers the default zone to its own callers but is not kept: the next reader in the same request asks
 *   the database again and gets the clinic's real zone (a transient failure never pins the default zone for a request);
 * - a new request asks again.
 * The database client is a fake that records each `tenants` read. Synthetic ids only.
 */
import { describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ current: {} as object }));

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return { ...actual, headers: async () => scope.current };
});

import { getTenantTimeZone } from "@/lib/datetime/server";
import { DEFAULT_CLINIC_TZ } from "@/lib/datetime";
import { requestMemo } from "@/lib/auth/request-memo";

const TENANT = "00000000-0000-4000-8000-0000000000e1";

/** A `tenants` reader that answers each read from `answers` in turn (an error or a zone) and counts the reads. */
function fakeDb(answers: Array<{ error: object } | { zone: string }>) {
  const reads = { count: 0 };
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const a = answers[Math.min(reads.count++, answers.length - 1)]!;
            return "error" in a ? { data: null, error: a.error } : { data: { timezone: a.zone }, error: null };
          },
        }),
      }),
    }),
  };
  return { db: db as never, reads };
}

describe("A-10: a failed zone read is not memoised for the request", () => {
  it("success: one read for the whole request; a new request reads again", async () => {
    scope.current = {};
    const { db, reads } = fakeDb([{ zone: "Asia/Dubai" }]);
    expect(await getTenantTimeZone(db, TENANT)).toBe("Asia/Dubai");
    expect(await getTenantTimeZone(db, TENANT)).toBe("Asia/Dubai");
    expect(reads.count).toBe(1);
    scope.current = {};
    expect(await getTenantTimeZone(db, TENANT)).toBe("Asia/Dubai");
    expect(reads.count).toBe(2);
  });

  it("a transient failure: the default zone for that reader, the clinic's real zone for the next reader of the same request", async () => {
    scope.current = {};
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { db, reads } = fakeDb([{ error: { code: "PGRST000", message: "synthetic outage" } }, { zone: "Asia/Dubai" }]);
    expect(await getTenantTimeZone(db, TENANT)).toBe(DEFAULT_CLINIC_TZ);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await getTenantTimeZone(db, TENANT)).toBe("Asia/Dubai");
    // ... and that answer is kept for the rest of the request.
    expect(await getTenantTimeZone(db, TENANT)).toBe("Asia/Dubai");
    expect(reads.count).toBe(2);
    vi.restoreAllMocks();
  });

  it("requestMemo: callers already waiting on a dropped answer share it; the entry is gone once it settles", async () => {
    scope.current = {};
    let loads = 0;
    const load = async () => ({ n: ++loads, fallback: true });
    const [a, b] = await Promise.all([
      requestMemo("k", load, { keep: (v) => !v.fallback }),
      requestMemo("k", load, { keep: (v) => !v.fallback }),
    ]);
    expect(a).toBe(b);
    expect(loads).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await requestMemo("k", load, { keep: (v) => !v.fallback })).n).toBe(2);
  });
});
