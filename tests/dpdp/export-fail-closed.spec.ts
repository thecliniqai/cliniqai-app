/**
 * The DPDP Right-to-Access export fails closed (V2-05 05a review INT L-1; plan 05-11c). Before, only the patient query's
 * error was checked: an error in the clinic, encounters, prescriptions, documents, invoices, payments or consent query
 * was dropped (`data ?? []`), so the archive shipped incomplete with a "completed" audit row. Now each failed section
 * raises `ExportIncompleteError` and no audit row is written. A failed patient read is that error too, not "not found".
 * Stubbed database (every outcome forced); the audit writer is a spy. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

import { recordAudit } from "@/lib/audit/audit";
import { ExportIncompleteError, exportPatientDpdpArchive } from "@/features/dpdp/export";
import { mockCtx } from "../helpers/context";

const FAILURE = { code: "XX000", message: "SENTINEL_EXPORT_FAULT" };

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  patients: [{ id: "p1", full_name: "Synthetic Export Patient" }],
  tenants: [{ name: "Synthetic Clinic" }],
  visits: [{ id: "v1", status: "completed" }],
  prescriptions: [{ id: "rx1" }],
  patient_documents: [{ id: "d1", title: "Synthetic Report" }],
  invoices: [{ id: "i1", invoice_number: "S-1" }],
  payments: [{ id: "pay1", amount: 1 }],
  consent_records: [{ id: "c1", consent_type: "treatment" }],
};

/** A client whose `failing` table answers every query with an error; the others with ROWS. */
function client(failing: string | null, patientError: Record<string, string> | null = null) {
  return {
    from(table: string) {
      const error = table === failing ? FAILURE : table === "patients" ? patientError : null;
      const data = error ? null : (ROWS[table] ?? []);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in", "is"]) builder[m] = () => builder;
      builder.single = async () => ({ data: data?.[0] ?? null, error });
      builder.maybeSingle = async () => ({ data: data?.[0] ?? null, error });
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error });
      return builder;
    },
  };
}

describe("DPDP export fails closed on any section error (05-11c, INT L-1)", () => {
  beforeEach(() => vi.mocked(recordAudit).mockClear());

  it.each([
    ["tenants", "clinic"],
    ["visits", "encounters"],
    ["prescriptions", "prescriptions"],
    ["patient_documents", "documents"],
    ["invoices", "invoices"],
    ["payments", "payments"],
    ["consent_records", "consent_records"],
  ])("a failed %s query → ExportIncompleteError (%s), no bundle, no audit row", async (table, section) => {
    const err = await exportPatientDpdpArchive(mockCtx(client(table)), "p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportIncompleteError);
    expect((err as ExportIncompleteError).section).toBe(section);
    expect((err as Error).message).not.toContain("SENTINEL");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a failed patient read is ExportIncompleteError, not 'not found'; a missing patient is still 'not found'", async () => {
    const failed = await exportPatientDpdpArchive(mockCtx(client(null, FAILURE)), "p1").catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ExportIncompleteError);
    const missing = await exportPatientDpdpArchive(
      mockCtx(client(null, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })),
      "p1"
    ).catch((e: unknown) => e);
    expect(missing).not.toBeInstanceOf(ExportIncompleteError);
    expect((missing as Error).message).toMatch(/^Patient not found/);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("control: with every query answering, the bundle is complete and audited exactly once as completed", async () => {
    const bundle = await exportPatientDpdpArchive(mockCtx(client(null)), "p1");
    expect(bundle.patient.full_name).toBe("Synthetic Export Patient");
    expect(bundle.encounters).toHaveLength(1);
    expect(bundle.billing.payments).toHaveLength(1);
    expect(bundle.consent_records).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAudit).mock.calls[0][1]).toMatchObject({
      action: "dpdp.data_export",
      metadata: { format: "json", status: "completed" },
    });
  });
});
