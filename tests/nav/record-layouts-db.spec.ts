/**
 * V2-06 06-09c IND L-2: the consult and patient-record layouts (06-04b) decide "not found" above the segment's
 * `loading.tsx`. Before 06-09c a lookup error (a PostgREST hiccup) or any thrown error other than unauthenticated or
 * locked left `visible = false` and answered 404: a doctor reloading mid-consult was told the visit does not exist and
 * nothing was reported. Now:
 * - the record exists in the caller's clinic → rendered;
 * - another clinic's record, an unknown id, a malformed id → 404 (journey-09's clinic isolation is unchanged);
 * - a failing lookup (503, network error) → an error for the route error boundary (Retry, reported), never a 404.
 * Real session and rows on the local stack; the failure is injected on the `/rest/v1/visits` and `/rest/v1/patients`
 * requests only (`tests/helpers/blip-client.ts`; postgrest-js retries a network error or a 503 for about 14 s before
 * it gives up, so the slow modes are limited to one). Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

import ConsultationLayout from "@/app/(dashboard)/consultation/[id]/layout";
import PatientRecordLayout from "@/app/(dashboard)/patients/[id]/layout";
import { getAdminClient } from "../helpers/supabase-admin";
import { blipClient, type BlipClient } from "../helpers/blip-client";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

type Outcome = { kind: "rendered" } | { kind: "notFound" } | { kind: "error"; name: string };

async function run(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
    return { kind: "rendered" };
  } catch (err) {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { kind: "notFound" };
    return { kind: "error", name: err instanceof Error ? err.name : typeof err };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const layoutCall = (layout: (p: any) => Promise<unknown>, id: string) => () => layout({ children: null, params: Promise.resolve({ id }) });

async function seedRecord(owner: SeededTenant, tag: string): Promise<{ patientId: string; visitId: string }> {
  const admin = getAdminClient();
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .insert({ tenant_id: owner.tenantId, full_name: `Synthetic Layout Patient ${tag}`, phone: `+9190000${10000 + Math.floor(Math.random() * 89999)}`, sex: "other", created_by: owner.userId })
    .select("id")
    .single();
  if (pErr || !patient) throw new Error(`patient seed failed: ${pErr?.code}`);
  const { data: visit, error: vErr } = await admin
    .from("visits")
    .insert({
      tenant_id: owner.tenantId,
      patient_id: patient.id,
      doctor_id: owner.userId,
      origin_type: "walk_in",
      status: "in_consultation",
      estimated_duration_minutes: 15,
      created_by: owner.userId,
    })
    .select("id")
    .single();
  if (vErr || !visit) throw new Error(`visit seed failed: ${vErr?.code}`);
  return { patientId: patient.id, visitId: visit.id };
}

describe("record layouts: not found vs a failed lookup (local stack)", () => {
  let blip: BlipClient;
  let own: { patientId: string; visitId: string };
  let other: { patientId: string; visitId: string };

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 6);
    const owner = await seedTenantWithOwner(`Synthetic Layout Clinic ${tag}`);
    const stranger = await seedTenantWithOwner(`Synthetic Layout Other ${tag}`);
    own = await seedRecord(owner, tag);
    other = await seedRecord(stranger, `${tag}-b`);
    blip = await blipClient(owner.userEmail, ["/rest/v1/visits", "/rest/v1/patients"]);
    state.client = blip.client;
  });

  it("tracer: the caller's own visit and patient render", async () => {
    blip.setMode("ok");
    expect(await run(layoutCall(ConsultationLayout, own.visitId))).toEqual({ kind: "rendered" });
    expect(await run(layoutCall(PatientRecordLayout, own.patientId))).toEqual({ kind: "rendered" });
  });

  it("another clinic's record, an unknown id and a malformed id are 404 (clinic isolation unchanged)", async () => {
    blip.setMode("ok");
    for (const id of [other.visitId, randomUUID(), "not-a-visit", "1;drop"]) {
      expect(await run(layoutCall(ConsultationLayout, id)), id).toEqual({ kind: "notFound" });
    }
    for (const id of [other.patientId, randomUUID(), "not-a-patient"]) {
      expect(await run(layoutCall(PatientRecordLayout, id)), id).toEqual({ kind: "notFound" });
    }
  });

  it.each(["500", "network"] as const)("a failing lookup (%s) is an error for the boundary, never a 404", async (mode) => {
    blip.setMode(mode);
    const before = blip.blipped.length;
    const visit = await run(layoutCall(ConsultationLayout, own.visitId));
    const patient = await run(layoutCall(PatientRecordLayout, own.patientId));
    blip.setMode("ok");
    expect(blip.blipped.length, "both lookups hit the failing transport").toBeGreaterThanOrEqual(before + 2);
    expect(visit).toEqual({ kind: "error", name: "RecordLookupError" });
    expect(patient).toEqual({ kind: "error", name: "RecordLookupError" });
  }, 60_000);
});
