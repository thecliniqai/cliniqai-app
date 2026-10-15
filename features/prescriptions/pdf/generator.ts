import React from "react";
import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit/audit";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 * uploads it to the private Supabase Storage bucket 'prescriptions',
 * generates a 3600-second signed URL, and records a compliance audit log entry.
 */
export async function generateAndArchivePrescriptionPdf(
  payload: PrescriptionPdfPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GeneratePrescriptionPdfResult> {
  // 1. Render React-PDF document to binary buffer server-side
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(PrescriptionDocument, { payload }) as any;
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  const buffer = await streamToBuffer(stream);

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || {
    userId: payload.doctor.name, // fallback for testing
    tenantId: payload.tenant_id,
  };

  // 2. Define deterministic storage path: ${tenant_id}/${visit_id}/rx_v${version}.pdf
  const storagePath = `${payload.tenant_id}/${payload.visit_id}/rx_v${payload.version}.pdf`;

  // 3. Upload to private 'prescriptions' bucket
  const { error: uploadErr } = await supabase.storage
    .from("prescriptions")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[features/prescriptions/pdf/generator] Upload failed:", uploadErr);
    throw new Error(`Failed to upload prescription PDF to storage: ${uploadErr.message}`);
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
  const { data: signedData, error: signErr } = await supabase.storage
    .from("prescriptions")
    .createSignedUrl(storagePath, 3600);

  if (signErr || !signedData?.signedUrl) {
    console.error("[features/prescriptions/pdf/generator] Signed URL generation failed:", signErr);
    throw new Error("Failed to generate signed download URL for prescription PDF.");
  }

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
      clientOverride as any,
      session
    );
  } catch (auditErr) {
    console.warn("[features/prescriptions/pdf/generator] Audit log warning:", auditErr);
  }

  return {
    signedUrl: signedData.signedUrl,
    storagePath,
    buffer,
  };
}
