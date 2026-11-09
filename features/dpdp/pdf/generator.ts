import React from "react";
import { pdf } from "@react-pdf/renderer";
import { MedicalSummaryDocument } from "./medical-summary-doc";
import type { DpdpExportBundle } from "../export";

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
 * Compiles a comprehensive clinic-branded Medical Summary PDF server-side
 * using @react-pdf/renderer under the DPDP Act 2023 Right to Access.
 * Returns binary Node Buffer without writing to disk.
 */
export async function generateDpdpMedicalSummaryPdf(
  bundle: DpdpExportBundle
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(MedicalSummaryDocument, { payload: bundle }) as any;
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  return streamToBuffer(stream);
}
