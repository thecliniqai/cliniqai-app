/**
 * V2-09e 09E-14a (finding A): `GET /api/live/state` answers 409 CLINIC_CHANGED (fixed body, no versions) when the client's `x-clinicos-tenant` names another
 * clinic than the session's, and its plain read still works with the own clinic's header or none. Local stack; the server client is a seeded user's own JWT client.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const mockState = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockState.client }));

import { GET } from "@/app/api/live/state/route";

let a: SeededTenant;
let b: SeededTenant;
const state = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/live/state", { headers }));

beforeAll(async () => {
  a = await seedTenantWithOwner("Route State A");
  b = await seedTenantWithOwner("Route State B");
  mockState.client = a.client;
});

describe("GET /api/live/state, clinic header", () => {
  it("409 CLINIC_CHANGED for another clinic's id: fixed body, no versions, no-store", async () => {
    const res = await state({ "x-clinicos-tenant": b.tenantId });
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "The clinic changed.", code: "CLINIC_CHANGED" });
  });
  it("200 with the session's own clinic id, and without the header", async () => {
    for (const headers of [{ "x-clinicos-tenant": a.tenantId }, {} as Record<string, string>]) {
      const res = await state(headers);
      expect(res.status).toBe(200);
      expect(Object.keys((await res.json()) as object)).toEqual(["versions", "access"]);
    }
  });
});
