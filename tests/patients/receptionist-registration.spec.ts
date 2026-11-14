/**
 * A receptionist registers and edits patients (V2-05 05-02b; roadmap V2-05 acceptance 5 "a receptionist can register a
 * patient"; P0-14, PO-3, R-8; threat T-05-10).
 *
 * The permission landed in 05-01b (`patients:edit` for receptionists); 000055 binds the patients policies to the
 * active clinic and adds `patients_clinical_fields_guard`: a caller without consultations:view in the row's clinic
 * may update demographics but not allergies or chronic conditions (R-8). INSERT is not restricted, so the desk may
 * record allergies at intake.
 *
 * Every call goes through the real service with the user's own JWT client (RLS applies, as in a request); rows are
 * read back with the service-role client. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPatient, updatePatient, PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE } from "@/features/patients/service";
import type { PatientInput } from "@/features/patients/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

/** A synthetic 10-digit mobile in the reserved 90000000xx range, unique per call within a run. */
let phoneSeq = 0;
function syntheticMobile(): string {
  phoneSeq = (phoneSeq + 1) % 100;
  return `90000000${String(phoneSeq).padStart(2, "0")}`;
}

function input(over: Partial<PatientInput> = {}): PatientInput {
  return {
    full_name: "Synthetic Desk Patient",
    phone: syntheticMobile(),
    sex: "female",
    age: 34,
    allergies: [],
    chronic_conditions: [],
    ...over,
  } as PatientInput;
}

describe("receptionist registration and demographics (05-02b, acceptance 5, R-8)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let receptionist: SeededTenant;
  let doctor: SeededTenant;
  let otherClinic: SeededTenant;

  async function patientRow(id: string) {
    const { data, error } = await admin
      .from("patients")
      .select("tenant_id, full_name, phone, allergies, chronic_conditions, created_by")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Registration Clinic");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    otherClinic = await seedTenantWithOwner("Synthetic Registration Other Clinic");
  });

  it("a receptionist session registers a patient: success, the row exists in the clinic with created_by = receptionist", async () => {
    const res = await createPatient(ctxFor(receptionist), input({ allergies: ["Synthetic allergen"] }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const row = await patientRow(res.patientId);
    expect(row.tenant_id).toBe(owner.tenantId);
    expect(row.created_by).toBe(receptionist.userId);
    // Intake may record allergies (INSERT is not restricted, R-8).
    expect(row.allergies).toEqual(["Synthetic allergen"]);
  });

  it("the receptionist updates the phone; the allergies stay as they were", async () => {
    const created = await createPatient(ctxFor(receptionist), input({ allergies: ["Synthetic allergen"] }));
    if (!created.success) throw new Error(created.error);
    const phone = syntheticMobile();

    const res = await updatePatient(
      ctxFor(receptionist),
      created.patientId,
      input({ phone, allergies: ["Synthetic allergen"] }),
    );
    expect(res.success).toBe(true);
    const row = await patientRow(created.patientId);
    expect(row.phone).toBe(`+91${phone}`);
    expect(row.allergies).toEqual(["Synthetic allergen"]);
  });

  it("a receptionist's change of allergies or chronic conditions is refused (FORBIDDEN text) and nothing changes", async () => {
    const created = await createPatient(ctxFor(receptionist), input({ allergies: ["Synthetic allergen"] }));
    if (!created.success) throw new Error(created.error);
    const before = await patientRow(created.patientId);

    const allergies = await updatePatient(
      ctxFor(receptionist),
      created.patientId,
      input({ full_name: "Synthetic Renamed", allergies: ["Synthetic allergen", "Second allergen"] }),
    );
    expect(allergies).toEqual({ success: false, error: PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE });

    const chronic = await updatePatient(
      ctxFor(receptionist),
      created.patientId,
      input({ allergies: ["Synthetic allergen"], chronic_conditions: ["Synthetic condition"] }),
    );
    expect(chronic).toEqual({ success: false, error: PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE });

    expect(await patientRow(created.patientId)).toEqual(before);
  });

  it("the database refuses the allergy change itself (42501), even past the service", async () => {
    const created = await createPatient(ctxFor(receptionist), input({ allergies: ["Synthetic allergen"] }));
    if (!created.success) throw new Error(created.error);

    const { data, error } = await receptionist.client
      .from("patients")
      .update({ allergies: [] })
      .eq("id", created.patientId)
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await patientRow(created.patientId)).allergies).toEqual(["Synthetic allergen"]);

    // Demographics through the same raw path are admitted.
    const ok = await receptionist.client
      .from("patients")
      .update({ full_name: "Synthetic Raw Rename" })
      .eq("id", created.patientId)
      .select("id");
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
  });

  it("a doctor (consultations:view) changes allergies", async () => {
    const created = await createPatient(ctxFor(receptionist), input());
    if (!created.success) throw new Error(created.error);
    const res = await updatePatient(ctxFor(doctor), created.patientId, input({ allergies: ["Synthetic allergen"] }));
    expect(res.success).toBe(true);
    expect((await patientRow(created.patientId)).allergies).toEqual(["Synthetic allergen"]);
  });

  describe("a receptionist of this clinic who is also a member of another clinic (R-42 active tenant)", () => {
    let dualCtx: (actingIn: string) => Promise<ServiceContext>;

    beforeAll(async () => {
      const dual = await createDualMembershipUser(owner.tenantId, "receptionist", otherClinic.tenantId, "receptionist");
      dualCtx = async (actingIn) => ({
        userId: dual.userId,
        tenantId: owner.tenantId,
        role: "receptionist",
        actorType: "user",
        db: await signInActingIn(dual.userEmail, actingIn),
      });
    });

    it("acting in this clinic, registers a patient here", async () => {
      const res = await createPatient(await dualCtx(owner.tenantId), input());
      expect(res.success).toBe(true);
    });

    it("acting in the other clinic, cannot register or edit a patient of this clinic", async () => {
      const ctx = await dualCtx(otherClinic.tenantId);
      const created = await createPatient(ctx, input());
      expect(created.success).toBe(false);

      const existing = await createPatient(ctxFor(receptionist), input());
      if (!existing.success) throw new Error(existing.error);
      const before = await patientRow(existing.patientId);
      const edited = await updatePatient(ctx, existing.patientId, input({ full_name: "Synthetic Cross Clinic" }));
      expect(edited.success).toBe(false);
      expect(await patientRow(existing.patientId)).toEqual(before);
    });
  });
});
