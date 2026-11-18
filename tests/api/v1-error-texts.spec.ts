/**
 * Every `/api/v1` route answers a database failure with a fixed text and the status `mapDbError` gives it (V2-05 05a
 * review INT L-4, IND L8; plan 05-11c). Before, the routes passed `error.message` (constraint names, key tuples such as
 * `Key (doctor_id, tenant_id)=(…)`, 22P02 input echoes) to the envelope and answered every database error as a 500,
 * and a failed lookup of the patient or visit was answered as 404 "not found".
 *
 * Part 1 sweeps every handler with a stubbed database whose every call fails with a given SQLSTATE and a message,
 * details and hint full of sentinel text: the response carries the mapped status and fixed text and none of the
 * sentinels. Part 2 provokes real errors on the local stack (a foreign doctor through the composite FK, malformed ids
 * and dates). Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ err: null as Record<string, string> | null, real: false }));

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  /** A PostgREST-shaped client whose every awaited call fails with `state.err`. */
  function failingDb(): unknown {
    const chain: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: null, error: state.err, count: null, status: 400 });
        }
        return () => chain;
      },
      apply() {
        return chain;
      },
    });
    return { from: () => chain, rpc: () => chain, storage: { from: () => chain } };
  }
  return {
    ...actual,
    authenticateApiKey: vi.fn(async (req: NextRequest, acquireDb: () => unknown) => {
      if (state.real) return actual.authenticateApiKey(req, acquireDb as never);
      return {
        success: true,
        // A fresh key id per call: the in-memory rate limit (120/min per key) never decides a case.
        session: { apiKeyId: randomUUID(), tenantId: "00000000-0000-4000-8000-0000000000a1", userId: "00000000-0000-4000-8000-000000000001", name: "stub", role: "admin" },
        db: failingDb(),
      };
    }),
  };
});

import { GET as getPatients, POST as postPatient } from "@/app/api/v1/patients/route";
import { GET as getPatient, PUT as putPatient, DELETE as deletePatient } from "@/app/api/v1/patients/[id]/route";
import { GET as getAppointments, POST as postAppointment } from "@/app/api/v1/appointments/route";
import { GET as getAppointment, PATCH as patchAppointment, DELETE as deleteAppointment } from "@/app/api/v1/appointments/[id]/route";
import { GET as getVisits, POST as postVisit } from "@/app/api/v1/visits/route";
import { GET as getVisit, PATCH as patchVisit } from "@/app/api/v1/visits/[id]/route";
import { GET as getReferrals, POST as postReferral } from "@/app/api/v1/referrals/route";
import { GET as getReferral, PATCH as patchReferral } from "@/app/api/v1/referrals/[id]/route";
import { GET as getLabOrders, POST as postLabOrder } from "@/app/api/v1/lab-orders/route";
import { GET as getLabOrder } from "@/app/api/v1/lab-orders/[id]/route";
import { GET as getPrescriptions, POST as postPrescription } from "@/app/api/v1/prescriptions/route";
import { GET as getPrescription } from "@/app/api/v1/prescriptions/[id]/route";
import { API_DB_MESSAGES } from "@/lib/api/envelope";
import { createApiKeySecret } from "@/lib/api/auth";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

enableApiV1ForFile();

const SENTINELS = ["SENTINEL_DB_TEXT", 'constraint "visits_sentinel_fkey"', "Key (doctor_id, tenant_id)=(", "SENTINEL_HINT", "SENTINEL_DETAIL"];

function sentinelError(code: string): Record<string, string> {
  return {
    code,
    message: 'SENTINEL_DB_TEXT violates constraint "visits_sentinel_fkey"',
    details: "Key (doctor_id, tenant_id)=(SENTINEL_DETAIL) is not present in table memberships.",
    hint: "SENTINEL_HINT",
  };
}

const STUB_TENANT = "00000000-0000-4000-8000-0000000000a1";
const ID = "00000000-0000-4000-8000-0000000000b1";
const ID2 = "00000000-0000-4000-8000-0000000000b2";
const P = { params: Promise.resolve({ id: ID }) };

function req(path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { authorization: "Bearer clq_live_000000000000000000000000", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const HANDLERS: Array<[string, () => Promise<Response>]> = [
  ["GET /patients", () => getPatients(req("/api/v1/patients"))],
  ["POST /patients", () => postPatient(req("/api/v1/patients", "POST", { full_name: "Synthetic Person", phone: "9000008814" }))],
  ["GET /patients/:id", () => getPatient(req(`/api/v1/patients/${ID}`), P)],
  ["PUT /patients/:id", () => putPatient(req(`/api/v1/patients/${ID}`, "PUT", { full_name: "Synthetic Person", phone: "9000008814" }), P)],
  ["DELETE /patients/:id", () => deletePatient(req(`/api/v1/patients/${ID}`, "DELETE"), P)],
  ["GET /appointments", () => getAppointments(req("/api/v1/appointments"))],
  [
    "POST /appointments",
    () => postAppointment(req("/api/v1/appointments", "POST", { patient_id: ID, doctor_id: ID2, scheduled_at: "2031-03-03T05:00:00.000Z" })),
  ],
  ["GET /appointments/:id", () => getAppointment(req(`/api/v1/appointments/${ID}`), P)],
  ["PATCH /appointments/:id", () => patchAppointment(req(`/api/v1/appointments/${ID}`, "PATCH", { scheduled_at: "2031-03-03T05:00:00.000Z" }), P)],
  ["DELETE /appointments/:id", () => deleteAppointment(req(`/api/v1/appointments/${ID}`, "DELETE"), P)],
  ["GET /visits", () => getVisits(req("/api/v1/visits"))],
  ["POST /visits", () => postVisit(req("/api/v1/visits", "POST", { patient_id: ID, doctor_id: ID2 }))],
  ["GET /visits/:id", () => getVisit(req(`/api/v1/visits/${ID}`), P)],
  ["PATCH /visits/:id", () => patchVisit(req(`/api/v1/visits/${ID}`, "PATCH", { status: "waiting" }), P)],
  ["GET /referrals", () => getReferrals(req("/api/v1/referrals"))],
  [
    "POST /referrals",
    () =>
      postReferral(
        req("/api/v1/referrals", "POST", { patient_id: ID, referring_doctor_id: ID2, referred_to_name: "Synthetic Clinic", reason_for_referral: "Synthetic" })
      ),
  ],
  ["GET /referrals/:id", () => getReferral(req(`/api/v1/referrals/${ID}`), P)],
  ["PATCH /referrals/:id", () => patchReferral(req(`/api/v1/referrals/${ID}`, "PATCH", { status: "cancelled" }), P)],
  ["GET /lab-orders", () => getLabOrders(req("/api/v1/lab-orders"))],
  [
    "POST /lab-orders",
    () => postLabOrder(req("/api/v1/lab-orders", "POST", { patient_id: ID, title: "Synthetic report", storage_path: `tenants/${STUB_TENANT}/patients/${ID}/labs/report.pdf` })),
  ],
  ["GET /lab-orders/:id", () => getLabOrder(req(`/api/v1/lab-orders/${ID}`), P)],
  ["GET /prescriptions", () => getPrescriptions(req("/api/v1/prescriptions"))],
  [
    "POST /prescriptions",
    () =>
      postPrescription(
        req("/api/v1/prescriptions", "POST", {
          patient_id: ID,
          doctor_id: ID2,
          visit_id: ID,
          items: [{ medicine_name: "Synthetic", dosage: "1-0-1", duration: "5 days" }],
        })
      ),
  ],
  ["GET /prescriptions/:id", () => getPrescription(req(`/api/v1/prescriptions/${ID}`), P)],
];

const EXPECTED: Array<[string, number, string, string]> = [
  ["23503", 422, "VALIDATION_ERROR", API_DB_MESSAGES.PRECONDITION_FAILED!],
  ["22P02", 422, "VALIDATION_ERROR", API_DB_MESSAGES.VALIDATION_FAILED!],
  ["23505", 409, "CONFLICT", API_DB_MESSAGES.CONFLICT!],
  ["40P01", 409, "CONFLICT", API_DB_MESSAGES.CONCURRENT_WRITE!],
  ["42501", 403, "FORBIDDEN", API_DB_MESSAGES.FORBIDDEN!],
  ["XX000", 500, "DATABASE_ERROR", "An internal database error occurred."],
];

function expectNoSentinel(text: string) {
  for (const s of SENTINELS) expect(text).not.toContain(s);
}

describe("every /api/v1 handler: database errors → mapped status and fixed text (05-11c, INT L-4)", () => {
  afterEach(() => {
    state.err = null;
  });

  describe.each(EXPECTED)("SQLSTATE %s", (sqlstate, status, code, message) => {
    it.each(HANDLERS)("%s", async (_name, call) => {
      state.err = sentinelError(sqlstate);
      const res = await call();
      const text = await res.text();
      expectNoSentinel(text);
      expect(res.status).toBe(status);
      const body = JSON.parse(text);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBe(message);
      expect(body.error).not.toHaveProperty("details");
    });
  });
});

describe("real database errors on the local stack (05-11c, INT L-4)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let other: SeededTenant;
  let otherDoctor: SeededTenant;
  let rawKey: string;
  let visitId: string;

  beforeAll(async () => {
    state.real = true;
    owner = await seedTenantWithOwner("Synthetic Error Text Clinic");
    other = await seedTenantWithOwner("Synthetic Error Text Other Clinic");
    otherDoctor = await addMemberToTenant(other.tenantId, "doctor");
    await addMemberToTenant(owner.tenantId, "doctor");
    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic error-text key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.code}`);
    rawKey = secret.rawToken;
    const { data: patient } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Error Text Patient", phone: "+919000008815", created_by: owner.userId })
      .select("id")
      .single();
    const { data: visit, error: vErr } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patient!.id,
        doctor_id: owner.userId,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: "2031-04-01T05:00:00.000Z",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`Failed to seed the visit: ${vErr?.code}`);
    visitId = visit.id;
    return () => {
      state.real = false;
    };
  });

  function realReq(path: string, method = "GET", body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("PATCH /appointments/:id to another clinic's doctor (composite FK, 23503) → 422 fixed text, the visit unchanged", async () => {
    const res = await patchAppointment(realReq(`/api/v1/appointments/${visitId}`, "PATCH", { doctor_id: otherDoctor.userId }), {
      params: Promise.resolve({ id: visitId }),
    });
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text).error).toEqual({ code: "VALIDATION_ERROR", message: API_DB_MESSAGES.PRECONDITION_FAILED });
    expect(text).not.toContain("Key (");
    expect(text).not.toContain("fkey");
    const { data } = await admin.from("visits").select("doctor_id").eq("id", visitId).single();
    expect(data!.doctor_id).toBe(owner.userId);
  });

  it("GET /visits?start_date=<not a date> (22007) → 422 fixed text without the echoed input", async () => {
    const res = await getVisits(realReq("/api/v1/visits?start_date=SENTINEL_NOT_A_DATE"));
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text).error).toEqual({ code: "VALIDATION_ERROR", message: API_DB_MESSAGES.VALIDATION_FAILED });
    expect(text).not.toContain("SENTINEL_NOT_A_DATE");
  });

  it.each([
    ["GET /patients/:id", (id: string) => getPatient(realReq(`/api/v1/patients/${id}`), { params: Promise.resolve({ id }) })],
    ["GET /visits/:id", (id: string) => getVisit(realReq(`/api/v1/visits/${id}`), { params: Promise.resolve({ id }) })],
    ["GET /appointments/:id", (id: string) => getAppointment(realReq(`/api/v1/appointments/${id}`), { params: Promise.resolve({ id }) })],
  ])("%s with a malformed id (22P02) → 422 fixed text without the echoed input", async (_name, call) => {
    const res = await call("SENTINEL-not-a-uuid");
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text).error).toEqual({ code: "VALIDATION_ERROR", message: API_DB_MESSAGES.VALIDATION_FAILED });
    expect(text).not.toContain("SENTINEL-not-a-uuid");
  });
});
