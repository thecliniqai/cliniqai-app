import "server-only";

import React from "react";
import { createHash } from "node:crypto";
import { pdf } from "@react-pdf/renderer";
import { recordAudit } from "@/lib/audit/audit";
import type { ServiceContext } from "@/lib/auth/context";
import { downloadFile, getStorageProviderForDb, uploadFile } from "@/lib/storage";
import { recordState } from "@/features/consultation/record-state";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { PrescriptionDocument, PrescriptionPdfPayload } from "./prescription-document";
import type { PrescriptionPdfSource } from "./payload";

/**
 * Prescription PDFs (V2-09a 09A-03, R-12; 09A-06a ruling R-A). Three pieces, none of which overwrites anything:
 *
 *  - `renderPrescriptionPdf(payload)`: pure, no storage;
 *  - `archivePrescriptionPdf(ctx, payload, buffer?)`: the one archive of a signed version. SHA-256 of the exact bytes, upload `upsert: false` to the
 *    canonical key `<tenant>/<visit>/rx_v<version>.pdf` (the key shape of 000058, 000022's `share_object_path` and the `prescriptions_pdf_storage_path_shape`
 *    CHECK), then the write-once pair `pdf_storage_path` + `pdf_sha256` on the header. The database refuses everything else: an archive of a draft or of an
 *    open amendment, a second object at the key, a second hash (migration 000109, storage policy `prescriptions_rx_insert`);
 *  - `readArchivedPrescriptionPdf(ctx, header, renderFresh)`: downloads the object and compares its SHA-256 with the stored one; on a mismatch it never
 *    returns the stored bytes.
 *
 * `resolvePrescriptionPdf` is the policy every reader shares (the PDF route and the in-app preview): a sealed header at its own letterhead is served from
 * the archive; a draft, an open amendment and a print variant (another letterhead) are rendered on demand and never stored. The hash gives integrity
 * after archive, not authenticity of origin (no digital signature).
 *
 * Ruling R-A (09A-06a, migration 000111): only the doctor who signed the visit archives its Rx. The database refuses anyone else's object and pair, and
 * an object at the key that the signer did not store is never adopted (the incident is audited). A missing archive therefore self-heals only when the
 * signer opens the record; every other reader of a sealed Rx without a verified archive gets an on-demand render that carries a visible
 * "Regenerated copy" line (review S-8) and is never stored.
 */

const RX_BUCKET = "prescriptions";

/** Printed on an on-demand render served in place of a missing or failed archive (review S-8): the bytes are not the archived signed document. */
export const REGENERATED_COPY_NOTICE = "Regenerated copy, not the archived original";

/** Converts a Node ReadableStream or raw buffer into a single Buffer. */
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

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The object key of a signed version (the one shape the storage policy, `share_object_path` and the database guard accept). */
export function prescriptionPdfPath(tenantId: string, visitId: string, version: number): string {
  return `${tenantId}/${visitId}/rx_v${version}.pdf`;
}

/** Compiles an electronic prescription into an A4 PDF on the server. Pure: nothing is stored. A payload with `regenerated_notice` prints that line. */
export async function renderPrescriptionPdf(payload: PrescriptionPdfPayload): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(PrescriptionDocument, { payload }) as any;
  const stream = await pdf(doc).toBuffer();
  return streamToBuffer(stream);
}

export interface ArchivedPrescriptionPdf {
  /**
   * `archived`: uploaded and recorded now; `adopted`: the object already existed with no hash, the signer had stored it (an earlier archive stopped
   * before its record), and it was recorded; `already_archived`: nothing to do.
   */
  status: "archived" | "adopted" | "already_archived";
  storagePath: string;
  sha256: string;
  /** The archived bytes; absent for `already_archived`. */
  buffer?: Buffer;
}

/** The storage error behind the provider's fixed-message wrapper (the original error is on `cause`). */
function storageCause(err: unknown): { statusCode?: unknown; status?: unknown; error?: unknown; message?: unknown; originalError?: { status?: unknown } } | null {
  return (err as { cause?: never } | null)?.cause ?? null;
}

/** A download whose object does not exist (404, or the 400 "not found" some Storage versions answer), as opposed to a transient failure. */
export function isMissingObjectError(err: unknown): boolean {
  const cause = storageCause(err);
  if (!cause) return false;
  const status = String(cause.statusCode ?? cause.status ?? cause.originalError?.status ?? "");
  if (status === "404") return true;
  return /not[ _]?found/i.test(`${String(cause.error ?? "")} ${String(cause.message ?? "")}`) || (status === "400" && !cause.message);
}

/** The Storage API's "object already exists" (409), through the provider's fixed-message wrapper (the original error is on `cause`). */
function isDuplicateObjectError(err: unknown): boolean {
  const cause = (err as { cause?: { statusCode?: unknown; status?: unknown; error?: unknown; message?: unknown } } | null)?.cause;
  if (!cause) return false;
  if (String(cause.statusCode ?? cause.status ?? "") === "409") return true;
  return /already exists|duplicate/i.test(`${String(cause.error ?? "")} ${String(cause.message ?? "")}`);
}

interface HeaderRow {
  id: string;
  visit_id: string;
  version: number;
  letterhead_mode: string;
  signed_at: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
}

async function readHeader(ctx: ServiceContext, prescriptionId: string): Promise<HeaderRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (ctx.db.from("prescriptions") as any)
    .select("id, visit_id, version, letterhead_mode, signed_at, pdf_storage_path, pdf_sha256")
    .eq("id", prescriptionId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  return data ? { ...data, version: Number(data.version) } : null;
}

/**
 * Archives the signed version once (see the file header). Idempotent: a header that already has its hash is left alone and nothing is rendered or
 * uploaded. A duplicate object is adopted (downloaded, hashed, recorded) only while the header has no hash AND only when the signer stored it: the
 * database refuses the pair otherwise (RX_PDF_OBJECT_INVALID, 000111), and the planted object is audited as an integrity incident, never recorded.
 * The caller must be the visit's signer (R-A); the database refuses anyone else. Throws with a fixed message when the archive cannot be completed (the
 * record is already signed; callers treat it as best-effort and the signer's next open archives it, R-12).
 */
export async function archivePrescriptionPdf(
  ctx: ServiceContext,
  payload: PrescriptionPdfPayload,
  buffer?: Buffer
): Promise<ArchivedPrescriptionPdf> {
  // The archive is always written under the acting tenant (ADR-0005 D1); a payload for another tenant is refused.
  if (payload.tenant_id !== ctx.tenantId) {
    throw new Error("Prescription payload does not belong to the active clinic.");
  }
  if (!payload.prescription_id) {
    throw new Error("There is no prescription to archive.");
  }
  const header = await readHeader(ctx, payload.prescription_id);
  if (!header || header.visit_id !== payload.visit_id || header.version !== payload.version) {
    throw new Error("The prescription changed before its PDF could be archived.");
  }
  const storagePath = prescriptionPdfPath(ctx.tenantId, header.visit_id, header.version);
  if (header.pdf_sha256) {
    return { status: "already_archived", storagePath: header.pdf_storage_path ?? storagePath, sha256: header.pdf_sha256 };
  }
  // Only the canonical rendering is archived: a print variant (another letterhead) is rendered on demand (Q-7).
  if (payload.letterhead_mode !== header.letterhead_mode) {
    throw new Error("Only the canonical rendering of a prescription is archived.");
  }

  const provider = getStorageProviderForDb(ctx.db, RX_BUCKET);
  let bytes = buffer ?? (await renderPrescriptionPdf(payload));
  let status: "archived" | "adopted" = "archived";
  try {
    await uploadFile({ path: storagePath, buffer: bytes, contentType: "application/pdf", bucket: RX_BUCKET, upsert: false }, provider);
  } catch (uploadErr) {
    if (!isDuplicateObjectError(uploadErr)) {
      log.error({ event: "prescriptions.pdf_upload.failed", code: errorTag(uploadErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      // Fixed text: the storage error names the object key (03-13d M-ERRMSG); the cause stays server-side.
      throw new Error("Failed to upload prescription PDF to storage.", { cause: uploadErr });
    }
    // The object exists and the header has no hash: an earlier archive stopped between the upload and the record, or a concurrent archiver won the
    // race. The bytes that are stored are the ones to record; ours are dropped (an object is never overwritten).
    try {
      bytes = await downloadFile({ path: storagePath, bucket: RX_BUCKET }, provider);
    } catch (readErr) {
      log.error({ event: "prescriptions.pdf_adopt.failed", code: errorTag(readErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      throw new Error("Failed to read the existing prescription PDF.", { cause: readErr });
    }
    status = "adopted";
  }

  const sha256 = sha256Hex(bytes);
  // The write-once pair: only while no hash is recorded (a concurrent archiver that got there first leaves this UPDATE with no row).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: written, error: recordErr } = await (ctx.db.from("prescriptions") as any)
    .update({ pdf_storage_path: storagePath, pdf_sha256: sha256, updated_at: new Date().toISOString() })
    .eq("id", header.id)
    .eq("tenant_id", ctx.tenantId)
    .is("pdf_sha256", null)
    .select("id");
  if (recordErr) {
    if (status === "adopted" && (recordErr as { message?: string }).message === "RX_PDF_OBJECT_INVALID") {
      // 000111 (R-A): the object at the key was not stored by the signer (planted by another member before 000111, or by the service role or a storage
      // admin). It is never adopted: the incident is audited (the hash of what is there, no PHI) and every reader gets a regenerated copy.
      log.error({ event: "prescriptions.pdf_integrity_failed", code: "FOREIGN_OBJECT", requestId: await getRequestId(), tenantId: ctx.tenantId });
      await auditIntegrityFailure(ctx, { id: header.id, version: header.version, storagePath, sha256, reason: "FOREIGN_OBJECT" });
      throw new Error("The stored prescription PDF was not written by the signing doctor.", { cause: recordErr });
    }
    log.error({ event: "prescriptions.pdf_record.failed", code: errorTag(recordErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    throw new Error("Failed to record the prescription PDF archive.", { cause: recordErr });
  }
  if (!Array.isArray(written) || written.length === 0) {
    const current = await readHeader(ctx, header.id);
    if (current?.pdf_sha256) {
      return { status: "already_archived", storagePath: current.pdf_storage_path ?? storagePath, sha256: current.pdf_sha256 };
    }
    throw new Error("Failed to record the prescription PDF archive.");
  }

  // The compliance trail (AGENTS.md §9, §10): the hash is not PHI.
  try {
    await recordAudit(ctx, {
      action: "prescription.generate_pdf",
      entityType: "prescription",
      entityId: header.id,
      metadata: { version: header.version, letterhead_mode: header.letterhead_mode, storage_path: storagePath, sha256 },
    });
  } catch (auditErr) {
    log.warn({ event: "prescriptions.pdf_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }

  return { status, storagePath, sha256, buffer: bytes };
}

export interface ArchivedHeader {
  id: string;
  version: number;
  pdf_storage_path: string;
  pdf_sha256: string;
}

export interface ReadArchivedPrescriptionPdf {
  buffer: Buffer;
  /** true: the stored bytes matched the recorded SHA-256. false: they did not, or could not be read; `buffer` is then a regenerated render of the sealed rows. */
  verified: boolean;
  /** Why the archive was not served: HASH_MISMATCH (tampering: audited), OBJECT_MISSING or READ_FAILED (not audited as tampering, review A-6). */
  failure?: "HASH_MISMATCH" | "OBJECT_MISSING" | "READ_FAILED";
}

async function auditIntegrityFailure(
  ctx: ServiceContext,
  row: { id: string; version: number; storagePath: string; sha256: string; reason: "HASH_MISMATCH" | "FOREIGN_OBJECT" }
): Promise<void> {
  try {
    await recordAudit(ctx, {
      action: "prescription.pdf_integrity_failed",
      entityType: "prescription",
      entityId: row.id,
      metadata: { version: row.version, sha256: row.sha256, storage_path: row.storagePath, reason: row.reason },
    });
  } catch (auditErr) {
    log.warn({ event: "prescriptions.pdf_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }
}

/**
 * Reads an archived Rx PDF and checks it against the recorded SHA-256. The stored bytes are returned only when the hash matches. Otherwise the
 * regenerated render (`renderFresh`, which carries the S-8 notice) is returned: a hash mismatch is an integrity failure (logged by tag and audited as
 * `prescription.pdf_integrity_failed`); a missing object or a failed read is not tampering (review A-6): a warn log and no audit row.
 */
export async function readArchivedPrescriptionPdf(
  ctx: ServiceContext,
  header: ArchivedHeader,
  renderFresh: () => Promise<Buffer>
): Promise<ReadArchivedPrescriptionPdf> {
  let stored: Buffer;
  try {
    stored = await downloadFile({ path: header.pdf_storage_path, bucket: RX_BUCKET }, getStorageProviderForDb(ctx.db, RX_BUCKET));
  } catch (readErr) {
    const failure = isMissingObjectError(readErr) ? "OBJECT_MISSING" : "READ_FAILED";
    log.warn({ event: "prescriptions.pdf_archive_read.failed", code: failure, requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { buffer: await renderFresh(), verified: false, failure };
  }
  if (sha256Hex(stored) === header.pdf_sha256) {
    return { buffer: stored, verified: true };
  }
  log.error({ event: "prescriptions.pdf_integrity_failed", code: "HASH_MISMATCH", requestId: await getRequestId(), tenantId: ctx.tenantId });
  await auditIntegrityFailure(ctx, { id: header.id, version: header.version, storagePath: header.pdf_storage_path, sha256: header.pdf_sha256, reason: "HASH_MISMATCH" });
  return { buffer: await renderFresh(), verified: false, failure: "HASH_MISMATCH" };
}

/** True when the caller is the doctor who signed the visit: the only one who may archive its Rx (ruling R-A, migration 000111). */
export function isVisitSigner(ctx: ServiceContext, source: PrescriptionPdfSource): boolean {
  return ctx.actorType !== "api_key" && Boolean(source.visit.signed_by) && source.visit.signed_by === ctx.userId;
}

/**
 * True when the rendering this source describes is the one that is archived: a signed header of a sealed visit (signed, not reopened) at the header's own
 * letterhead, whose recorded path (if any) is this version's canonical key. Everything else is rendered on demand and never stored.
 */
export function isArchivable(ctx: ServiceContext, source: PrescriptionPdfSource): boolean {
  const { payload, header, visit } = source;
  if (!header || recordState(visit) !== "sealed" || !header.signed_at || payload.letterhead_mode !== header.letterhead_mode) return false;
  // A legacy path that is not this version's key cannot be adopted (the pair is write-once and canonical).
  return !header.pdf_storage_path || header.pdf_storage_path === prescriptionPdfPath(ctx.tenantId, payload.visit_id, header.version);
}

export interface ServedPrescriptionPdf {
  buffer: Buffer;
  /** The archived object's key when the bytes come from (or were just written to) the archive and matched its hash; else null (rendered on demand). */
  storagePath: string | null;
  /** true: matched the recorded hash. false: the archive failed its check and a regenerated copy is served. null: nothing was compared (rendered on demand, or archived now). */
  verified: boolean | null;
  /** true: an on-demand render served in place of a missing or failed archive; it prints the "Regenerated copy" notice (review S-8). */
  regenerated: boolean;
  version: number;
}

/**
 * What a reader gets for a prescription (R-12, ruling R-A). A sealed header (signed visit, not reopened) at its own letterhead is served from the archive
 * and verified against its hash. Its signer self-heals a missing archive (archived now; a recorded pair whose object is gone is cleared first, review
 * S-3); anyone else, a legacy path with no hash, an archive that fails its check and an archive that cannot be written get a regenerated copy (S-8),
 * never stored. A draft, an open amendment, a print variant and a header with no signature are rendered on demand from the current rows (no notice:
 * they are not in place of an archive) and never stored.
 */
export async function resolvePrescriptionPdf(ctx: ServiceContext, source: PrescriptionPdfSource): Promise<ServedPrescriptionPdf> {
  const { payload, header } = source;
  const version = payload.version;
  const renderNow = () => renderPrescriptionPdf(payload);
  const renderRegenerated = () => renderPrescriptionPdf({ ...payload, regenerated_notice: REGENERATED_COPY_NOTICE });
  const onDemand = async (): Promise<ServedPrescriptionPdf> => ({ buffer: await renderNow(), storagePath: null, verified: null, regenerated: false, version });
  const regenerated = async (verified: boolean | null): Promise<ServedPrescriptionPdf> => ({
    buffer: await renderRegenerated(),
    storagePath: null,
    verified,
    regenerated: true,
    version,
  });

  if (!header || !isArchivable(ctx, source)) {
    return onDemand();
  }
  const signer = isVisitSigner(ctx, source);

  if (header.pdf_sha256 && header.pdf_storage_path) {
    const read = await readArchivedPrescriptionPdf(
      ctx,
      { id: header.id, version: header.version, pdf_storage_path: header.pdf_storage_path, pdf_sha256: header.pdf_sha256 },
      renderRegenerated
    );
    if (read.verified) {
      return { buffer: read.buffer, storagePath: header.pdf_storage_path, verified: true, regenerated: false, version };
    }
    if (read.failure !== "OBJECT_MISSING" || !signer) {
      return { buffer: read.buffer, storagePath: null, verified: false, regenerated: true, version };
    }
    // S-3: the signer's archive is gone. The signer (and only the signer, the database checks it and that the object is missing) clears the broken pair,
    // then archives again below.
    if (!(await clearMissingArchivePair(ctx, header.id, header.pdf_sha256))) {
      return { buffer: read.buffer, storagePath: null, verified: false, regenerated: true, version };
    }
  } else if (header.pdf_storage_path) {
    // A legacy path with no recorded hash (pre-000109 rows only, PO-15): never trusted and never recorded (review S-2 (c)).
    return regenerated(null);
  }

  if (!signer) {
    // R-A: only the signer archives; everyone else gets a regenerated copy until the signer opens the record.
    return regenerated(null);
  }
  try {
    const archived = await archivePrescriptionPdf(ctx, payload);
    if (archived.buffer) {
      return { buffer: archived.buffer, storagePath: archived.storagePath, verified: null, regenerated: false, version };
    }
    // A concurrent archiver recorded it between our read and our write: read theirs, verified.
    const read = await readArchivedPrescriptionPdf(
      ctx,
      { id: header.id, version: header.version, pdf_storage_path: archived.storagePath, pdf_sha256: archived.sha256 },
      renderRegenerated
    );
    return { buffer: read.buffer, storagePath: read.verified ? archived.storagePath : null, verified: read.verified, regenerated: !read.verified, version };
  } catch (archiveErr) {
    // The record is signed whatever happens here: serve a regenerated copy and let the signer's next open try again.
    log.warn({ event: "prescriptions.pdf_self_heal.failed", code: errorTag(archiveErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return regenerated(null);
  }
}

/** S-3: clears a recorded pair whose object is missing (the database admits it only for the signer and only when the object is gone). */
async function clearMissingArchivePair(ctx: ServiceContext, prescriptionId: string, sha256: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("prescriptions") as any)
    .update({ pdf_storage_path: null, pdf_sha256: null, updated_at: new Date().toISOString() })
    .eq("id", prescriptionId)
    .eq("tenant_id", ctx.tenantId)
    .eq("pdf_sha256", sha256)
    .select("id");
  if (error || !Array.isArray(data) || data.length !== 1) {
    log.warn({ event: "prescriptions.pdf_pair_clear.failed", code: errorTag(error ?? "ROW_NOT_AFFECTED"), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return false;
  }
  log.warn({ event: "prescriptions.pdf_pair_cleared", code: "OBJECT_MISSING", requestId: await getRequestId(), tenantId: ctx.tenantId });
  return true;
}
