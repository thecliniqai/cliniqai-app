/**
 * Shared seeds and read-backs for the V2-07 07-01 clinical command specs (sign_consultation, reopen_visit_for_amendment,
 * finalize_visit_amendment, check_in_visit). Synthetic data only; rows are seeded and read with the service-role client,
 * commands are called with the caller's own client.
 */
import { createHash, randomUUID } from "node:crypto";
import { insertReturningId, type TestDb } from "./db";
import { getAdminClient } from "./supabase-admin";
import type { SeededTenant } from "./tenants";
import { seedVisit, type SeededVisit } from "./billing-commands";
import type { Database } from "@/types/database";

type Fns = Database["public"]["Functions"];
export type SignArgs = Fns["sign_consultation"]["Args"];
export type ReopenArgs = Fns["reopen_visit_for_amendment"]["Args"];
export type FinalizeArgs = Fns["finalize_visit_amendment"]["Args"];
export type CheckInArgs = Fns["check_in_visit"]["Args"];
export type StartConsultationArgs = Fns["start_consultation"]["Args"];
export type CompleteVisitArgs = Fns["complete_visit"]["Args"];

export interface ClinicalVisitOptions {
  /** The visit's doctor (default: the clinic owner). */
  doctorId?: string;
  /** The visit's status (default `waiting`: the sign-off needs `waiting` or `in_consultation`, 07-04a F-6). */
  status?: "booked" | "confirmed" | "waiting" | "in_consultation" | "cancelled" | "no_show";
  /** A clinical note (default "Synthetic clinical note."); null leaves the note empty. */
  notes?: string | null;
  /** Add one diagnosis (default false). */
  diagnosis?: boolean;
  /** Active prescriptions to seed (versions 1..n, unsigned; default 1). */
  prescriptions?: number;
  /** Seed a scheduled visit at this time instead of a walk-in (an appointment, as the /api/v1/appointments routes see it). */
  scheduledAt?: string;
  /** Marker written to `prescriptions.amendment_reason` / `visits.reason_for_visit` so a scoped fault can target the rows. */
  marker?: string;
}

export interface ClinicalVisit extends SeededVisit {
  prescriptionIds: string[];
}

/** A fresh synthetic visit with the clinical content a sign-off needs. */
export async function seedClinicalVisit(t: Pick<SeededTenant, "tenantId" | "userId">, opts: ClinicalVisitOptions = {}): Promise<ClinicalVisit> {
  const admin = getAdminClient();
  const doctorId = opts.doctorId ?? t.userId;
  // A sign-off needs a visit that is in the queue or in consultation (07-04a F-6); the seed default is `waiting`. The status is
  // inserted, not updated: the visit state machine (000100) refuses booked -> in_consultation.
  const base = await seedVisit(t, doctorId, { status: opts.status ?? "waiting", ...(opts.scheduledAt ? { scheduledAt: opts.scheduledAt } : {}) });
  const notes = opts.notes === undefined ? "Synthetic clinical note." : opts.notes;
  if (notes !== null) {
    const { error } = await admin.from("clinical_notes").update({ clinical_notes: notes }).eq("visit_id", base.visitId);
    if (error) throw new Error(`seed clinical note failed: ${error.message}`);
  }
  if (opts.diagnosis) {
    await insertReturningId(admin, "consultation_diagnoses", {
      tenant_id: t.tenantId,
      visit_id: base.visitId,
      patient_id: base.patientId,
      diagnosis_name: "Synthetic diagnosis",
    });
  }
  const prescriptionIds: string[] = [];
  for (let version = 1; version <= (opts.prescriptions ?? 1); version++) {
    prescriptionIds.push(
      await insertReturningId(admin, "prescriptions", {
        tenant_id: t.tenantId,
        visit_id: base.visitId,
        patient_id: base.patientId,
        doctor_id: doctorId,
        version,
        status: "active",
        ...(opts.marker ? { amendment_reason: opts.marker } : {}),
      })
    );
  }
  if (opts.marker) {
    const { error } = await admin.from("visits").update({ reason_for_visit: opts.marker }).eq("id", base.visitId);
    if (error) throw new Error(`seed marker failed: ${error.message}`);
  }
  return { ...base, prescriptionIds };
}

export function signArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<SignArgs> = {}): SignArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export function reopenArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<ReopenArgs> = {}): ReopenArgs {
  return {
    p_tenant_id: t.tenantId,
    p_visit_id: visitId,
    p_reason: "Synthetic amendment reason for the audit trail",
    p_client_request_id: randomUUID(),
    ...over,
  };
}

export function finalizeArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<FinalizeArgs> = {}): FinalizeArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export function checkInArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<CheckInArgs> = {}): CheckInArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_priority: "normal", p_client_request_id: randomUUID(), ...over };
}

export function startConsultationArgs(
  t: Pick<SeededTenant, "tenantId">,
  visitId: string,
  over: Partial<StartConsultationArgs> = {}
): StartConsultationArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export function completeVisitArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<CompleteVisitArgs> = {}): CompleteVisitArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export const callSign = (db: TestDb, args: SignArgs) => db.rpc("sign_consultation", args);
export const callReopen = (db: TestDb, args: ReopenArgs) => db.rpc("reopen_visit_for_amendment", args);
export const callFinalize = (db: TestDb, args: FinalizeArgs) => db.rpc("finalize_visit_amendment", args);
export const callCheckIn = (db: TestDb, args: CheckInArgs) => db.rpc("check_in_visit", args);
export const callStartConsultation = (db: TestDb, args: StartConsultationArgs) => db.rpc("start_consultation", args);
export const callCompleteVisit = (db: TestDb, args: CompleteVisitArgs) => db.rpc("complete_visit", args);

/**
 * R-15 (V2-09a): a signed record is seeded the way production makes one. The visit, its notes, diagnoses, header and items are
 * seeded unsigned with the service role (`seedClinicalVisit`), then the actor's own client calls `sign_consultation`. Since 000107
 * a service-role writer can no longer sign, un-sign or add child rows to a signed visit, so a fixture never does it by UPDATE.
 */
export async function signVisitAs(actor: Pick<SeededTenant, "tenantId" | "client">, visitId: string): Promise<void> {
  const { error } = await callSign(actor.client, signArgs(actor, visitId));
  if (error) throw new Error(`sign_consultation failed: ${error.message}`);
}

/**
 * V2-09a 09A-06a (ruling R-A, review A-3): archives the signed version of the visit's latest prescription as `signer`, the way the app's sign-off does:
 * the signer's own client uploads synthetic PDF bytes to the canonical key `<tenant>/<visit>/rx_v<n>.pdf` (`upsert: false`) and records the pair. Only
 * the visit's signer can (the storage policy and the seal guard refuse anyone else). A no-op when the latest header has no signature or is archived.
 * Returns the recorded hash, or null when there was nothing to archive.
 */
export async function archiveRxAs(signer: Pick<SeededTenant, "client">, visitId: string): Promise<string | null> {
  const { data: rx, error: readErr } = await getAdminClient()
    .from("prescriptions")
    .select("id, tenant_id, version, signed_at, pdf_sha256")
    .eq("visit_id", visitId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) throw new Error(`prescription read failed: ${readErr.message}`);
  if (!rx || !rx.signed_at || rx.pdf_sha256) return null;
  const path = `${rx.tenant_id}/${visitId}/rx_v${rx.version}.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\n% synthetic archive of ${path}\n%%EOF\n`);
  const { error: upErr } = await signer.client.storage.from("prescriptions").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`rx upload failed: ${upErr.message}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: written, error } = await signer.client
    .from("prescriptions")
    .update({ pdf_storage_path: path, pdf_sha256: sha256 })
    .eq("id", rx.id)
    .select("id");
  if (error || (written ?? []).length !== 1) throw new Error(`rx pair failed: ${error?.message ?? "no row"}`);
  return sha256;
}

/**
 * Reopens a signed visit for amendment as `actor` (the visit goes back to `in_consultation`, still signed). Like the app's reopen service, the signed
 * version's PDF is archived first (09A-06a, review A-3: the command refuses RX_ARCHIVE_PENDING otherwise); that works when `actor` is the signer.
 */
export async function reopenVisitAs(actor: Pick<SeededTenant, "tenantId" | "client">, visitId: string): Promise<void> {
  await archiveRxAs(actor, visitId);
  const { error } = await callReopen(actor.client, reopenArgs(actor, visitId));
  if (error) throw new Error(`reopen_visit_for_amendment failed: ${error.message}`);
}

/** The visit as the commands change it. */
export async function visitRow(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("visits")
    .select("status, signed_at, signed_by, current_revision, updated_at")
    .eq("id", visitId)
    .single();
  if (error || !data) throw new Error(`visit read failed: ${error?.message}`);
  return data;
}

/** The status and the overbooked flag of a visit (V2-08 08-06a, A-3), read with the service-role client. */
export async function visitFlags(visitId: string) {
  const { data, error } = await getAdminClient().from("visits").select("status, is_overbooked").eq("id", visitId).single();
  if (error || !data) throw new Error(`visit read failed: ${error?.message}`);
  return data;
}

export async function prescriptionsOfVisit(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("prescriptions")
    .select("id, version, status, signed_at, amendment_reason")
    .eq("visit_id", visitId)
    .order("version", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function revisionsOfVisit(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("visit_revisions")
    .select("revision_number, amended_by, amendment_reason, snapshot")
    .eq("visit_id", visitId)
    .order("revision_number", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function tokensOfVisit(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("queue_tokens")
    .select("id, token_number, priority, date, location_id, tenant_id, called_at, completed_at")
    .eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Outbox rows of one event type in one clinic whose key names `subject` (a visit or prescription id). */
export async function outboxRows(tenantId: string, eventType: string, subject: string) {
  const { data, error } = await getAdminClient()
    .from("webhook_delivery_queue")
    .select("id, subscription_id, event_key, payload")
    .eq("tenant_id", tenantId)
    .eq("event_type", eventType)
    .like("event_key", `%${subject}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** An active subscription of `t`'s clinic to the sign-off events. */
export async function subscribeSignEvents(t: Pick<SeededTenant, "tenantId" | "userId">): Promise<string> {
  return insertReturningId(getAdminClient(), "webhook_subscriptions", {
    tenant_id: t.tenantId,
    endpoint_url: `https://hooks.example.test/${randomUUID()}`,
    event_types: ["visit.completed", "prescription.issued"],
    signing_secret: randomUUID(),
    is_active: true,
    created_by: t.userId,
  });
}

export async function deactivateSubscription(id: string): Promise<void> {
  await getAdminClient().from("webhook_subscriptions").update({ is_active: false }).eq("id", id);
}
