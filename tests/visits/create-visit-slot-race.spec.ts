/**
 * `createVisit` under the `visits_no_double_booking` race (V2-05 05-08, DB-08, T-05-20), with a stubbed database so
 * every outcome is forced. Two concurrent inserts of conflicting slots can each find the other's uncommitted row while
 * checking the exclusion constraint; PostgreSQL then aborts one of them as a deadlock (40P01) rather than 23P01 (seen
 * in the barrier spec tests/scheduling/no-double-booking.spec.ts). The other transaction commits, so `createVisit`
 * retries once: the retry answers 23P01 (slot taken → CONFLICT) or succeeds. Synthetic ids only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-refs", () => ({
  patientInTenant: vi.fn(async () => true),
  memberOfTenant: vi.fn(async () => true),
}));
vi.mock("@/lib/audit/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

import { createVisit, SLOT_TAKEN_MESSAGE, SLOT_TAKEN_REASON } from "@/features/visits/service";
import { mockCtx } from "../helpers/context";

type InsertResult = { data: { id: string } | null; error: { code: string; message: string } | null };

const DEADLOCK: InsertResult = { data: null, error: { code: "40P01", message: "deadlock detected" } };
const SLOT_TAKEN: InsertResult = {
  data: null,
  error: { code: "23P01", message: 'conflicting key value violates exclusion constraint "visits_no_double_booking"' },
};
const STORED: InsertResult = { data: { id: "00000000-0000-4000-8000-0000000000c1" }, error: null };

/** A client whose visit inserts answer `results` in order (one per insert). */
function dbAnswering(results: InsertResult[]) {
  const inserts: unknown[] = [];
  const db = {
    from: (table: string) => {
      if (table !== "visits") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: unknown) => {
          inserts.push(row);
          const result = results[inserts.length - 1];
          return { select: () => ({ single: async () => result }) };
        },
      };
    },
  };
  return { db, inserts };
}

const input = {
  patient_id: "00000000-0000-4000-8000-0000000000a1",
  doctor_id: "00000000-0000-4000-8000-0000000000a2",
  origin_type: "scheduled" as const,
  scheduled_at: "2031-03-03T05:00:00.000Z",
  estimated_duration_minutes: 15,
  is_overbooked: false,
};

describe("createVisit: the slot race (05-08)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a deadlock (40P01) is retried once; the retry's 23P01 is reported as the taken slot", async () => {
    const { db, inserts } = dbAnswering([DEADLOCK, SLOT_TAKEN]);
    const res = await createVisit(mockCtx(db), input);
    expect(inserts).toHaveLength(2);
    expect(res).toEqual({ success: false, conflict: true, code: "CONFLICT", reason: SLOT_TAKEN_REASON, error: SLOT_TAKEN_MESSAGE });
  });

  it("a deadlock whose retry succeeds books the visit", async () => {
    const { db, inserts } = dbAnswering([DEADLOCK, STORED]);
    const res = await createVisit(mockCtx(db), input);
    expect(inserts).toHaveLength(2);
    expect(res).toEqual({ success: true, visitId: STORED.data!.id });
  });

  it("a 23P01 on the first insert is not retried", async () => {
    const { db, inserts } = dbAnswering([SLOT_TAKEN]);
    const res = await createVisit(mockCtx(db), input);
    expect(inserts).toHaveLength(1);
    expect(res).toMatchObject({ success: false, conflict: true, reason: SLOT_TAKEN_REASON });
  });

  it("a second deadlock is not retried again and stays a generic failure", async () => {
    const { db, inserts } = dbAnswering([DEADLOCK, DEADLOCK]);
    const res = await createVisit(mockCtx(db), input);
    expect(inserts).toHaveLength(2);
    expect(res).toEqual({ success: false, error: "Failed to schedule visit in database." });
  });
});
