import { describe, it, expect, vi } from "vitest";
import {
  getDoctorScheduleBlocks,
  updateClinicSettings,
  updateStatutorySettings,
  updateStaffMember,
} from "@/features/settings/service";
import { mockCtx } from "../helpers/context";

const DOCTOR_ID = "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a";

/** A fake client that records every `.or()` filter string and `.eq()` pair and resolves to no rows. */
function recordingClient() {
  const orFilters: string[] = [];
  const eqs: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "order"]) chain[m] = () => chain;
    chain.eq = (col: string, val: unknown) => {
      eqs.push([col, val]);
      return chain;
    };
    chain.or = (filter: string) => {
      orFilters.push(filter);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  });
  return { client: { from }, from, orFilters, eqs };
}

describe("settings services: permission is checked from the context role (ADR-0005 D1)", () => {
  it.each(["doctor", "receptionist", "nurse"] as const)(
    "a %s cannot change clinic or statutory settings or staff, and nothing is queried",
    async (role) => {
      const db = recordingClient();
      const ctx = mockCtx(db.client, { role });

      const clinic = await updateClinicSettings(ctx, { name: "Synthetic Clinic" } as never);
      const statutory = await updateStatutorySettings(ctx, { gstin: "29AAAAA0000A1Z5" });
      const staff = await updateStaffMember(ctx, { membership_id: DOCTOR_ID } as never);

      for (const res of [clinic, statutory, staff]) {
        expect(res.success).toBe(false);
        if (!res.success) expect(res.error).toMatch(/permission/i);
      }
      expect(db.from).not.toHaveBeenCalled();
    }
  );
});

describe("getDoctorScheduleBlocks never passes caller input into PostgREST filter syntax (R7)", () => {
  it("returns an empty list for a doctor id that is not a uuid, without querying", async () => {
    const db = recordingClient();
    const blocks = await getDoctorScheduleBlocks(mockCtx(db.client), `${DOCTOR_ID},doctor_id.not.is.null`);
    expect(blocks).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("filters to the doctor plus clinic-wide blocks for a valid uuid, scoped to the context tenant", async () => {
    const db = recordingClient();
    const ctx = mockCtx(db.client);
    await getDoctorScheduleBlocks(ctx, DOCTOR_ID);
    expect(db.orFilters).toEqual([`doctor_id.eq.${DOCTOR_ID},doctor_id.is.null`]);
    expect(db.eqs).toContainEqual(["tenant_id", ctx.tenantId]);
  });

  it("lists every block for 'all' without an OR filter", async () => {
    const db = recordingClient();
    await getDoctorScheduleBlocks(mockCtx(db.client), "all");
    expect(db.orFilters).toEqual([]);
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
