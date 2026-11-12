/**
 * F7 (V2-01): deleting a schedule block needs the same permission as creating it. A doctor may delete their own
 * block; another doctor's block or a clinic-wide block needs clinic:manage. Runs on the local stack with each seeded
 * user's own JWT client.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { createScheduleBlock, deleteScheduleBlock } from "@/features/visits/scheduling-service";

describe("deleteScheduleBlock permission (F7)", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let otherDoctor: SeededTenant;
  let receptionist: SeededTenant;
  let dayOffset = 10;

  async function block(doctorId: string | null): Promise<string> {
    const start = new Date(Date.now() + dayOffset++ * 86400000);
    const end = new Date(start.getTime() + 60 * 60000);
    const res = await createScheduleBlock(ctxFor(owner), {
      doctor_id: doctorId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      reason: "Synthetic block",
      all_day: false,
    });
    if (!res.success) throw new Error(`block seed failed: ${res.error}`);
    return res.block.id;
  }

  async function exists(blockId: string): Promise<boolean> {
    const { data } = await owner.client.from("schedule_blocks").select("id").eq("id", blockId).maybeSingle();
    return Boolean(data);
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Block Guard Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    otherDoctor = await addMemberToTenant(owner.tenantId, "doctor");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  });

  it("refuses a receptionist deleting a clinic-wide block; the block remains", async () => {
    const id = await block(null);
    const res = await deleteScheduleBlock(ctxFor(receptionist), id);
    expect(res.success).toBe(false);
    expect(await exists(id)).toBe(true);
  });

  it("refuses a doctor deleting a clinic-wide block or another doctor's block", async () => {
    const clinicWide = await block(null);
    const others = await block(otherDoctor.userId);
    expect((await deleteScheduleBlock(ctxFor(doctor), clinicWide)).success).toBe(false);
    expect((await deleteScheduleBlock(ctxFor(doctor), others)).success).toBe(false);
    expect(await exists(clinicWide)).toBe(true);
    expect(await exists(others)).toBe(true);
  });

  it("lets a doctor delete their own block", async () => {
    const own = await block(doctor.userId);
    expect((await deleteScheduleBlock(ctxFor(doctor), own)).success).toBe(true);
    expect(await exists(own)).toBe(false);
  });

  it("lets the owner (clinic:manage) delete a clinic-wide block", async () => {
    const id = await block(null);
    expect((await deleteScheduleBlock(ctxFor(owner), id)).success).toBe(true);
    expect(await exists(id)).toBe(false);
  });
});
