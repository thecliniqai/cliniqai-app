/**
 * V2-09a 09A-01 (R-3, R-5): a signed consultation is sealed for EVERY writer, not only for a signed-in caller. The V2-05 guards
 * (000068, 000075, 000077) checked the seal only when `auth.uid()` was set, so the service role (the v1 API's client, a job, a
 * script) and a definer function called without a session could rewrite a signed record. These cases write as the service role
 * and read the rows back. Each refusal is SQLSTATE 42501 with a fixed name; the same write succeeds on a draft and on a reopened
 * (amending) visit, so a refusal is the seal and not a broken fixture. Synthetic data only.
 *
 * "Fails without the change": the first case of each block fails on migration 000106 (the service-role UPDATE succeeds there).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedClinicalVisit, signVisitAs, reopenVisitAs } from "../helpers/clinical-commands";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

describe("the service role cannot rewrite the notes of a signed visit (R-3, tracer)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Seal System Path Clinic");
  }, 60_000);

  async function noteOf(visitId: string): Promise<string | null> {
    const { data, error } = await admin.from("clinical_notes").select("clinical_notes").eq("visit_id", visitId).single();
    if (error || !data) throw new Error(`note read failed: ${error?.message}`);
    return data.clinical_notes;
  }

  it("a sealed visit refuses the service-role UPDATE with CLINICAL_NOTES_VISIT_SIGNED and the note is unchanged", async () => {
    const v = await seedClinicalVisit(owner, { notes: "Signed note, version 1." });
    await signVisitAs(owner, v.visitId);

    const { error } = await admin.from("clinical_notes").update({ clinical_notes: "Rewritten by the system." }).eq("visit_id", v.visitId);
    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("CLINICAL_NOTES_VISIT_SIGNED");
    expect(await noteOf(v.visitId)).toBe("Signed note, version 1.");
  });

  it("a draft visit admits the same service-role UPDATE (control: the refusal above is the seal)", async () => {
    const v = await seedClinicalVisit(owner, { notes: "Draft note." });
    const { error } = await admin.from("clinical_notes").update({ clinical_notes: "Draft note, edited." }).eq("visit_id", v.visitId);
    expect(error).toBeNull();
    expect(await noteOf(v.visitId)).toBe("Draft note, edited.");
  });

  it("an amending visit (reopened) admits it as well", async () => {
    const v = await seedClinicalVisit(owner, { notes: "Signed note." });
    await signVisitAs(owner, v.visitId);
    await reopenVisitAs(owner, v.visitId);

    const { error } = await admin.from("clinical_notes").update({ clinical_notes: "Amended note." }).eq("visit_id", v.visitId);
    expect(error).toBeNull();
    expect(await noteOf(v.visitId)).toBe("Amended note.");
  });
});
