import React from "react";
import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/audit";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadFile,
  getSignedUrl,
  SupabaseStorageProvider,
} from "@/lib/storage";
import {
  PrescriptionDocument,
  PrescriptionPdfPayload,
} from "./prescription-document";

export interface GeneratePrescriptionPdfResult {
  signedUrl: string;
  storagePath: string;
  buffer: Buffer;
}

/**
 * Converts a Node ReadableStream or raw buffer into a single Buffer.
 */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (stream && typeof (stream as any)[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array | Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from(stream as any);
}

/**
 * Compiles an electronic prescription into an A4 PDF document on the server,
 * uploads it via the unified storage abstraction (lib/storage/),
 * generates a 3600-second signed URL, and records a compliance audit log entry.
 */
export async function generateAndArchivePrescriptionPdf(
  payload: PrescriptionPdfPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GeneratePrescriptionPdfResult> {
  const supabase = clientOverride || (sessionOverride ? getAdminClient() : await createClient());
  const session = sessionOverride || {
    userId: payload.doctor.name, // fallback for testing
    tenantId: payload.tenant_id,
  };

  // Enrich clinic statutory details if not already provided
  if (
    payload.clinic.clinical_establishment_reg_no === undefined &&
    payload.clinic.state_medical_council_reg_no === undefined &&
    payload.tenant_id
  ) {
    try {
      const { data: tenantRow } = await (supabase.from("tenants") as any)
        .select("clinical_establishment_reg_no, state_medical_council_reg_no, gstin, drug_license_no")
        .eq("id", payload.tenant_id)
        .maybeSingle();

      if (tenantRow) {
        payload.clinic.clinical_establishment_reg_no = tenantRow.clinical_establishment_reg_no;
        payload.clinic.state_medical_council_reg_no = tenantRow.state_medical_council_reg_no;
        payload.clinic.gstin = tenantRow.gstin;
        payload.clinic.drug_license_no = tenantRow.drug_license_no;
      }
    } catch {
      // Continue with provided payload if tenant query fails
    }
  }

  // 1. Render React-PDF document to binary buffer server-side
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(PrescriptionDocument, { payload }) as any;
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  const buffer = await streamToBuffer(stream);

  // 2. Define deterministic storage path: ${tenant_id}/${visit_id}/rx_v${version}.pdf
  const storagePath = `${payload.tenant_id}/${payload.visit_id}/rx_v${payload.version}.pdf`;

  // 3. Resolve storage provider (respecting clientOverride if provided)
  const storageProvider = clientOverride
    ? new SupabaseStorageProvider({ defaultBucket: "prescriptions", client: clientOverride })
    : undefined;

  // Upload using unified storage abstraction
  try {
    await uploadFile(
      {
        path: storagePath,
        buffer,
        contentType: "application/pdf",
        bucket: "prescriptions",
        upsert: true,
      },
      storageProvider
    );
  } catch (uploadErr) {
    console.error("[features/prescriptions/pdf/generator] Upload failed:", uploadErr);
    throw new Error(
      `Failed to upload prescription PDF to storage: ${uploadErr instanceof Error ? uploadErr.message : "Unknown error"}`
    );
  }

  // 4. Update prescription row with pdf_storage_path and letterhead_mode if prescription_id is valid
  if (payload.prescription_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("prescriptions") as any)
      .update({
        pdf_storage_path: storagePath,
        letterhead_mode: payload.letterhead_mode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.prescription_id)
      .eq("tenant_id", payload.tenant_id);
  }

  // 5. Generate secure, time-limited signed URL (3600s TTL)
  const { signedUrl } = await getSignedUrl(
    {
      path: storagePath,
      expiresInSeconds: 3600,
      bucket: "prescriptions",
    },
    storageProvider
  );

  // 6. Record compliance audit trail (AGENTS.md §9, §10)
  try {
    await recordAudit(
      {
        action: "prescription.generate_pdf",
        entityType: "prescription",
        entityId: payload.prescription_id || payload.visit_id,
        metadata: {
          version: payload.version,
          letterhead_mode: payload.letterhead_mode,
          storage_path: storagePath,
        },
      },
      supabase as any,
      session
    );
  } catch (auditErr) {
    console.warn("[features/prescriptions/pdf/generator] Audit log warning:", auditErr);
  }

  return {
    signedUrl,
    storagePath,
    buffer,
  };
}
