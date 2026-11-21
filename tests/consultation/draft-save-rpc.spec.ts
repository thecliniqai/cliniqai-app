/**
 * V2-09b 09B-01 (R-2, R-3, R-5): `public.save_consultation_draft`, the consult's draft save as one atomic command, and the version it checks.
 *
 * Called through the caller's own client (and through the service); rows are seeded and read back with the service-role client. Synthetic data only.
 * Each High control has a test that fails without it: the version check (stale save, parallel saves, the nurse's vitals write) and the single
 * transaction (a fault after the notes write undoes everything).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { recordVisitVitals } from "@/features/visits/service";
import { getConsultationDraft, saveConsultationDraft } from "@/features/consultation/service";
import { SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { draftVersionOf, saveDraftAs, followUpDay } from "../helpers/consult-draft";
import type { Json } from "@/types/database";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const admin = getAdminClient();

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Draft Clinic A");
  tenantB = await seedTenantWithOwner("CI Draft Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
}, 120_000);

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

type Args = { p_tenant_id: string; p_visit_id: string; p_expected_version: number; p_patch: Json; p_client_request_id: string };

function args(visitId: string, version: number, patch: Record<string, unknown>, over: Partial<Args> = {}): Args {
  return {
    p_tenant_id: tenantA.tenantId,
    p_visit_id: visitId,
    p_expected_version: version,
    p_patch: patch as Json,
    p_client_request_id: randomUUID(),
    ...over,
  };
}

const call = (client: SeededTenant["client"], a: Args) => client.rpc("save_consultation_draft", a);

async function notesRow(visitId: string) {
  const { data, error } = await admin
    .from("clinical_notes")
    .select("vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, draft_version")
    .eq("visit_id", visitId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function followUpsOf(visitId: string) {
  const { data, error } = await admin.from("follow_ups").select("follow_up_date, notes, doctor_id, status").eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** An in-consultation visit of clinic A whose doctor is the member doctor. */
const openVisit = (over: Parameters<typeof seedClinicalVisit>[1] = {}) =>
  seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "in_consultation", notes: null, prescriptions: 0, ...over });

describe("save_consultation_draft: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid)", definer: true });
  });
});

describe("save_consultation_draft: one transaction", () => {
  it("happy path: the keys written, version + 1, the audit row (no content), the claim and a data-only stored result commit together", async () => {
    const v = await openVisit();
    const a = args(v.visitId, 0, {
      clinical_notes: "Synthetic note, first line",
      chief_complaints: [{ symptom: "Fever", duration_val: 2, duration_unit: "days" }],
      advice: ["Rest"],
      investigations_advised: ["CBC"],
      specialty: "pediatrics",
      follow_up: { interval: "1_week", follow_up_date: followUpDay(20), notes: "Review" },
    });
    const { data, error } = await call(members.doctor.client, a);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: v.visitId, draft_version: 1, started: false, replayed: false });

    expect(await notesRow(v.visitId)).toMatchObject({
      clinical_notes: "Synthetic note, first line",
      chief_complaints: [{ symptom: "Fever", duration_val: 2, duration_unit: "days" }],
      advice: ["Rest"],
      investigations_advised: ["CBC"],
      draft_version: 1,
    });
    const { data: visit } = await admin.from("visits").select("specialty").eq("id", v.visitId).single();
    expect(visit?.specialty).toBe("pediatrics");
    expect(await followUpsOf(v.visitId)).toEqual([
      { follow_up_date: followUpDay(20), notes: "Review", doctor_id: members.doctor.userId, status: "scheduled" },
    ]);

    const rows = await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId);
    expect(rows).toEqual([
      expect.objectContaining({
        actor_id: members.doctor.userId,
        actor_role: "doctor",
        actor_type: "user",
        entity_type: "visit",
        metadata: {
          fields_changed: ["chief_complaints", "clinical_notes", "investigations_advised", "advice", "specialty", "follow_up"],
          draft_version: 1,
          conflict_overwrite: false,
        },
      }),
    ]);
    // No clinical text in the audit row or in the stored command result (F-5).
    expect(JSON.stringify(rows[0].metadata)).not.toContain("Synthetic note");
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual(["public.save_consultation_draft|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, a.p_client_request_id);
  });

  it("only the keys present are written: the others, the specialty and the follow-up stay", async () => {
    const v = await openVisit();
    await saveDraftAs(ctxFor(members.doctor), v.visitId, {
      clinical_notes: "Keep me",
      advice: ["Keep advice"],
      follow_up: { follow_up_date: followUpDay(40) },
    });
    const before = await notesRow(v.visitId);
    const res = await call(members.doctor.client, args(v.visitId, before.draft_version, { investigations_advised: ["ECG"] }));
    expect(res.error).toBeNull();
    expect(await notesRow(v.visitId)).toMatchObject({
      clinical_notes: "Keep me",
      advice: ["Keep advice"],
      investigations_advised: ["ECG"],
      draft_version: before.draft_version + 1,
    });
    expect((await followUpsOf(v.visitId)).map((f) => f.follow_up_date)).toEqual([followUpDay(40)]);
  });

  it("the version rises by one per save", async () => {
    const v = await openVisit();
    for (let expected = 0; expected < 3; expected++) {
      const { data } = await call(members.doctor.client, args(v.visitId, expected, { clinical_notes: `note ${expected}` }));
      expect(data).toMatchObject({ draft_version: expected + 1 });
    }
    expect(await draftVersionOf(v.visitId)).toBe(3);
  });

  it("rollback: a fault after the notes write (the follow-up insert) leaves the notes, the version, the follow-up, the audit row and the claim untouched; the same id then succeeds", async () => {
    const v = await openVisit({ notes: "Original" });
    const a = args(v.visitId, 1, { clinical_notes: "Must not persist", follow_up: { follow_up_date: followUpDay(50) } });
    await withFault({ table: "public.follow_ups", column: "visit_id", marker: v.visitId, event: "insert" }, async () => {
      const { data, error } = await call(members.doctor.client, a);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });
    // The seed wrote the note once (version 1); the failed save changed nothing.
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: "Original", draft_version: 1 });
    expect(await followUpsOf(v.visitId)).toEqual([]);
    expect(await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual([]);

    const retry = await call(members.doctor.client, a);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ draft_version: 2, replayed: false });
  });
});

describe("save_consultation_draft: the version (R-2, R-5)", () => {
  it("a save made against a stale version is DRAFT_CONFLICT (P0001 -> CONFLICT) and the row is unchanged", async () => {
    const v = await openVisit();
    expect((await call(members.doctor.client, args(v.visitId, 0, { clinical_notes: "First writer" }))).error).toBeNull();
    const stale = args(v.visitId, 0, { clinical_notes: "Stale writer" });
    const res = await call(members.doctor.client, stale);
    expect(res.data).toBeNull();
    expect(res.error).toMatchObject({ code: "P0001", message: "DRAFT_CONFLICT" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "DRAFT_CONFLICT" });
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: "First writer", draft_version: 1 });
    expect(await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId)).toHaveLength(1);
    expect(commandResultRows(tenantA.tenantId, stale.p_client_request_id)).toEqual([]);
  });

  it("a version ahead of the row's is a conflict too (never a silent write)", async () => {
    const v = await openVisit();
    const res = await call(members.doctor.client, args(v.visitId, 5, { clinical_notes: "Ahead" }));
    expect(res.error).toMatchObject({ message: "DRAFT_CONFLICT" });
    expect((await notesRow(v.visitId)).clinical_notes).toBeNull();
  });

  it("two parallel saves with the same expected version: one succeeds, the other is DRAFT_CONFLICT (they run one after the other under the row locks)", async () => {
    const v = await openVisit();
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { save_consultation_draft: barrier } }), args(v.visitId, 0, { clinical_notes: "Writer X" })),
      call(gateClient(members.owner.client, { rpc: { save_consultation_draft: barrier } }), args(v.visitId, 0, { clinical_notes: "Writer Y" })),
    ]);
    const failed = [x, y].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toMatchObject({ message: "DRAFT_CONFLICT" });
    const winner = [x, y].find((r) => !r.error)!;
    expect(winner.data).toMatchObject({ draft_version: 1 });
    const row = await notesRow(v.visitId);
    expect(row.draft_version).toBe(1);
    expect(["Writer X", "Writer Y"]).toContain(row.clinical_notes);
    expect(await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId)).toHaveLength(1);
  });

  it("a vitals write through recordVisitVitals raises the version, so the doctor's stale save conflicts at the database; the nurse stays the recorder after the doctor re-saves", async () => {
    const v = await openVisit();
    const version = await draftVersionOf(v.visitId);
    const vitals = await recordVisitVitals(ctxFor(members.nurse), v.visitId, { pulse: 88, systolic: 120, diastolic: 80 });
    expect(vitals.success).toBe(true);
    expect(await draftVersionOf(v.visitId)).toBe(version + 1);

    const stale = await call(members.doctor.client, args(v.visitId, version, { clinical_notes: "Doctor's note" }));
    expect(stale.error).toMatchObject({ message: "DRAFT_CONFLICT" });

    const server = await getConsultationDraft(ctxFor(members.doctor), v.visitId);
    expect(server.success && server.draft.draftVersion).toBe(version + 1);
    const fresh = await call(members.doctor.client, args(v.visitId, version + 1, { clinical_notes: "Doctor's note", vitals: { pulse: 88, systolic: 120, diastolic: 80 } }));
    expect(fresh.error).toBeNull();
    const row = await notesRow(v.visitId);
    expect(row.clinical_notes).toBe("Doctor's note");
    expect((row.vitals as { recorded_by?: string }).recorded_by).toBe(members.nurse.userId);
  });

  it("the nurse's vitals write and the doctor's note both survive when the doctor reads first (the rebase path's server copy)", async () => {
    const v = await openVisit();
    await recordVisitVitals(ctxFor(members.nurse), v.visitId, { pulse: 70 });
    const server = await getConsultationDraft(ctxFor(members.doctor), v.visitId);
    expect(server.success).toBe(true);
    if (!server.success) return;
    expect(server.draft.fields.vitals).toMatchObject({ pulse: 70, recorded_by: members.nurse.userId });
    expect(server.draft.status).toBe("in_consultation");
    const saved = await call(members.doctor.client, args(v.visitId, server.draft.draftVersion, { clinical_notes: "Note after vitals" }));
    expect(saved.error).toBeNull();
    const row = await notesRow(v.visitId);
    expect(row).toMatchObject({ clinical_notes: "Note after vitals" });
    expect((row.vitals as { pulse?: number }).pulse).toBe(70);
  });

  it("'Keep mine': the overwrite flag is audited", async () => {
    const v = await openVisit();
    const res = await call(members.doctor.client, args(v.visitId, 0, { clinical_notes: "Mine", conflict_overwrite: true }));
    expect(res.error).toBeNull();
    const rows = await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId);
    expect(rows[0].metadata).toMatchObject({ conflict_overwrite: true, fields_changed: ["clinical_notes"] });
  });
});

describe("save_consultation_draft: the follow-up and the start step", () => {
  it("one follow-up per visit: set, change (same row) and delete (null)", async () => {
    const v = await openVisit();
    await saveDraftAs(ctxFor(members.doctor), v.visitId, { follow_up: { follow_up_date: followUpDay(60), notes: "First" } });
    await saveDraftAs(ctxFor(members.doctor), v.visitId, { follow_up: { follow_up_date: followUpDay(67) } });
    expect(await followUpsOf(v.visitId)).toEqual([{ follow_up_date: followUpDay(67), notes: null, doctor_id: members.doctor.userId, status: "scheduled" }]);
    await saveDraftAs(ctxFor(members.doctor), v.visitId, { follow_up: null });
    expect(await followUpsOf(v.visitId)).toEqual([]);
  });

  it("a waiting visit is started once (audit visit.consultation_start); a replay and a later save start nothing", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "waiting", notes: null, prescriptions: 0 });
    const a = args(v.visitId, 0, { clinical_notes: "On a waiting visit" });
    const first = await call(members.doctor.client, a);
    expect(first.data).toMatchObject({ started: true, replayed: false });
    const { data: visit } = await admin.from("visits").select("status").eq("id", v.visitId).single();
    expect(visit?.status).toBe("in_consultation");
    expect(await auditRows(tenantA.tenantId, "visit.consultation_start", v.visitId)).toHaveLength(1);

    const replay = await call(members.doctor.client, a);
    expect(replay.data).toMatchObject({ started: true, replayed: true });
    const later = await call(members.doctor.client, args(v.visitId, 1, { clinical_notes: "Later" }));
    expect(later.data).toMatchObject({ started: false, draft_version: 2 });
    expect(await auditRows(tenantA.tenantId, "visit.consultation_start", v.visitId)).toHaveLength(1);
  });
});

describe("save_consultation_draft: idempotency", () => {
  it("the same id with the same input replays the first result, writes nothing and adds no audit row", async () => {
    const v = await openVisit();
    const a = args(v.visitId, 0, { clinical_notes: "Once" });
    const first = await call(members.doctor.client, a);
    const second = await call(members.doctor.client, a);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: "Once", draft_version: 1 });
    expect(await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId)).toHaveLength(1);
  });

  it("IDEMPOTENCY_MISMATCH with each hashed input varied: the visit, the expected version and the patch", async () => {
    const v = await openVisit();
    const other = await openVisit();
    const a = args(v.visitId, 0, { clinical_notes: "Original" });
    expect((await call(members.doctor.client, a)).error).toBeNull();
    const variants: Array<[string, Args]> = [
      ["visit", { ...a, p_visit_id: other.visitId }],
      ["expected version", { ...a, p_expected_version: 1 }],
      ["patch", { ...a, p_patch: { clinical_notes: "Different" } as Json }],
    ];
    for (const [name, variant] of variants) {
      const res = await call(members.doctor.client, variant);
      expect(mapDbError(res.error), name).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: "Original", draft_version: 1 });
    expect((await notesRow(other.visitId)).clinical_notes).toBeNull();
  });

  it("two concurrent submits of one id: the loser replays the winner's result", async () => {
    const v = await openVisit();
    const a = args(v.visitId, 0, { clinical_notes: "Racing" });
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { save_consultation_draft: barrier } }), a),
      call(gateClient(members.doctor.client, { rpc: { save_consultation_draft: barrier } }), a),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect((await notesRow(v.visitId)).draft_version).toBe(1);
  });
});

describe("save_consultation_draft: who may call it, and on what", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants consultations:edit", async (role) => {
    const v = await openVisit();
    const { error } = await call(members[role].client, args(v.visitId, 0, { advice: ["Fluids"] }));
    if (hasPerm(role, "consultations:edit")) {
      expect(error).toBeNull();
      expect((await notesRow(v.visitId)).advice).toEqual(["Fluids"]);
    } else {
      expect(error?.code).toBe("42501");
      expect(await notesRow(v.visitId)).toMatchObject({ advice: [], draft_version: 0 });
      expect(await auditRows(tenantA.tenantId, "consultation.draft_save", v.visitId)).toEqual([]);
    }
  });

  it("another clinic's visit, or another clinic named by a member of this one, is VISIT_NOT_FOUND and nothing changes", async () => {
    const v = await openVisit();
    const foreign = await call(tenantB.client, args(v.visitId, 0, { clinical_notes: "Cross-clinic" }, { p_tenant_id: tenantB.tenantId }));
    expect(foreign.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const forged = await call(tenantB.client, args(v.visitId, 0, { clinical_notes: "Forged tenant" }));
    expect(forged.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: null, draft_version: 0 });
  });

  it("a sealed, an unsigned completed and a cancelled visit are DRAFT_LOCKED with every row unchanged; an amending visit takes the draft", async () => {
    const sealed = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, notes: "Signed note", prescriptions: 0 });
    await signVisitAs(members.doctor, sealed.visitId);
    const completed = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "waiting", notes: "Desk note", prescriptions: 0 });
    await admin.from("visits").update({ status: "completed" }).eq("id", completed.visitId).throwOnError();
    const cancelled = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "cancelled", notes: "Cancelled note", prescriptions: 0 });

    for (const [name, visit, note] of [
      ["sealed", sealed, "Signed note"],
      ["completed", completed, "Desk note"],
      ["cancelled", cancelled, "Cancelled note"],
    ] as const) {
      const before = await notesRow(visit.visitId);
      const a = args(visit.visitId, before.draft_version, { clinical_notes: "Rewrite", follow_up: { follow_up_date: followUpDay(70) } });
      const res = await call(members.doctor.client, a);
      expect(res.error, name).toMatchObject({ code: "P0001", message: "DRAFT_LOCKED" });
      expect(mapDbError(res.error), name).toMatchObject({ code: "CONFLICT", reason: "DRAFT_LOCKED" });
      expect(await notesRow(visit.visitId), name).toMatchObject({ clinical_notes: note, draft_version: before.draft_version });
      expect(await followUpsOf(visit.visitId), name).toEqual([]);
      expect(commandResultRows(tenantA.tenantId, a.p_client_request_id), name).toEqual([]);
    }

    // The service answers the fixed signed text.
    const viaService = await saveDraftAs(ctxFor(members.doctor), sealed.visitId, { clinical_notes: "Rewrite" });
    expect(viaService).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE, code: "CONFLICT", reason: "DRAFT_LOCKED" });

    await reopenVisitAs(members.doctor, sealed.visitId);
    const open = await saveDraftAs(ctxFor(members.doctor), sealed.visitId, { clinical_notes: "Amended note" });
    expect(open).toMatchObject({ success: true });
    expect((await notesRow(sealed.visitId)).clinical_notes).toBe("Amended note");
  }, 120_000);
});

describe("save_consultation_draft: vitals and input", () => {
  it("changed measurements record the actor (a forged recorder is ignored); unchanged ones keep the stored recorder", async () => {
    const v = await openVisit();
    await call(members.doctor.client, args(v.visitId, 0, { vitals: { pulse: 80, recorded_by: members.nurse.userId } }));
    expect(((await notesRow(v.visitId)).vitals as { recorded_by?: string }).recorded_by).toBe(members.doctor.userId);

    await recordVisitVitals(ctxFor(members.nurse), v.visitId, { pulse: 95 });
    const version = await draftVersionOf(v.visitId);
    await call(members.doctor.client, args(v.visitId, version, { vitals: { pulse: 95, temperature: null } }));
    expect(((await notesRow(v.visitId)).vitals as { recorded_by?: string }).recorded_by).toBe(members.nurse.userId);
  });

  it.each([
    ["an empty patch", {}],
    ["an unknown key", { status: "completed" }],
    ["a wrong type", { clinical_notes: 5 }],
    ["a bad specialty", { specialty: "cardiology" }],
    ["a bad follow-up date", { follow_up: { follow_up_date: "2031-02-31" } }],
    ["an unknown vitals key", { vitals: { hacked: 1 } }],
    ["an unknown provenance key", { provenance: { ai_assisted: true, extra: 1 } }],
    ["a non-string list item", { advice: [1] }],
    ["a patch over 256 kB", { clinical_notes: "x".repeat(270_000) }],
  ])("%s is INPUT_INVALID (VALIDATION_FAILED) and writes nothing", async (_name, patch) => {
    const v = await openVisit();
    const res = await call(members.doctor.client, args(v.visitId, 0, patch as Record<string, unknown>));
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await notesRow(v.visitId)).toMatchObject({ clinical_notes: null, draft_version: 0 });
  });

  it("a missing request id, a missing visit and a negative version are refused", async () => {
    const v = await openVisit();
    expect((await call(members.doctor.client, args(v.visitId, 0, { advice: ["x"] }, { p_client_request_id: null as unknown as string }))).error).toMatchObject({ message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect((await call(members.doctor.client, args(v.visitId, 0, { advice: ["x"] }, { p_visit_id: null as unknown as string }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await call(members.doctor.client, args(v.visitId, -1, { advice: ["x"] }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await notesRow(v.visitId)).draft_version).toBe(0);
  });
});

describe("saveConsultationDraft (the service)", () => {
  it("validates the patch with the field rules, maps DRAFT_CONFLICT to a CONFLICT with no data and the fixed text, and a repeat of the same id replays", async () => {
    const v = await openVisit();
    const ctx = ctxFor(members.doctor);
    const invalid = await saveConsultationDraft(ctx, {
      visit_id: v.visitId,
      expected_version: 0,
      patch: { vitals: { systolic: 40 } },
      client_request_id: randomUUID(),
    });
    expect(invalid).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
    expect(await draftVersionOf(v.visitId)).toBe(0);

    const requestId = randomUUID();
    const ok = await saveConsultationDraft(ctx, { visit_id: v.visitId, expected_version: 0, patch: { clinical_notes: "Via service" }, client_request_id: requestId });
    expect(ok).toEqual({ success: true, visitId: v.visitId, draftVersion: 1, started: false, replayed: false });
    const again = await saveConsultationDraft(ctx, { visit_id: v.visitId, expected_version: 0, patch: { clinical_notes: "Via service" }, client_request_id: requestId });
    expect(again).toMatchObject({ success: true, draftVersion: 1, replayed: true });

    const stale = await saveConsultationDraft(ctx, { visit_id: v.visitId, expected_version: 0, patch: { clinical_notes: "Stale" }, client_request_id: randomUUID() });
    expect(stale).toEqual({ success: false, error: "This consultation was changed in another tab or device.", code: "CONFLICT", reason: "DRAFT_CONFLICT" });

    const forgedProvenance = await saveConsultationDraft(ctx, {
      visit_id: v.visitId,
      expected_version: 1,
      patch: { provenance: { ai_assisted: true, secret: "dropped" } },
      client_request_id: randomUUID(),
    });
    expect(forgedProvenance).toMatchObject({ success: true });
    const { data } = await admin.from("visits").select("metadata").eq("id", v.visitId).single();
    expect(data?.metadata).toMatchObject({ ai_assisted: true });
    expect(data?.metadata).not.toHaveProperty("secret");
  });

  it("getConsultationDraft returns the draft fields, the follow-up, the version and the record state; a role without consultations:view and another clinic get nothing", async () => {
    const v = await openVisit();
    await saveDraftAs(ctxFor(members.doctor), v.visitId, {
      clinical_notes: "Readable",
      advice: ["Rest"],
      specialty: "dental",
      follow_up: { follow_up_date: followUpDay(80), notes: "Soon" },
    });
    const read = await getConsultationDraft(ctxFor(members.doctor), v.visitId);
    expect(read).toMatchObject({
      success: true,
      draft: {
        draftVersion: 1,
        status: "in_consultation",
        signedAt: null,
        fields: { clinical_notes: "Readable", advice: ["Rest"], specialty: "dental", follow_up: { follow_up_date: followUpDay(80), notes: "Soon" } },
      },
    });
    expect((await getConsultationDraft(ctxFor(members.receptionist), v.visitId)).success).toBe(false);
    expect((await getConsultationDraft(ctxFor(tenantB), v.visitId)).success).toBe(false);
  });
});
