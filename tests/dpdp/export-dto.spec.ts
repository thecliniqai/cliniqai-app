/**
 * V2-05 05-06 (P1-11, ARC-07/C15, API-15; threat T-05-19): the DPDP export carries only allow-listed fields per
 * entity (`features/dpdp/export-dto.ts`). Before 05-06 whole rows were exported (`select("*")`): tenant ids, staff
 * user ids (`created_by`, `recorded_by`, `uploaded_by`, `doctor_id`), storage paths and internal columns.
 *
 * 1. Real export on the local stack: a fully seeded synthetic patient; every key of every exported entity is in its
 *    allow-list, and no storage path, staff id or clinic id appears anywhere in the patient data.
 * 2. A planted internal column: a client that returns an extra column on every row (as a future migration would)
 *    does not get it into the bundle, through the real `exportPatientDpdpArchive`.
 * 3. The DTO functions alone.
 * Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { exportPatientDpdpArchive, type DpdpExportBundle } from "@/features/dpdp/export";
import { EXPORT_FIELDS, pickFields, toExportDtos } from "@/features/dpdp/export-dto";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor, mockCtx } from "../helpers/context";
import { seedClinicalNotes } from "../helpers/clinical-notes";

const admin = getAdminClient();

async function insertId(table: string, row: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table as any) as any).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.code ?? "no row"}`);
  return data.id as string;
}

function keysOf(rows: Array<Record<string, unknown>>): Set<string> {
  return new Set(rows.flatMap((r) => Object.keys(r)));
}

function expectSubset(keys: Iterable<string>, allowed: readonly string[], label: string) {
  const extra = [...keys].filter((k) => !allowed.includes(k));
  expect(extra, `${label}: keys outside the allow-list`).toEqual([]);
}

/** Every key of the patient-data part of a bundle is inside its entity's allow-list. */
function expectBundleWithinAllowList(bundle: DpdpExportBundle) {
  expectSubset(Object.keys(bundle.patient), EXPORT_FIELDS.patient, "patient");
  expectSubset(keysOf(bundle.encounters), [...EXPORT_FIELDS.encounter, ...EXPORT_FIELDS.encounterClinical], "encounters");
  expectSubset(keysOf(bundle.prescriptions), [...EXPORT_FIELDS.prescription, "prescription_items"], "prescriptions");
  expectSubset(
    keysOf(bundle.prescriptions.flatMap((p) => p.prescription_items as Array<Record<string, unknown>>)),
    EXPORT_FIELDS.prescriptionItem,
    "prescription items",
  );
  expectSubset(keysOf(bundle.documents), EXPORT_FIELDS.document, "documents");
  expectSubset(keysOf(bundle.billing.invoices), [...EXPORT_FIELDS.invoice, "invoice_items"], "invoices");
  expectSubset(
    keysOf(bundle.billing.invoices.flatMap((i) => i.invoice_items as Array<Record<string, unknown>>)),
    EXPORT_FIELDS.invoiceItem,
    "invoice items",
  );
  expectSubset(keysOf(bundle.billing.payments), EXPORT_FIELDS.payment, "payments");
  expectSubset(keysOf(bundle.consent_records), EXPORT_FIELDS.consentRecord, "consent records");
  expect(Object.keys(bundle).sort()).toEqual(
    ["billing", "consent_records", "documents", "encounters", "export_metadata", "patient", "prescriptions"].sort(),
  );
}

describe("DPDP export: minimal DTOs on the local stack (05-06)", () => {
  let owner: SeededTenant;
  let doctorId: string;
  let patientId: string;
  let storagePath: string;
  let bundle: DpdpExportBundle;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Export DTO ${randomUUID().slice(0, 8)}`);
    doctorId = (await addMemberToTenant(owner.tenantId, "doctor")).userId;
    patientId = await insertId("patients", {
      tenant_id: owner.tenantId,
      full_name: "Synthetic Export DTO Patient",
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      sex: "female",
      age: 37,
      allergies: ["Synthetic allergen"],
      created_by: owner.userId,
    });
    const visitId = await insertId("visits", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      doctor_id: doctorId,
      origin_type: "walk_in",
      reason_for_visit: "Synthetic follow-up",
      created_by: owner.userId,
    });
    await seedClinicalNotes(visitId, { clinical_notes: "Synthetic clinical note", vitals: { pulse: 72 } });
    const rxId = await insertId("prescriptions", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      visit_id: visitId,
      doctor_id: doctorId,
      pdf_storage_path: `${owner.tenantId}/${visitId}/rx_v1.pdf`,
    });
    await insertId("prescription_items", {
      tenant_id: owner.tenantId,
      prescription_id: rxId,
      medicine_name: "Synthetic Tablet 250",
      dosage: "1-0-1",
      duration: "5 days",
    });
    storagePath = `tenants/${owner.tenantId}/patients/${patientId}/labs/${randomUUID()}.pdf`;
    await insertId("patient_documents", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      visit_id: visitId,
      title: "Synthetic Lab Report",
      document_type: "lab_report",
      original_filename: "synthetic.pdf",
      storage_path: storagePath,
      file_size_bytes: 1024,
      mime_type: "application/pdf",
      uploaded_by: doctorId,
    });
    const invoiceId = await insertId("invoices", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      visit_id: visitId,
      invoice_number: `DTO-${randomUUID().slice(0, 8)}`,
      subtotal: 500,
      total_amount: 500,
      status: "paid",
    });
    await insertId("invoice_items", {
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      item_type: "consultation",
      description: "Synthetic consultation",
      unit_price: 500,
      quantity: 1,
      total_price: 500,
    });
    await insertId("payments", {
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      amount: 500,
      payment_method: "cash",
      notes: "Synthetic internal note",
      recorded_by: owner.userId,
    });
    await insertId("consent_records", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      consent_type: "treatment",
      status: "granted",
      recorded_by: owner.userId,
    });

    bundle = await exportPatientDpdpArchive(ctxFor(owner), patientId, { skipAudit: true });
  }, 60_000);

  it("exports every entity, each with content", () => {
    expect(bundle.patient.full_name).toBe("Synthetic Export DTO Patient");
    expect(bundle.encounters).toHaveLength(1);
    expect(bundle.encounters[0].clinical_notes).toBe("Synthetic clinical note");
    expect(bundle.encounters[0].vitals).toEqual({ pulse: 72 });
    expect(bundle.prescriptions).toHaveLength(1);
    expect(bundle.prescriptions[0].prescription_items).toEqual([
      expect.objectContaining({ medicine_name: "Synthetic Tablet 250", dosage: "1-0-1", duration: "5 days" }),
    ]);
    expect(bundle.documents).toEqual([expect.objectContaining({ title: "Synthetic Lab Report", mime_type: "application/pdf" })]);
    expect(bundle.billing.invoices[0].invoice_items).toEqual([
      expect.objectContaining({ description: "Synthetic consultation", total_price: 500 }),
    ]);
    expect(bundle.billing.payments).toEqual([expect.objectContaining({ amount: 500, payment_method: "cash" })]);
    expect(bundle.consent_records).toEqual([expect.objectContaining({ consent_type: "treatment", status: "granted" })]);
  });

  it("every key of the generated export is inside the allow-list (before: whole rows)", () => {
    expectBundleWithinAllowList(bundle);
  });

  it("no storage path, staff user id or clinic id appears in the patient data", () => {
    const { export_metadata, ...data } = bundle;
    const text = JSON.stringify(data);
    expect(text).not.toContain(storagePath);
    expect(text).not.toContain("rx_v1.pdf");
    expect(text).not.toContain("storage_path");
    expect(text).not.toContain(owner.userId);
    expect(text).not.toContain(doctorId);
    expect(text).not.toContain(owner.tenantId);
    for (const forbidden of ["created_by", "recorded_by", "uploaded_by", "doctor_id", "tenant_id", "token_hash", "notes\":\"Synthetic internal"]) {
      expect(text).not.toContain(forbidden);
    }
    // The clinic is named once, in the metadata (the data fiduciary).
    expect(export_metadata.tenant_id).toBe(owner.tenantId);
  });
});

/** A fake PostgREST client returning `rows[table]`, each with a planted internal column. */
function plantedClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const planted = (r: Record<string, unknown>) => ({ ...r, internal_planted: "synthetic-internal", storage_path: "tenants/x/y.pdf" });
  return {
    from(table: string) {
      const data = (rows[table] ?? []).map(planted);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in", "is"]) builder[m] = () => builder;
      builder.single = async () => ({ data: data[0] ?? null, error: null });
      builder.maybeSingle = async () => ({ data: data[0] ?? null, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
      return builder;
    },
  };
}

describe("DPDP export: a planted internal column never reaches the bundle (05-06)", () => {
  it("exportPatientDpdpArchive drops a column the database returns but the allow-list does not name", async () => {
    const db = plantedClient({
      patients: [{ id: "p1", full_name: "Synthetic Planted Patient", created_by: "u1", tenant_id: "t1" }],
      tenants: [{ name: "Synthetic Clinic" }],
      visits: [{ id: "v1", status: "completed", notes: { clinical_notes: "Synthetic note" }, metadata: { x: 1 } }],
      prescriptions: [{ id: "rx1", pdf_storage_path: "tenants/t1/rx.pdf", prescription_items: [{ medicine_name: "Synthetic", cdci_brand_id: "c1" }] }],
      patient_documents: [{ id: "d1", title: "Synthetic Report", uploaded_by: "u1" }],
      invoices: [{ id: "i1", invoice_number: "S-1", invoice_items: [{ description: "Synthetic", tenant_id: "t1" }] }],
      payments: [{ id: "pay1", amount: 1, command_id: "cmd", recorded_by: "u1" }],
      consent_records: [{ id: "c1", consent_type: "treatment", recorded_by: "u1" }],
    });
    const bundle = await exportPatientDpdpArchive(mockCtx(db), "p1", { skipAudit: true });

    const { export_metadata: _meta, ...data } = bundle;
    void _meta;
    const text = JSON.stringify(data);
    expect(text).not.toContain("internal_planted");
    expect(text).not.toContain("storage_path");
    expect(text).not.toContain("created_by");
    expect(text).not.toContain("cdci_brand_id");
    expect(text).not.toContain("command_id");
    expect(text).not.toContain("metadata");
    expectBundleWithinAllowList(bundle);
    // Allow-listed content still flows through.
    expect(bundle.patient.full_name).toBe("Synthetic Planted Patient");
    expect(bundle.encounters[0].clinical_notes).toBe("Synthetic note");
    expect(bundle.prescriptions[0].prescription_items).toEqual([{ medicine_name: "Synthetic" }]);
  });
});

describe("export-dto functions", () => {
  it("pickFields copies only listed own properties and ignores non-objects", () => {
    expect(pickFields({ a: 1, b: 2, c: undefined }, ["a", "c", "z"])).toEqual({ a: 1, c: undefined });
    expect(pickFields(null, ["a"])).toEqual({});
    expect(pickFields(["a"], ["0"])).toEqual({});
    expect(pickFields(Object.create({ inherited: 1 }), ["inherited"])).toEqual({});
  });

  it("toExportDtos tolerates missing collections and keeps nested items to their own lists", () => {
    const dtos = toExportDtos({
      patient: { id: "p", full_name: "Synthetic", is_deleted: false, erasure_reason: "x" },
      encounters: null,
      prescriptions: [{ id: "rx", prescription_items: [{ medicine_name: "M", prescription_id: "rx", tenant_id: "t" }] }],
      documents: undefined,
      invoices: [{ id: "i" }],
      payments: [{ id: "pay", recorded_by_system: "sys" }],
      consentRecords: "not an array",
    });
    expect(dtos).toEqual({
      patient: { id: "p", full_name: "Synthetic" },
      encounters: [],
      prescriptions: [{ id: "rx", prescription_items: [{ medicine_name: "M" }] }],
      documents: [],
      billing: { invoices: [{ id: "i", invoice_items: [] }], payments: [{ id: "pay" }] },
      consent_records: [],
    });
  });

  it("no allow-list names a storage path, token hash, staff id or tenant id", () => {
    const all = Object.values(EXPORT_FIELDS).flat();
    for (const banned of ["storage_path", "pdf_storage_path", "token_hash", "created_by", "recorded_by", "uploaded_by", "doctor_id", "signed_by", "tenant_id", "command_id", "metadata"]) {
      expect(all).not.toContain(banned);
    }
  });
});
