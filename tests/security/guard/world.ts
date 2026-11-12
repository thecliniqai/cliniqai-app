/**
 * The seeded world the P0-13 guard specs share (V2-02 plan 02-02 step 3). Local stack only; synthetic data only.
 *
 *   - tenant A: owner, admin, doctor, nurse and receptionist (each a real user with a real JWT client);
 *   - tenant B: an owner and one row in every table an action or route takes an id for (patient, visit, invoice and
 *     item, lab document, prescription and item, referral, schedule block, waitlist entry, notification, webhook
 *     subscription, API key, diagnosis), plus two share tokens (an appointment token and a document token);
 *   - `noMember`: a signed-in user with no membership (the "no clinic" leg);
 *   - `outsider`: a second user with no membership, for the `{ authenticated }` actions (onboarding may give it a
 *     clinic, so it is kept apart from `noMember`).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { UserRole } from "@/lib/db/types";
import { getAdminClient } from "../../helpers/supabase-admin";
import { addMemberToTenant, createUnlinkedUser, seedTenantWithOwner, type SeededTenant } from "../../helpers/tenants";
import type { TestDb } from "../../helpers/db";

export interface TenantBIds {
  tenant: string;
  ownerUser: string;
  membership: string;
  patient: string;
  visit: string;
  invoice: string;
  invoiceItem: string;
  document: string;
  prescription: string;
  rxItem: string;
  referral: string;
  block: string;
  waitlist: string;
  notification: string;
  webhookSub: string;
  apiKey: string;
  diagnosis: string;
}

export interface GuardWorld {
  tenantA: string;
  roles: Record<UserRole, SeededTenant>;
  b: TenantBIds;
  /** Every string that must never come back to a tenant-A caller (B's ids, names, phone and owner email). */
  bSecrets: string[];
  /** Raw share tokens issued by tenant B (for the public-token wrong-type leg). */
  bTokens: { appointment: string; patientDocument: string };
  noMember: { userId: string; client: TestDb };
  outsider: { userId: string; client: TestDb };
}

async function insertRow(admin: TestDb, table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error || !data) throw new Error(`guard world: seed ${table} failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function insertToken(admin: TestDb, row: Record<string, unknown>): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const { error } = await admin
    .from("document_share_tokens")
    .insert({ token_hash: createHash("sha256").update(token, "utf8").digest("hex"), ...row });
  if (error) throw new Error(`guard world: seed share token failed: ${error.message}`);
  return token;
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

  const ownerB = await seedTenantWithOwner(`Guard ${label} B ${tag}`);
  const t = ownerB.tenantId;
  const u = ownerB.userId;
  const patientName = `Synthetic Guard Patient B ${tag}`;
  const patientPhone = `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  const { data: membership, error: memErr } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", t)
    .eq("user_id", u)
    .single();
  if (memErr || !membership) throw new Error(`guard world: B membership lookup failed: ${memErr?.message}`);

  const patient = await insertRow(admin, "patients", {
    tenant_id: t,
    full_name: patientName,
    phone: patientPhone,
    sex: "female",
    age: 41,
    created_by: u,
  });
  const visit = await insertRow(admin, "visits", {
    tenant_id: t,
    patient_id: patient,
    doctor_id: u,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    created_by: u,
  });
  const invoice = await insertRow(admin, "invoices", {
    tenant_id: t,
    visit_id: visit,
    patient_id: patient,
    invoice_number: `INV-GUARD-${tag}`,
  });
  const invoiceItem = await insertRow(admin, "invoice_items", {
    tenant_id: t,
    invoice_id: invoice,
    item_type: "consultation",
    description: "Synthetic consultation",
    unit_price: 500,
    quantity: 1,
    total_price: 500,
  });
  const document = await insertRow(admin, "patient_documents", {
    tenant_id: t,
    patient_id: patient,
    title: "Synthetic Guard Report",
    original_filename: "synthetic.pdf",
    storage_path: `tenants/${t}/patients/${patient}/labs/synthetic_${tag}.pdf`,
    file_size_bytes: 12,
    mime_type: "application/pdf",
    uploaded_by: u,
  });
  const prescription = await insertRow(admin, "prescriptions", {
    tenant_id: t,
    visit_id: visit,
    patient_id: patient,
    doctor_id: u,
  });
  const rxItem = await insertRow(admin, "prescription_items", {
    prescription_id: prescription,
    medicine_name: "Synthetic Tablet 500",
    dosage: "1-0-1",
    duration: "5 days",
  });
  const referral = await insertRow(admin, "referrals", {
    tenant_id: t,
    patient_id: patient,
    referral_type: "out_of_network",
    referring_doctor_id: u,
    referred_to_name: "Synthetic Specialist",
    reason_for_referral: "Synthetic reason",
  });
  const block = await insertRow(admin, "schedule_blocks", {
    tenant_id: t,
    doctor_id: u,
    start_time: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    end_time: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString(),
    reason: "Synthetic block",
    created_by: u,
  });
  const waitlist = await insertRow(admin, "waitlist_entries", {
    tenant_id: t,
    patient_id: patient,
    doctor_id: u,
    target_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    created_by: u,
  });
  const notification = await insertRow(admin, "in_app_notifications", {
    tenant_id: t,
    recipient_user_id: u,
    recipient_role: "owner",
    category: "system",
    event_type: "guard.synthetic",
    title: "Synthetic notification",
    message: "Synthetic message",
  });
  const webhookSub = await insertRow(admin, "webhook_subscriptions", {
    tenant_id: t,
    endpoint_url: "https://example.invalid/guard-hook",
    event_types: ["visit.created"],
    signing_secret: randomBytes(16).toString("hex"),
    created_by: u,
  });
  const apiKey = await insertRow(admin, "api_keys", {
    tenant_id: t,
    name: "Synthetic Guard Key B",
    key_prefix: `clq_live_g${tag.slice(0, 6)}`,
    key_hash: randomBytes(32).toString("hex"),
    created_by: u,
  });
  const diagnosis = await insertRow(admin, "consultation_diagnoses", {
    tenant_id: t,
    visit_id: visit,
    patient_id: patient,
    diagnosis_name: "Synthetic diagnosis",
  });

  const appointmentToken = await insertToken(admin, {
    tenant_id: t,
    resource_type: "appointment",
    resource_id: visit,
    created_by: u,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  const documentToken = await insertToken(admin, {
    tenant_id: t,
    resource_type: "patient_document",
    resource_id: document,
    document_id: document,
    created_by: u,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });

  const b: TenantBIds = {
    tenant: t,
    ownerUser: u,
    membership: (membership as { id: string }).id,
    patient,
    visit,
    invoice,
    invoiceItem,
    document,
    prescription,
    rxItem,
    referral,
    block,
    waitlist,
    notification,
    webhookSub,
    apiKey,
    diagnosis,
  };

  return {
    tenantA: ownerA.tenantId,
    roles,
    b,
    bSecrets: [...Object.values(b), ownerB.tenantName, patientName, patientPhone, ownerB.userEmail],
    bTokens: { appointment: appointmentToken, patientDocument: documentToken },
    noMember: await createUnlinkedUser(),
    outsider: await createUnlinkedUser(),
  };
}
