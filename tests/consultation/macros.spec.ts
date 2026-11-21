/**
 * V2-09b 09B-04b (R-14, T-09B-07): the doctor's text macros, against the real database with each caller's own client (RLS applies). Proves that a doctor
 * keeps their own macros and nobody else's (another doctor of the clinic, another clinic), that a nurse and a receptionist are refused by the service and
 * by the database, that a forged `doctor_id` or `tenant_id` is not honoured, that the shape rules and the limit of 200 hold, and that the service never
 * returns or logs another doctor's text. The table's policies and triggers are covered by pgTAP `doctor_text_macros.test.sql`. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createDoctorMacro, deleteDoctorMacro, listDoctorMacros, updateDoctorMacro } from "@/features/consultation/macros-service";
import { macroInputSchema, macroMap, normaliseShortcut } from "@/features/consultation/macros";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";

const admin = getAdminClient();
let tenantA: SeededTenant;
let tenantB: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
let doctorMacroId = "";

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Macro Clinic A");
  tenantB = await seedTenantWithOwner("CI Macro Clinic B");
  doctor = await addMemberToTenant(tenantA.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(tenantA.tenantId, "doctor");
  nurse = await addMemberToTenant(tenantA.tenantId, "nurse");
  receptionist = await addMemberToTenant(tenantA.tenantId, "receptionist");
}, 180_000);

describe("the macro shape (client and server)", () => {
  it("normalises the shortcut: lower case, a leading dot added", () => {
    expect(normaliseShortcut("UR")).toBe(".ur");
    expect(normaliseShortcut(" .Fv ")).toBe(".fv");
  });
  it("accepts a dot and 1 to 24 of a-z 0-9 _ -, and a text of 1 to 2,000 characters", () => {
    expect(macroInputSchema.safeParse({ shortcut: ".a", expansion: "x" }).success).toBe(true);
    expect(macroInputSchema.safeParse({ shortcut: `.${"a".repeat(24)}`, expansion: "x".repeat(2000) }).success).toBe(true);
    for (const bad of [".", ".a b", ".é", `.${"a".repeat(25)}`, ".a.b", ""]) {
      expect(macroInputSchema.safeParse({ shortcut: bad, expansion: "x" }).success, bad).toBe(false);
    }
    expect(macroInputSchema.safeParse({ shortcut: ".a", expansion: "   " }).success).toBe(false);
    expect(macroInputSchema.safeParse({ shortcut: ".a", expansion: "x".repeat(2001) }).success).toBe(false);
  });
  it("macroMap keys the text by its shortcut", () => {
    expect(macroMap([{ id: "1", shortcut: ".ur", expansion: "adv rest" }])).toEqual({ ".ur": "adv rest" });
  });
});

describe("a doctor's macros", () => {
  it("creates, lists, edits and deletes their own macro", async () => {
    const created = await createDoctorMacro(ctxFor(doctor), { shortcut: "UR", expansion: "adv rest, plenty of fluids" });
    expect(created.success).toBe(true);
    if (!created.success) return;
    doctorMacroId = created.value.id;
    expect(created.value).toMatchObject({ shortcut: ".ur", expansion: "adv rest, plenty of fluids" });

    const listed = await listDoctorMacros(ctxFor(doctor));
    expect(listed).toEqual({ success: true, value: [expect.objectContaining({ id: doctorMacroId, shortcut: ".ur" })] });

    const edited = await updateDoctorMacro(ctxFor(doctor), doctorMacroId, { shortcut: ".ur", expansion: "adv rest" });
    expect(edited).toMatchObject({ success: true, value: { expansion: "adv rest" } });

    const row = await admin.from("doctor_text_macros").select("doctor_id, tenant_id, expansion").eq("id", doctorMacroId).single();
    expect(row.data).toEqual({ doctor_id: doctor.userId, tenant_id: tenantA.tenantId, expansion: "adv rest" });

    const removed = await deleteDoctorMacro(ctxFor(doctor), doctorMacroId);
    expect(removed.success).toBe(true);
    expect((await admin.from("doctor_text_macros").select("id").eq("id", doctorMacroId)).data).toEqual([]);
  });

  it("refuses a second macro with the same shortcut, with a fixed message", async () => {
    expect((await createDoctorMacro(ctxFor(doctor), { shortcut: ".dup", expansion: "one" })).success).toBe(true);
    const again = await createDoctorMacro(ctxFor(doctor), { shortcut: ".dup", expansion: "two" });
    expect(again).toEqual({ success: false, error: "You already have a macro with that shortcut." });
  });

  it("refuses a shortcut or a text that breaks the rules, before the database is asked", async () => {
    expect((await createDoctorMacro(ctxFor(doctor), { shortcut: ".a b", expansion: "x" })).success).toBe(false);
    expect((await createDoctorMacro(ctxFor(doctor), { shortcut: ".ok", expansion: "x".repeat(2001) })).success).toBe(false);
    expect((await createDoctorMacro(ctxFor(doctor), { shortcut: ".ok", expansion: "  " })).success).toBe(false);
  });
});

describe("whose macros are whose", () => {
  let doctorsId = "";
  beforeAll(async () => {
    const created = await createDoctorMacro(ctxFor(doctor), { shortcut: ".mine", expansion: "Synthetic text of the first doctor" });
    if (!created.success) throw new Error(created.error);
    doctorsId = created.value.id;
    expect((await createDoctorMacro(ctxFor(otherDoctor), { shortcut: ".mine", expansion: "Synthetic text of the second doctor" })).success).toBe(true);
    expect((await createDoctorMacro(ctxFor(tenantB), { shortcut: ".mine", expansion: "Synthetic text of clinic B" })).success).toBe(true);
  });

  it("another doctor of the clinic sees only their own, even with the first doctor's id in the filter", async () => {
    const listed = await listDoctorMacros(ctxFor(otherDoctor));
    expect(listed.success && listed.value.map((m) => m.expansion)).toEqual(["Synthetic text of the second doctor"]);
    const direct = await otherDoctor.client.from("doctor_text_macros").select("id, expansion").eq("doctor_id", doctor.userId);
    expect(direct.data).toEqual([]);
  });

  it("another doctor cannot edit or delete a macro that is not theirs (the service says not found, the row is unchanged)", async () => {
    expect(await updateDoctorMacro(ctxFor(otherDoctor), doctorsId, { shortcut: ".mine", expansion: "Hijacked" })).toEqual({ success: false, error: "Macro not found." });
    expect(await deleteDoctorMacro(ctxFor(otherDoctor), doctorsId)).toEqual({ success: false, error: "Macro not found." });
    const row = await admin.from("doctor_text_macros").select("expansion").eq("id", doctorsId).single();
    expect(row.data?.expansion).toBe("Synthetic text of the first doctor");
  });

  it("the owner of the clinic sees none of a doctor's macros", async () => {
    const listed = await listDoctorMacros(ctxFor(tenantA));
    expect(listed).toEqual({ success: true, value: [] });
    expect((await tenantA.client.from("doctor_text_macros").select("id")).data).toEqual([]);
  });

  it("another clinic sees none of this clinic's macros and its own is separate", async () => {
    const listed = await listDoctorMacros(ctxFor(tenantB));
    expect(listed.success && listed.value.map((m) => m.expansion)).toEqual(["Synthetic text of clinic B"]);
    expect(JSON.stringify(listed)).not.toContain("first doctor");
  });

  it("a nurse and a receptionist are refused by the service and, going around it, by the database", async () => {
    for (const member of [nurse, receptionist]) {
      expect((await listDoctorMacros(ctxFor(member))).success).toBe(false);
      expect((await createDoctorMacro(ctxFor(member), { shortcut: ".nn", expansion: "x" })).success).toBe(false);
      const direct = await member.client
        .from("doctor_text_macros")
        .insert({ tenant_id: tenantA.tenantId, doctor_id: member.userId, shortcut: ".nn", expansion: "x" });
      expect(direct.error?.code).toBe("42501");
      expect((await member.client.from("doctor_text_macros").select("id")).data).toEqual([]);
    }
  });

  it("a forged doctor_id on a direct insert is replaced by the caller, and a forged tenant is refused", async () => {
    const forged = await doctor.client
      .from("doctor_text_macros")
      .insert({ tenant_id: tenantA.tenantId, doctor_id: otherDoctor.userId, shortcut: ".forged", expansion: "Synthetic forged text" })
      .select("doctor_id")
      .single();
    expect(forged.data?.doctor_id).toBe(doctor.userId);
    const otherTenant = await doctor.client
      .from("doctor_text_macros")
      .insert({ tenant_id: tenantB.tenantId, doctor_id: doctor.userId, shortcut: ".other", expansion: "x" });
    expect(otherTenant.error?.code).toBe("42501");
    const listed = await listDoctorMacros(ctxFor(otherDoctor));
    expect(listed.success && listed.value.map((m) => m.shortcut)).toEqual([".mine"]);
  });

  it("a macro cannot be handed to another doctor or moved to another clinic by an update", async () => {
    const handed = await doctor.client.from("doctor_text_macros").update({ doctor_id: otherDoctor.userId }).eq("id", doctorsId);
    expect(handed.error?.code).toBe("23514");
    const moved = await doctor.client.from("doctor_text_macros").update({ tenant_id: tenantB.tenantId }).eq("id", doctorsId);
    expect(moved.error?.code).toBe("23514");
  });
});

describe("the limit of 200 per doctor", () => {
  it("the 201st macro is refused with a fixed message; another doctor is not affected", async () => {
    const filler = await addMemberToTenant(tenantA.tenantId, "doctor");
    const rows = Array.from({ length: 200 }, (_, i) => ({ tenant_id: tenantA.tenantId, doctor_id: filler.userId, shortcut: `.f${i}`, expansion: `Synthetic filler ${i}` }));
    const inserted = await admin.from("doctor_text_macros").insert(rows);
    expect(inserted.error).toBeNull();
    const over = await createDoctorMacro(ctxFor(filler), { shortcut: ".f200", expansion: "one too many" });
    expect(over).toEqual({ success: false, error: "You can keep at most 200 macros." });
    expect((await createDoctorMacro(ctxFor(otherDoctor), { shortcut: ".still", expansion: "fine" })).success).toBe(true);
  }, 60_000);
});
