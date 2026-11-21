/**
 * V2-09a 09A-01 (R-2): the sealed predicate exists twice, in SQL (six guards) and in TypeScript (`recordState`), and the two must agree on
 * real rows. One visit per (status x signed) combination (the 7 statuses, each unsigned and signed: 14 rows, INSERTED, not updated; the
 * system path may insert an already-signed visit, R-4c) gets a note write as the service role and as the clinic owner's own client. The
 * database refuses the write if and only if `recordState` says `sealed`, and the refusal is the guard's fixed name. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { recordState } from "@/features/consultation/record-state";
import { insertReturningId } from "../helpers/db";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const STATUSES = ["booked", "confirmed", "waiting", "in_consultation", "completed", "cancelled", "no_show"] as const;

describe("recordState agrees with the database guards on real rows (R-2)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  const visits: { id: string; status: (typeof STATUSES)[number]; signed: boolean }[] = [];

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Record State Clinic");
    const patientId = await insertReturningId(admin, "patients", {
      tenant_id: owner.tenantId,
      full_name: "Synthetic Record State Patient",
      phone: "+910000000001",
      created_by: owner.userId,
    });
    for (const status of STATUSES) {
      for (const signed of [false, true]) {
        const id = await insertReturningId(admin, "visits", {
          tenant_id: owner.tenantId,
          patient_id: patientId,
          doctor_id: owner.userId,
          origin_type: "walk_in",
          status,
          created_by: owner.userId,
          ...(signed ? { signed_at: new Date().toISOString(), signed_by: owner.userId } : {}),
        });
        visits.push({ id, status, signed });
      }
    }
  }, 60_000);

  it("seeded one visit per status, unsigned and signed (14 rows)", () => {
    expect(visits).toHaveLength(14);
  });

  it("classifies every combination as the plan's R-2 says", () => {
    const seen = visits.map((v) => `${v.status}/${v.signed ? "signed" : "unsigned"}=${recordState({ status: v.status, signed_at: v.signed ? "2030-01-01T00:00:00Z" : null })}`);
    expect(seen).toEqual(
      STATUSES.flatMap((status) => [
        `${status}/unsigned=draft`,
        `${status}/signed=${status === "in_consultation" ? "amending" : "sealed"}`,
      ]),
    );
  });

  it("a note write is refused (42501 CLINICAL_NOTES_VISIT_SIGNED) if and only if recordState is sealed, as the service role and as the owner", async () => {
    const outcomes: string[] = [];
    for (const v of visits) {
      const state = recordState({ status: v.status, signed_at: v.signed ? "2030-01-01T00:00:00Z" : null });
      for (const [who, db] of [["service_role", admin], ["owner", owner.client]] as const) {
        // The owner's JWT may write only the vitals column since 000112 (the draft command writes the rest), and the seal guard reads the same state for it.
        const { data, error } = await db
          .from("clinical_notes")
          .update(who === "owner" ? { vitals: { pulse: 77 } } : { clinical_notes: `Probe by ${who}` })
          .eq("visit_id", v.id)
          .select("visit_id");
        const refused = error?.code === "42501" && (error.message ?? "").includes("CLINICAL_NOTES_VISIT_SIGNED");
        if (state === "sealed") {
          expect(refused, `${who} on ${v.status}/signed must be refused (${error?.code} ${error?.message})`).toBe(true);
          outcomes.push(`${who}:${v.status}:refused`);
        } else {
          expect(error, `${who} on ${v.status}/${v.signed ? "signed" : "unsigned"} must be admitted`).toBeNull();
          expect(data).toHaveLength(1);
          outcomes.push(`${who}:${v.status}:admitted`);
        }
      }
    }
    // 7 signed visits minus the amending one are sealed: 6 x 2 refusals; the other 8 visits are admitted for both writers.
    expect(outcomes.filter((o) => o.endsWith("refused"))).toHaveLength(12);
    expect(outcomes.filter((o) => o.endsWith("admitted"))).toHaveLength(16);
  });
});
