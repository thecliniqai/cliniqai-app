/**
 * V2-09e 09E-14a (finding A): the client's side of CLINIC_CHANGED: the header names the clinic, only the server's fixed 409 counts, and the handler clears the
 * data layer first, navigates to Today once, and never twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clinicHeaders, isClinicChanged, onClinicChanged, resetClinicChangedForTests } from "@/lib/live/clinic-changed";

beforeEach(() => {
  resetClinicChangedForTests();
  vi.stubGlobal("window", { location: { origin: "http://localhost:3100" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("clinic header", () => {
  it("names the clinic in x-clinicos-tenant", () => {
    expect(clinicHeaders("t-1")).toEqual({ "x-clinicos-tenant": "t-1" });
  });
});

describe("isClinicChanged", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("true only for 409 with the fixed code, and leaves the body readable", async () => {
    const res = json(409, { error: "The clinic changed.", code: "CLINIC_CHANGED" });
    expect(await isClinicChanged(res)).toBe(true);
    expect((await res.json()).code).toBe("CLINIC_CHANGED");
  });
  it("false for another 409, another status or a non-JSON body", async () => {
    expect(await isClinicChanged(json(409, { code: "ROW_CHANGED" }))).toBe(false);
    expect(await isClinicChanged(json(403, { code: "CLINIC_CHANGED" }))).toBe(false);
    expect(await isClinicChanged(new Response("<html>", { status: 409 }))).toBe(false);
  });
});

describe("onClinicChanged", () => {
  it("runs the cleanups, then loads Today of the session's clinic, once however often it is called", async () => {
    const order: string[] = [];
    const deps = {
      runCleanups: async () => void order.push("cleanups"),
      assign: (url: string) => void order.push(`assign ${url}`),
    };
    onClinicChanged(deps);
    onClinicChanged(deps);
    await vi.waitFor(() => expect(order).toEqual(["cleanups", "assign http://localhost:3100/today"]));
  });
});
