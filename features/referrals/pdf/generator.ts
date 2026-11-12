import "server-only";

import React from "react";
import { pdf } from "@react-pdf/renderer";
import type { ServiceContext } from "@/lib/auth/context";
import { uploadFile, getSignedUrl, getStorageProviderForDb } from "@/lib/storage";
import { referralLetterPath } from "@/lib/storage/tenant-path";
import {
  ReferralLetterDocument,
  ReferralPdfPayload,
} from "./referral-letter-document";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

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
  ctx: ServiceContext,
  payload: ReferralPdfPayload
): Promise<GenerateReferralPdfResult> {
  // The letter is always archived under the acting tenant (ADR-0005 D1); a payload for another tenant is refused.
  if (payload.tenant_id !== ctx.tenantId) {
    throw new Error("Referral payload does not belong to the active clinic.");
  }

  // 1. Render React-PDF document to binary buffer server-side
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(ReferralLetterDocument, { payload }) as any;
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  const buffer = await streamToBuffer(stream);

  const supabase = ctx.db;

  // 2. Define deterministic storage path: tenants/${tenant_id}/referrals/${referral_id}/referral_letter.pdf
  const storagePath = referralLetterPath(payload.tenant_id, payload.referral_id);

  // 3. Resolve storage provider bound to the acting user's client
  const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");

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
    log.error({ event: "referrals.pdf_upload.failed", code: errorTag(uploadErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
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
    .eq("tenant_id", ctx.tenantId);

  return {
    signedUrl,
    storagePath,
    buffer,
  };
}
