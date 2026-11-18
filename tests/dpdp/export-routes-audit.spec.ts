/**
 * Both DPDP export routes (in-app `GET /api/patients/:id/export` and `GET /api/v1/patients/:id/export`) write exactly
 * one `dpdp.data_export` audit row per export and none for a failed one (V2-05 05a review INT L-1; plan 05-11c).
 * Before, the PDF path wrote two rows (the service audited, then the route audited again), and an export whose section
 * query failed answered 200 with a partial archive and a "completed" row.
 *
 * Local stack, real routes and real audit rows. The in-app route reads with the owner's own JWT client (the
 * `createClient()` of `@/lib/supabase/server` is replaced by it, as in tests/security/dpdp-export-route.spec.ts); the
 * v1 route reads with the real system client. A failed section is injected by wrapping that client so one table's
 * query answers an error; everything else is real. Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const mockState = vi.hoisted(() => ({ client: null as unknown, faultTable: null as string | null }));

/** Wraps a Supabase client so `from(faultTable)` answers every query with an error (all else passes through). */
function withFault<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          if (table !== mockState.faultTable) return (target as { from: (t: string) => unknown }).from(table);
          const failure = { data: null, error: { code: "XX000", message: "SENTINEL_EXPORT_FAULT" } };
          const chain: unknown = new Proxy(
            {},
            {
              get(_t, p) {
                if (p === "then") return (resolve: (v: unknown) => void) => resolve(failure);
                return () => chain;
              },
            }
          );
          return chain;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => withFault(mockState.client as object) };
});

vi.mock("@/lib/supabase/system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/system")>();
  return { ...actual, getSystemDb: (reason: Parameters<typeof actual.getSystemDb>[0]) => withFault(actual.getSystemDb(reason)) };
});

import { GET as appExport } from "@/app/api/patients/[id]/export/route";
import { GET as v1Export } from "@/app/api/v1/patients/[id]/export/route";
import { createApiKeySecret } from "@/lib/api/auth";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

enableApiV1ForFile();

const admin = getAdminClient();

describe("DPDP export routes: one audit row per export, none for a failed one (05-11c, INT L-1)", () => {
  let A: SeededTenant;
  let rawKey: string;

  beforeAll(async () => {
    A = await seedTenantWithOwner(`Synthetic Export Audit ${randomUUID().slice(0, 8)}`);
    const secret = createApiKeySecret();
    const { error } = await admin.from("api_keys").insert({
      tenant_id: A.tenantId,
      name: "Synthetic export audit key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: A.userId,
      scopes: ["exports:create"],
    });
    if (error) throw new Error(`seed api key failed: ${error.code}`);
    rawKey = secret.rawToken;
  }, 60_000);

  afterEach(() => {
    mockState.faultTable = null;
  });

  async function seedPatient(): Promise<string> {
    const { data, error } = await admin
      .from("patients")
      .insert({
        tenant_id: A.tenantId,
        full_name: "Synthetic Export Audit Patient",
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        created_by: A.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed patient failed: ${error?.code}`);
    return data.id;
  }

  async function exportAudits(patientId: string): Promise<Array<{ format: unknown; status: unknown }>> {
    const { data, error } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("tenant_id", A.tenantId)
      .eq("action", "dpdp.data_export")
      .eq("entity_id", patientId);
    if (error) throw new Error(`audit read failed: ${error.code}`);
    return (data ?? []).map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return { format: m.format, status: m.status };
    });
  }

  const ROUTES = [
    [
      "in-app route",
      (id: string, format: string) => {
        mockState.client = A.client;
        return appExport(new NextRequest(`http://localhost/api/patients/${id}/export?format=${format}`), {
          params: Promise.resolve({ id }),
        });
      },
    ],
    [
      "v1 route (scoped API key)",
      (id: string, format: string) =>
        v1Export(
          new NextRequest(`http://localhost/api/v1/patients/${id}/export?format=${format}`, {
            headers: { authorization: `Bearer ${rawKey}` },
          }),
          { params: Promise.resolve({ id }) }
        ),
    ],
  ] as const;

  describe.each(ROUTES)("%s", (_name, exportAs) => {
    it("a PDF export writes exactly one audit row (before: two)", async () => {
      const patientId = await seedPatient();
      const res = await exportAs(patientId, "pdf");
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
      expect(await exportAudits(patientId)).toEqual([{ format: "pdf", status: "completed" }]);
    }, 60_000);

    it("a JSON export writes exactly one audit row", async () => {
      const patientId = await seedPatient();
      const res = await exportAs(patientId, "json");
      expect(res.status).toBe(200);
      expect((await res.json()).patient.id).toBe(patientId);
      expect(await exportAudits(patientId)).toEqual([{ format: "json", status: "completed" }]);
    });

    it.each(["prescriptions", "consent_records", "visits", "tenants"])(
      "a failed %s query → 500 with a fixed text, no archive, no audit row (before: 200, partial, 'completed')",
      async (table) => {
        const patientId = await seedPatient();
        mockState.faultTable = table;
        for (const format of ["json", "pdf"]) {
          const res = await exportAs(patientId, format);
          expect(res.status, format).toBe(500);
          const text = await res.text();
          // The in-app route's fixed text, or the v1 envelope's (it replaces any 5xx text with a fixed one).
          expect(text).toMatch(/Export failed\. Please try again\.|An internal database error occurred\./);
          expect(text).not.toContain("SENTINEL");
          expect(text).not.toContain("Synthetic Export Audit Patient");
        }
        expect(await exportAudits(patientId)).toEqual([]);
      },
      60_000
    );
  });
});
