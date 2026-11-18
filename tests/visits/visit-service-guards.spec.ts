import { describe, it, expect, vi } from "vitest";
import { recordVisitVitals, getVisitsForDate } from "@/features/visits/service";
import { getScheduleBlocksForDate } from "@/features/visits/scheduling-service";
import { getQueueForDate } from "@/features/queue/service";
import { mockCtx } from "../helpers/context";

const NURSE_ID = "5b0c1d2e-3f40-4a51-8b62-7c83d94ea0b1";
const OTHER_USER_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const TENANT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const VISIT_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

/** A fake client that records every write and every `.or()` filter string. */
function recordingClient(notesRows: Array<Record<string, unknown>> = [{ visit_id: VISIT_ID }]) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const orFilters: string[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    // The clinical_notes write (V2-05 05-02a) asks for the affected rows; `notesRows` stands in for what RLS lets through.
    const result = { data: table === "clinical_notes" ? notesRows : [], error: null };
    for (const m of ["select", "eq", "lte", "gte", "order"]) chain[m] = () => chain;
    chain.or = (filter: string) => {
      orFilters.push(filter);
      return chain;
    };
    chain.update = (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return chain;
    };
    chain.insert = (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve({ error: null });
    };
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  });
  // The user-path audit row is written by public.log_audit (V2-05 05-02c): recorded as an `audit_logs` write with the RPC
  // arguments (the database takes the actor from the session; the app passes none).
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    inserts.push({ table: name === "log_audit" ? "audit_logs" : name, row: args });
    return Promise.resolve({ data: 1, error: null });
  });
  return { client: { from, rpc }, from, updates, inserts, orFilters };
}

describe("recordVisitVitals: the recorder is always the session user (ADR-0005 D1, SEC-02)", () => {
  it("ignores a caller-sent recorded_by and stores and audits the session user", async () => {
    const db = recordingClient();
    const ctx = mockCtx(db.client, { userId: NURSE_ID, tenantId: TENANT_ID, role: "nurse" });

    const res = await recordVisitVitals(ctx, VISIT_ID, {
      systolic: 120,
      diastolic: 80,
      weight: 70,
      height: 175,
      recorded_by: OTHER_USER_ID,
    } as never);

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.vitals.recorded_by).toBe(NURSE_ID);
    expect(res.vitals.bmi).toBe(22.9);

    // Vitals are written to clinical_notes (05-02a), never to visits.
    const notesUpdate = db.updates.find((u) => u.table === "clinical_notes");
    expect((notesUpdate?.values.vitals as { recorded_by: string }).recorded_by).toBe(NURSE_ID);
    expect(db.updates.filter((u) => u.table === "visits")).toEqual([]);

    const audit = db.inserts.find((i) => i.table === "audit_logs");
    expect(audit?.row).toMatchObject({ p_tenant: TENANT_ID, p_action: "vitals.record" });
    // No caller-chosen actor reaches the database at all: log_audit has no actor argument.
    expect(Object.keys(audit?.row ?? {}).sort()).toEqual(["p_action", "p_entity_id", "p_entity_type", "p_metadata", "p_tenant"]);
  });

  it("refuses, without an audit row, a vitals write that RLS filtered to 0 rows (V2-05 05-02a)", async () => {
    const db = recordingClient([]);
    const ctx = mockCtx(db.client, { userId: NURSE_ID, tenantId: TENANT_ID, role: "nurse" });

    const res = await recordVisitVitals(ctx, VISIT_ID, { systolic: 120, diastolic: 80 });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("You do not have permission to perform this action.");
    expect(db.inserts.filter((i) => i.table === "audit_logs")).toEqual([]);
  });

  it("denies a receptionist (no vitals:edit) without touching the database", async () => {
    const db = recordingClient();
    const ctx = mockCtx(db.client, { userId: NURSE_ID, tenantId: TENANT_ID, role: "receptionist" });

    const res = await recordVisitVitals(ctx, VISIT_ID, { systolic: 120, diastolic: 80 });

    expect(res.success).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("date and doctor values never reach PostgREST filter syntax unvalidated (R7)", () => {
  it("getVisitsForDate rejects a date that is not YYYY-MM-DD", async () => {
    const db = recordingClient();
    const res = await getVisitsForDate(mockCtx(db.client), "2026-10-15T00:00:00Z),or(tenant_id.neq.x");
    expect(res.success).toBe(false);
    expect(db.orFilters).toEqual([]);
  });

  it("getVisitsForDate accepts a calendar date and builds its day window", async () => {
    const db = recordingClient();
    const res = await getVisitsForDate(mockCtx(db.client), "2026-10-15");
    expect(res.success).toBe(true);
    expect(db.orFilters).toHaveLength(1);
    // The clinic day in the tenant zone (the mock has no tenants row, so the default Asia/Kolkata), half-open.
    expect(db.orFilters[0]).toContain("scheduled_at.gte.2026-10-14T18:30:00.000Z");
    expect(db.orFilters[0]).toContain("scheduled_at.lt.2026-10-15T18:30:00.000Z");
  });

  it("getQueueForDate rejects a date that is not YYYY-MM-DD", async () => {
    const db = recordingClient();
    const res = await getQueueForDate(mockCtx(db.client), "2026-10-15T00:00:00Z,tenant_id.neq.x");
    expect(res.success).toBe(false);
    expect(db.orFilters).toEqual([]);
  });

  it("getScheduleBlocksForDate returns nothing for a doctor id that is not a uuid", async () => {
    const db = recordingClient();
    const blocks = await getScheduleBlocksForDate(mockCtx(db.client), "2026-10-15", "x,doctor_id.not.is.null");
    expect(blocks).toEqual([]);
    expect(db.orFilters).toEqual([]);
  });
});
