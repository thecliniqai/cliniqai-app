/**
 * V2-09c 09C-02 (R-7, T-09C-05, T-09C-06): the allergy check inside `public.change_prescription`. A medicine that matches a recorded allergy is refused with
 * ALLERGY_MATCH (P0001, nothing written, no audit row) unless the change carries `allergy_override_reason` (5 to 300 characters); with a reason the line
 * stores {reason, allergens, by, at} and the audit counts it (`allergy_overrides`), never the text. An update with a reason confirms a line that matches an
 * allergy recorded after it was added. The check runs when the clinic holds `assist.allergy_check`; a platform override of the key is the kill switch.
 * `rx_allergy_context` (the screen's read) is checked against the same rule. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { ALLERGY_MATCH_MESSAGE } from "@/features/prescriptions/allergy";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows, commandResultRows } from "../helpers/billing-commands";
import { seedClinicalVisit } from "../helpers/clinical-commands";
import { changeRxAs, rxLine } from "../helpers/rx-lines";
import { AL_BRANDS, seedAllergyCatalogue } from "../helpers/cdci-allergy";
import type { Json } from "@/types/database";

const admin = getAdminClient();
let tenant: SeededTenant;
let doctor: SeededTenant;

beforeAll(async () => {
  await seedAllergyCatalogue();
  tenant = await seedTenantWithOwner("CI Allergy Check Clinic");
  doctor = await addMemberToTenant(tenant.tenantId, "doctor");
}, 120_000);

/** A visit of a patient with the given allergies (NULL = not recorded). */
async function visitWith(allergies: string[] | null) {
  const v = await seedClinicalVisit(tenant, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
  await admin.from("patients").update({ allergies }).eq("id", v.patientId).throwOnError();
  return v;
}

const call = (visitId: string, changes: Record<string, unknown>) =>
  doctor.client.rpc("change_prescription", { p_tenant_id: tenant.tenantId, p_visit_id: visitId, p_changes: changes as Json, p_client_request_id: randomUUID() });

async function items(visitId: string) {
  const { data } = await admin
    .from("prescriptions")
    .select("id, items:prescription_items(id, medicine_name, allergy_override)")
    .eq("visit_id", visitId);
  return (data ?? []).flatMap((p) => p.items as Array<{ id: string; medicine_name: string; allergy_override: Record<string, unknown> | null }>);
}

const amox = (over: Record<string, unknown> = {}) => rxLine({ medicine_name: AL_BRANDS.amoxBrand.brand, generic_name: AL_BRANDS.amoxBrand.generic, cdci_brand_id: AL_BRANDS.amoxBrand.id, ...over });
const para = () => rxLine({ medicine_name: AL_BRANDS.paraBrand.brand, generic_name: AL_BRANDS.paraBrand.generic, cdci_brand_id: AL_BRANDS.paraBrand.id });

describe("change_prescription: the allergy check (R-7)", () => {
  it("a matching add without a reason is ALLERGY_MATCH (P0001 -> CONFLICT): no row, no header, no claim, no audit row", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    const a = { add: [amox()] };
    const req = randomUUID();
    const res = await doctor.client.rpc("change_prescription", { p_tenant_id: tenant.tenantId, p_visit_id: v.visitId, p_changes: a as Json, p_client_request_id: req });
    expect(res.error).toMatchObject({ code: "P0001", message: "ALLERGY_MATCH" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "ALLERGY_MATCH" });
    expect(await items(v.visitId)).toEqual([]);
    const { data: headers } = await admin.from("prescriptions").select("id").eq("visit_id", v.visitId);
    expect(headers).toEqual([]);
    expect(commandResultRows(tenant.tenantId, req)).toEqual([]);
    expect(await auditRows(tenant.tenantId, "prescription.lines_change", v.visitId)).toEqual([]);
  });

  it("the service answers the fixed text with the machine reason", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    expect(await changeRxAs(ctxFor(doctor), v.visitId, { add: [amox()] })).toEqual({ success: false, error: ALLERGY_MATCH_MESSAGE, code: "CONFLICT", reason: "ALLERGY_MATCH" });
  });

  it("with a reason the line is stored with {reason, allergens, by, at}; the audit counts the override and never holds the reason", async () => {
    const v = await visitWith(["Qzxamoxil", "Qzxparacet"]);
    const reason = "Tolerated before, patient informed";
    const res = await call(v.visitId, { add: [amox(), para()], allergy_override_reason: reason });
    expect(res.error).toBeNull();
    const rows = await items(v.visitId);
    const matched = rows.find((r) => r.medicine_name === AL_BRANDS.amoxBrand.brand)!;
    expect(matched.allergy_override).toMatchObject({ reason, allergens: ["Qzxamoxil"], by: doctor.userId });
    expect(String(matched.allergy_override?.at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // The other allergy matched the other line too: both lines of this change carry their own allergens.
    expect(rows.find((r) => r.medicine_name === AL_BRANDS.paraBrand.brand)!.allergy_override).toMatchObject({ allergens: ["Qzxparacet"] });
    const audit = await auditRows(tenant.tenantId, "prescription.lines_change", (res.data as { prescription_id: string }).prescription_id);
    expect(audit[0].metadata).toEqual({ added: 2, updated: 0, removed: 0, allergy_overrides: 2 });
    const { data: everything } = await admin.from("audit_logs").select("metadata").eq("tenant_id", tenant.tenantId);
    expect(JSON.stringify(everything)).not.toContain(reason);
  });

  it("a reason on a change with no matching line stores no override", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    expect((await call(v.visitId, { add: [para()], allergy_override_reason: "Not needed here" })).error).toBeNull();
    expect((await items(v.visitId))[0].allergy_override).toBeNull();
  });

  it("three lines with one matching and no reason store nothing", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    const res = await call(v.visitId, { add: [para(), amox(), rxLine({ medicine_name: "Plain custom tablet" })] });
    expect(res.error).toMatchObject({ message: "ALLERGY_MATCH" });
    expect(await items(v.visitId)).toEqual([]);
  });

  it("a substance match needs no name: a combination brand holding the allergen is caught by its substance ids", async () => {
    const v = await visitWith(["Qzxclavulan"]);
    const combo = rxLine({ medicine_name: AL_BRANDS.comboBrand.brand, generic_name: "Combination", cdci_brand_id: AL_BRANDS.comboBrand.id });
    expect((await call(v.visitId, { add: [combo] })).error).toMatchObject({ message: "ALLERGY_MATCH" });
  });

  it("a custom line is checked by name; a free-text brand allergy flags a catalogue line by name too", async () => {
    const v = await visitWith(["Augmentin"]);
    expect((await call(v.visitId, { add: [rxLine({ medicine_name: "Augmentin 625" })] })).error).toMatchObject({ message: "ALLERGY_MATCH" });
    const w = await visitWith(["Qzxmoxy"]);
    expect((await call(w.visitId, { add: [amox()] })).error).toMatchObject({ message: "ALLERGY_MATCH" });
  });

  it("an update with a reason confirms a line that matches an allergy recorded after it was added; a plain update never refuses", async () => {
    const v = await visitWith(null);
    const first = await changeRxAs(ctxFor(doctor), v.visitId, { add: [amox()] });
    expect(first.success).toBe(true);
    const id = first.success ? first.addedItemIds[0] : "";
    await admin.from("patients").update({ allergies: ["Qzxamoxil"] }).eq("id", v.patientId).throwOnError();
    // a dose edit of the now-matching line is not refused, and stores no override
    expect((await call(v.visitId, { update: [{ id, duration: "7 days" }] })).error).toBeNull();
    expect((await items(v.visitId))[0].allergy_override).toBeNull();
    const confirm = await call(v.visitId, { update: [{ id, dosage: "1-0-1" }], allergy_override_reason: "Reviewed with the patient" });
    expect(confirm.error).toBeNull();
    expect((await items(v.visitId))[0].allergy_override).toMatchObject({ reason: "Reviewed with the patient", allergens: ["Qzxamoxil"], by: doctor.userId });
    const audit = await auditRows(tenant.tenantId, "prescription.lines_change", (confirm.data as { prescription_id: string }).prescription_id);
    // `auditRows` has no order: the confirming update is the one row that counts an override.
    expect(audit).toHaveLength(3);
    expect(audit.find((r) => (r.metadata as { allergy_overrides?: number }).allergy_overrides === 1)?.metadata).toEqual({ added: 0, updated: 1, removed: 0, allergy_overrides: 1 });
  });

  it("not recorded (NULL) and recorded none ([]) are not checked", async () => {
    for (const allergies of [null, []] as const) {
      const v = await visitWith(allergies as string[] | null);
      expect((await call(v.visitId, { add: [amox()] })).error).toBeNull();
    }
  });

  it("the reason is 5 to 300 characters: shorter, longer and a non-string are INPUT_INVALID and write nothing", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    for (const reason of ["no", "x".repeat(301), 12345 as unknown as string]) {
      const res = await call(v.visitId, { add: [amox()], allergy_override_reason: reason });
      expect(res.error, String(reason)).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    }
    expect(await items(v.visitId)).toEqual([]);
  });

  it("entitlement overridden off (the kill switch): the add needs no reason, and the key comes back when the override is removed", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    const off = await admin.from("tenant_entitlement_overrides").insert({ tenant_id: tenant.tenantId, key: "assist.allergy_check", enabled: false, reason: "Synthetic test: allergy check off" });
    expect(off.error).toBeNull();
    try {
      expect((await call(v.visitId, { add: [amox()] })).error).toBeNull();
      expect((await items(v.visitId))[0].allergy_override).toBeNull();
    } finally {
      await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", tenant.tenantId).eq("key", "assist.allergy_check");
    }
    const w = await visitWith(["Qzxamoxil"]);
    expect((await call(w.visitId, { add: [amox()] })).error).toMatchObject({ message: "ALLERGY_MATCH" });
  });

  it("the check is the database's: a client that hides the chip and the reason field is still refused", async () => {
    // (the same call as the first case, from a second member: nothing in the request says "I checked")
    const v = await visitWith(["Qzxamoxil"]);
    const owner = await call(v.visitId, { add: [amox()] });
    expect(owner.error).toMatchObject({ message: "ALLERGY_MATCH" });
  });
});

describe("rx_allergy_context: the screen's picture follows the commands' rule", () => {
  const ctx = (visitId: string) => doctor.client.rpc("rx_allergy_context", { p_tenant_id: tenant.tenantId, p_visit_id: visitId });

  it("not recorded, none and known; the coded allergies with their substance ids; each line's matches, how it was checked and its override", async () => {
    const v = await visitWith(null);
    expect((await ctx(v.visitId)).data).toMatchObject({ state: "not_recorded", entitled: true, allergies: [], items: [] });
    await admin.from("patients").update({ allergies: [] }).eq("id", v.patientId).throwOnError();
    expect((await ctx(v.visitId)).data).toMatchObject({ state: "none" });

    await admin.from("patients").update({ allergies: ["Qzxamoxil", "Augmentin"] }).eq("id", v.patientId).throwOnError();
    const added = await changeRxAs(ctxFor(doctor), v.visitId, { add: [para(), rxLine({ medicine_name: "Plain custom tablet" })] });
    expect(added.success).toBe(true);
    await admin.from("patients").update({ allergies: ["Qzxamoxil", "Augmentin", "Qzxparacet"] }).eq("id", v.patientId).throwOnError();
    const res = await ctx(v.visitId);
    expect(res.error).toBeNull();
    const body = res.data as { state: string; allergies: Array<{ text: string; substance_ids: string[] }>; items: Array<{ matches: string[]; checked_by: string; overridden: boolean }> };
    expect(body.state).toBe("known");
    expect(body.allergies).toEqual([
      { text: "Qzxamoxil", substance_ids: ["test-sub-09c-al-amox"] },
      { text: "Augmentin", substance_ids: [] },
      { text: "Qzxparacet", substance_ids: ["test-sub-09c-al-para"] },
    ]);
    expect(body.items).toEqual([
      { id: expect.any(String), matches: ["Qzxparacet"], checked_by: "substance", overridden: false, override_reason: null },
      { id: expect.any(String), matches: [], checked_by: "name", overridden: false, override_reason: null },
    ]);
  });

  it("another clinic's visit and a role without consultations:view read nothing", async () => {
    const v = await visitWith(["Qzxamoxil"]);
    const other = await seedTenantWithOwner("CI Allergy Context Other");
    expect((await other.client.rpc("rx_allergy_context", { p_tenant_id: other.tenantId, p_visit_id: v.visitId })).data).toBeNull();
    expect((await other.client.rpc("rx_allergy_context", { p_tenant_id: tenant.tenantId, p_visit_id: v.visitId })).data).toBeNull();
    const reception = await addMemberToTenant(tenant.tenantId, "receptionist");
    expect((await reception.client.rpc("rx_allergy_context", { p_tenant_id: tenant.tenantId, p_visit_id: v.visitId })).data).toBeNull();
  });
});
