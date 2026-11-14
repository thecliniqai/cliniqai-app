/**
 * The seeded world the P0-13 guard specs share (V2-02 plan 02-02 step 3, 02-06 review fixes). Local stack only;
 * synthetic data only.
 *
 *   - tenant A: owner, admin, doctor, nurse and receptionist (each a real user with a real JWT client);
 *   - tenant B: an owner and one row in every table an action or route takes an id for (`seedTenantRows`: patient,
 *     visit and a signed visit, invoice and item, lab document, prescription and item, referral, schedule block,
 *     waitlist entry, notification, webhook subscription, API key, diagnosis), plus two share tokens (an appointment
 *     token and a document token);
 *   - `aRows(caller)`: a FRESH set of the same rows in tenant A on every call (02-06, IR-F2/AR-M2a). Leg 3 forges one
 *     reference at a time into otherwise-valid tenant-A inputs, and a positive control proves those inputs succeed;
 *     each call gets its own rows, so a destructive control or variant cannot make the next one vacuous;
 *   - `dual`: per role R, a user who is R in tenant A AND a receptionist in tenant B (02-06, AR-M2b). RLS admits every
 *     clinic a user belongs to, so acting in A with A's role must still never reach B's rows by id;
 *   - `noMember`: a signed-in user with no membership (the "no clinic" leg);
 *   - `outsider`: a second user with no membership, for the `{ authenticated }` actions (onboarding may give it a
 *     clinic, so it is kept apart from `noMember`).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { UserRole } from "@/lib/db/types";
import { referralLetterPath } from "@/lib/storage/tenant-path";
import { getAdminClient } from "../../helpers/supabase-admin";
import { addMemberToTenant, createUnlinkedUser, seedTenantWithOwner, type SeededTenant } from "../../helpers/tenants";
import { insertReturningId, type TestDb } from "../../helpers/db";
import type { TablesInsert } from "@/types/database";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";
import { nextSeedSlotMinutes } from "../../helpers/seed-slots";

/** One row id per table an entry point takes an id for, plus the tenant, a user and a membership. */
export interface TenantRowIds {
  tenant: string;
  /** The doctor/owner user the rows point at (`doctor_id`, `created_by`, …). */
  ownerUser: string;
  /** A membership of this tenant (B: the owner's; A: the caller's own). */
  membership: string;
  /** The acting caller (B: the owner). A schedule block is the caller's own time: only managers block others'. */
  callerUser: string;
  patient: string;
  visit: string;
  /** A completed, signed visit of the same patient (amendment flows). */
  signedVisit: string;
  invoice: string;
  invoiceItem: string;
  document: string;
  prescription: string;
  rxItem: string;
  referral: string;
  /**
   * A referral this clinic RECEIVES (target = this clinic), for the inbound-referral actions (acknowledge). Tenant A:
   * sent by a third, unrelated clinic S (05-06: a clinic cannot refer to itself, and a B-originated row would change
   * B's snapshot); tenant B: B's own referral (any B id is a valid forged reference).
   */
  inboundReferral: string;
  block: string;
  waitlist: string;
  notification: string;
  webhookSub: string;
  apiKey: string;
  diagnosis: string;
}

/** The tenant-A doctor's shift on every weekday (IST), seeded by `seedGuardWorld`. */
export const GUARD_DOCTOR_SHIFT = { start: "08:00", end: "20:00" } as const;

/** Tenant B's rows (the name the engine and the canary use). */
export type TenantBIds = TenantRowIds;

/** The acting caller a fresh tenant-A row set is seeded for (notification recipient, own membership). */
export interface Caller {
  userId: string;
  role: UserRole;
}

export interface GuardWorld {
  tenantA: string;
  roles: Record<UserRole, SeededTenant>;
  b: TenantBIds;
  /** Every string that must never come back to a tenant-A caller (B's ids, names, phone and owner email). */
  bSecrets: string[];
  /** Raw share tokens issued by tenant B (for the public-token wrong-type leg). */
  bTokens: { appointment: string; patientDocument: string };
  /** A fresh set of tenant-A rows for `caller` (see the file comment). */
  aRows: (caller: Caller) => Promise<TenantRowIds>;
  /** Per role R: R in tenant A and a receptionist in tenant B. */
  dual: Record<UserRole, SeededTenant>;
  noMember: { userId: string; client: TestDb };
  outsider: { userId: string; client: TestDb };
}

const insertRow = insertReturningId;

async function insertToken(
  admin: TestDb,
  row: Omit<TablesInsert<"document_share_tokens">, "token_hash">,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const { error } = await admin
    .from("document_share_tokens")
    .insert({ token_hash: createHash("sha256").update(token, "utf8").digest("hex"), ...row });
  if (error) throw new Error(`guard world: seed share token failed: ${error.message}`);
  return token;
}

async function membershipId(admin: TestDb, tenantId: string, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`guard world: membership lookup failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function putObject(admin: TestDb, key: string): Promise<void> {
  const { error } = await admin.storage
    .from("clinic-records")
    .upload(key, Buffer.from("%PDF-1.4 synthetic guard object"), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`guard world: storage seed failed: ${error.message}`);
}

const syntheticPhone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const daysAhead = (d: number, minutes = 0) => new Date(Date.now() + d * 86_400_000 + minutes * 60_000);

interface RowSeed {
  tenantId: string;
  doctorUser: string;
  caller: Caller;
  membership: string;
  patientName: string;
  patientPhone: string;
  /** Target clinic of the seeded referral (null: out of network). */
  referralTarget: string | null;
  /** When set, also seed a referral from this clinic to `tenantId` (listed in the directory first): `inboundReferral`. */
  inboundFrom?: { tenantId: string; patientId: string; doctorUser: string };
  /**
   * False for a caller with no membership in `tenantId` (the `outsider` of the { authenticated } actions): the seeded
   * schedule block then belongs to the clinic's doctor, because since V2-05 05-03 a block's doctor must be a member of
   * its clinic (composite FK to memberships).
   */
  callerIsMember?: boolean;
}

/** One row in every table an entry point takes an id for, in `seed.tenantId`. */
export async function seedTenantRows(admin: TestDb, seed: RowSeed): Promise<TenantRowIds> {
  const t = seed.tenantId;
  const u = seed.doctorUser;
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  // Future minutes that keep every seeded slot apart (a random base, then a 20-minute step per seed): since V2-05 05-08
  // two overlapping scheduled visits of the doctor are refused (visits_no_double_booking), and a booking control never
  // collides with an earlier seed.
  const offset = nextSeedSlotMinutes();
  // The block sits on a known UTC date (5 days ahead, 06:00-11:00 UTC start, same date in IST), so a by-date read finds it.
  const now = new Date();
  const blockStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5, 6, Math.floor(Math.random() * 300))
  );

  const patient = await insertRow(admin, "patients", {
    tenant_id: t,
    full_name: seed.patientName,
    phone: seed.patientPhone,
    sex: "female",
    age: 41,
    created_by: u,
  });
  const [visit, signedVisit, document, referral, block, waitlist, notification, webhookSub, apiKey] = await Promise.all([
    insertRow(admin, "visits", {
      tenant_id: t,
      patient_id: patient,
      doctor_id: u,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: daysAhead(2, offset).toISOString(),
      created_by: u,
    }),
    insertRow(admin, "visits", {
      tenant_id: t,
      patient_id: patient,
      doctor_id: u,
      origin_type: "walk_in",
      status: "completed",
      scheduled_at: daysAhead(-1, -offset).toISOString(),
      signed_at: daysAhead(-1, 30 - offset).toISOString(),
      signed_by: u,
      created_by: u,
    }),
    insertRow(admin, "patient_documents", {
      tenant_id: t,
      patient_id: patient,
      title: "Synthetic Guard Report",
      original_filename: "synthetic.pdf",
      storage_path: `tenants/${t}/patients/${patient}/labs/synthetic_${tag}.pdf`,
      file_size_bytes: 12,
      mime_type: "application/pdf",
      // Explicit since 05-08 (no SQL default; the fill trigger would give the same clinic date).
      report_date: todayInTz(DEFAULT_CLINIC_TZ),
      uploaded_by: u,
    }),
    insertRow(admin, "referrals", {
      tenant_id: t,
      patient_id: patient,
      referral_type: seed.referralTarget ? "in_network" : "out_of_network",
      target_tenant_id: seed.referralTarget,
      referring_doctor_id: u,
      referred_to_name: "Synthetic Specialist",
      reason_for_referral: "Synthetic reason",
    }),
    insertRow(admin, "schedule_blocks", {
      tenant_id: t,
      doctor_id: seed.callerIsMember === false ? u : seed.caller.userId,
      start_time: blockStart.toISOString(),
      end_time: new Date(blockStart.getTime() + 3_600_000).toISOString(),
      reason: "Synthetic block",
      created_by: u,
    }),
    insertRow(admin, "waitlist_entries", {
      tenant_id: t,
      patient_id: patient,
      doctor_id: u,
      target_date: daysAhead(3).toISOString().slice(0, 10),
      created_by: u,
    }),
    insertRow(admin, "in_app_notifications", {
      tenant_id: t,
      recipient_user_id: seed.caller.userId,
      recipient_role: seed.caller.role,
      category: "system",
      event_type: "guard.synthetic",
      title: "Synthetic notification",
      message: "Synthetic message",
    }),
    insertRow(admin, "webhook_subscriptions", {
      tenant_id: t,
      endpoint_url: "https://example.invalid/guard-hook",
      event_types: ["visit.created"],
      signing_secret: randomBytes(16).toString("hex"),
      created_by: u,
    }),
    insertRow(admin, "api_keys", {
      tenant_id: t,
      name: "Synthetic Guard Key",
      key_prefix: `clq_live_g${tag}`,
      key_hash: randomBytes(32).toString("hex"),
      created_by: u,
    }),
  ]);
  const [invoice, prescription, diagnosis] = await Promise.all([
    insertRow(admin, "invoices", {
      tenant_id: t,
      visit_id: visit,
      patient_id: patient,
      invoice_number: `INV-GUARD-${tag}`,
      subtotal: 500,
      total_amount: 500,
      status: "issued",
    }),
    insertRow(admin, "prescriptions", {
      tenant_id: t,
      visit_id: visit,
      patient_id: patient,
      doctor_id: u,
    }),
    insertRow(admin, "consultation_diagnoses", {
      tenant_id: t,
      visit_id: visit,
      patient_id: patient,
      diagnosis_name: "Synthetic diagnosis",
    }),
  ]);
  const [invoiceItem, rxItem] = await Promise.all([
    insertRow(admin, "invoice_items", {
      tenant_id: t,
      invoice_id: invoice,
      item_type: "consultation",
      description: "Synthetic consultation",
      unit_price: 500,
      quantity: 1,
      total_price: 500,
    }),
    insertRow(admin, "prescription_items", {
      tenant_id: t,
      prescription_id: prescription,
      medicine_name: "Synthetic Tablet 500",
      dosage: "1-0-1",
      duration: "5 days",
    }),
    // The letter and the document exist in storage, so the signed-URL controls can succeed.
    putObject(admin, `tenants/${t}/patients/${patient}/labs/synthetic_${tag}.pdf`),
    putObject(admin, referralLetterPath(t, referral)),
  ]);
  const { error: refErr } = await admin
    .from("referrals")
    .update({ pdf_storage_path: referralLetterPath(t, referral) })
    .eq("id", referral);
  if (refErr) throw new Error(`guard world: referral letter marker failed: ${refErr.message}`);

  let inboundReferral = referral;
  if (seed.inboundFrom) {
    const { error: listErr } = await admin.from("tenants").update({ referral_directory_listed: true }).eq("id", t);
    if (listErr) throw new Error(`guard world: listing the inbound target failed: ${listErr.code ?? "unknown"}`);
    inboundReferral = await insertRow(admin, "referrals", {
      tenant_id: seed.inboundFrom.tenantId,
      patient_id: seed.inboundFrom.patientId,
      referral_type: "in_network",
      target_tenant_id: t,
      referring_doctor_id: seed.inboundFrom.doctorUser,
      referred_to_name: "Synthetic Partner Clinic",
      reason_for_referral: "Synthetic reason",
    });
  }

  return {
    tenant: t,
    ownerUser: u,
    membership: seed.membership,
    callerUser: seed.caller.userId,
    patient,
    visit,
    signedVisit,
    invoice,
    invoiceItem,
    document,
    prescription,
    rxItem,
    referral,
    inboundReferral,
    block,
    waitlist,
    notification,
    webhookSub,
    apiKey,
    diagnosis,
  };
}

export async function seedGuardWorld(label: string): Promise<GuardWorld> {
  const admin = getAdminClient();
  const tag = randomUUID().slice(0, 8);

  const ownerA = await seedTenantWithOwner(`Guard ${label} A ${tag}`);
  const roles: Record<UserRole, SeededTenant> = {
    owner: ownerA,
    admin: await addMemberToTenant(ownerA.tenantId, "admin"),
    doctor: await addMemberToTenant(ownerA.tenantId, "doctor"),
    nurse: await addMemberToTenant(ownerA.tenantId, "nurse"),
    receptionist: await addMemberToTenant(ownerA.tenantId, "receptionist"),
  };

  // The A doctor works 08:00-20:00 IST every day (GUARD_DOCTOR_SHIFT), so a slot control inside it is never off-duty.
  const day = { enabled: true, shifts: [GUARD_DOCTOR_SHIFT] };
  const { error: scheduleErr } = await admin
    .from("memberships")
    .update({
      availability_schedule: { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day },
    })
    .eq("tenant_id", ownerA.tenantId)
    .eq("user_id", roles.doctor.userId);
  if (scheduleErr) throw new Error(`guard world: doctor schedule failed: ${scheduleErr.message}`);

  const ownerB = await seedTenantWithOwner(`Guard ${label} B ${tag}`);
  // S: an unrelated clinic that refers patients to A, so A's inbound-referral actions have a row (05-06: no
  // self-referral; not B, whose snapshot the legs compare).
  const ownerS = await seedTenantWithOwner(`Guard ${label} S ${tag}`);
  const patientS = await insertRow(admin, "patients", {
    tenant_id: ownerS.tenantId,
    full_name: `Synthetic Guard Patient S ${tag}`,
    phone: syntheticPhone(),
    created_by: ownerS.userId,
  });
  const t = ownerB.tenantId;
  const u = ownerB.userId;
  const patientName = `Synthetic Guard Patient B ${tag}`;
  const patientPhone = syntheticPhone();

  const b = await seedTenantRows(admin, {
    tenantId: t,
    doctorUser: u,
    caller: { userId: u, role: "owner" },
    membership: await membershipId(admin, t, u),
    patientName,
    patientPhone,
    referralTarget: null,
  });

  const appointmentToken = await insertToken(admin, {
    tenant_id: t,
    resource_type: "appointment",
    resource_id: b.visit,
    created_by: u,
    expires_at: daysAhead(7).toISOString(),
  });
  const documentToken = await insertToken(admin, {
    tenant_id: t,
    resource_type: "patient_document",
    resource_id: b.document,
    document_id: b.document,
    created_by: u,
    expires_at: daysAhead(7).toISOString(),
  });

  // Per role R: R in A, receptionist in B. Created before any snapshot of B, so their B membership is part of it.
  const dual = {} as Record<UserRole, SeededTenant>;
  for (const role of Object.keys(roles) as UserRole[]) {
    const member = await addMemberToTenant(ownerA.tenantId, role);
    const { error } = await admin.from("memberships").insert({ user_id: member.userId, tenant_id: t, role: "receptionist" });
    if (error) throw new Error(`guard world: dual membership failed: ${error.message}`);
    dual[role] = member;
  }

  const memberships = new Map<string, string>();
  const aRows = async (caller: Caller): Promise<TenantRowIds> => {
    let own = memberships.get(caller.userId);
    const isMember = Object.values(roles).some((r) => r.userId === caller.userId) ||
      Object.values(dual).some((r) => r.userId === caller.userId);
    if (!own) {
      // A caller without an A membership (the `outsider` of the { authenticated } actions) gets the owner's.
      own = await membershipId(admin, ownerA.tenantId, isMember ? caller.userId : ownerA.userId);
      memberships.set(caller.userId, own);
    }
    return seedTenantRows(admin, {
      tenantId: ownerA.tenantId,
      // A calling doctor gets rows of their OWN visits (05-02b, R-7: a doctor reads and bills only the visits they are
      // the doctor of), so the positive control of a doctor acting in A (leg 3b's dual doctor) is a legitimate call.
      doctorUser: isMember && caller.role === "doctor" ? caller.userId : roles.doctor.userId,
      caller,
      membership: own,
      patientName: `Synthetic Guard Patient A ${randomUUID().slice(0, 8)}`,
      patientPhone: syntheticPhone(),
      referralTarget: null,
      inboundFrom: { tenantId: ownerS.tenantId, patientId: patientS, doctorUser: ownerS.userId },
      callerIsMember: isMember,
    });
  };

  return {
    tenantA: ownerA.tenantId,
    roles,
    b,
    bSecrets: [...Object.values(b), ownerB.tenantName, patientName, patientPhone, ownerB.userEmail],
    bTokens: { appointment: appointmentToken, patientDocument: documentToken },
    aRows,
    dual,
    noMember: await createUnlinkedUser(),
    outsider: await createUnlinkedUser(),
  };
}
