import React from "react";
import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadFile,
  getSignedUrl,
  SupabaseStorageProvider,
} from "@/lib/storage";
import {
  ReferralLetterDocument,
  ReferralPdfPayload,
} from "./referral-letter-document";

export interface GenerateReferralPdfResult {
  signedUrl: string;
  storagePath: string;
  buffer: Buffer;
}

/**
 * Converts a stream or raw buffer into a single Buffer.
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
 * Compiles a branded referral letter into an A4 PDF document on the server,
 * uploads it via the unified storage abstraction (lib/storage/),
 * generates a 3600-second signed URL, and persists the storage path.
 */
export async function generateAndArchiveReferralPdf(
  payload: ReferralPdfPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GenerateReferralPdfResult> {
  // 1. Render React-PDF document to binary buffer server-side
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(ReferralLetterDocument, { payload }) as any;
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  const buffer = await streamToBuffer(stream);

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || {
    userId: payload.referring_doctor.name,
    tenantId: payload.tenant_id,
  };

  // 2. Define deterministic storage path: tenants/${tenant_id}/referrals/${referral_id}/referral_letter.pdf
  const storagePath = `tenants/${payload.tenant_id}/referrals/${payload.referral_id}/referral_letter.pdf`;

  // 3. Resolve storage provider (respecting clientOverride if provided)
  const storageProvider = clientOverride
    ? new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: clientOverride })
    : undefined;

  // Upload using unified storage abstraction
  try {
    await uploadFile(
      {
        path: storagePath,
        buffer,
        contentType: "application/pdf",
        bucket: "clinic-records",
        upsert: true,
      },
      storageProvider
    );
  } catch (uploadErr) {
    console.error("[features/referrals/pdf/generator] Upload failed:", uploadErr);
    throw new Error(
      `Failed to upload referral letter PDF to storage: ${uploadErr instanceof Error ? uploadErr.message : "Unknown error"}`
    );
  }

  // 4. Generate 3600s signed URL
  const { signedUrl } = await getSignedUrl(
    {
      path: storagePath,
      expiresInSeconds: 3600,
      bucket: "clinic-records",
    },
    storageProvider
  );

  // 5. Update referral record in database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("referrals") as any)
    .update({
      pdf_storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.referral_id)
    .eq("tenant_id", session.tenantId);

  return {
    signedUrl,
    storagePath,
    buffer,
  };
}
