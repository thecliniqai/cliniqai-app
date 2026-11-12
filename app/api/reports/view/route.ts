import { NextRequest, NextResponse } from "next/server";
import { isPlausibleToken, REPORT_LINK_KINDS, resolveShareToken } from "@/features/sharing/public-links";
import { signSharedObject } from "@/features/sharing/system";

// Public lab-report link (P0-04, ADR-0005 D3): patient_document tokens only, resolved by `resolve_share_token`
// (bound to the token's tenant). Every "no such link" answer is the same 404; the response carries no ids.

const NOT_FOUND_MESSAGE =
  "This document link has expired or is invalid. Please contact your clinic for a new link.";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const download = searchParams.get("download") === "true";

    if (!isPlausibleToken(token)) {
      return NextResponse.json({ error: "Invalid or missing token parameter." }, { status: 400 });
    }

    const resolved = await resolveShareToken(token, REPORT_LINK_KINDS);

    if (resolved.status === "revoked") {
      return NextResponse.json(
        { error: "This document link has been revoked. Please contact your clinic for a new link." },
        { status: 410 }
      );
    }
    if (resolved.status === "expired") {
      return NextResponse.json(
        { error: "This document link has expired. Please contact your clinic for a new link." },
        { status: 410 }
      );
    }
    if (resolved.status !== "ok") {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const doc = resolved.document;
    const signed = await signSharedObject(token, REPORT_LINK_KINDS);
    if (!signed) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    if (download) {
      return NextResponse.redirect(signed.signedUrl, { status: 302 });
    }

    return NextResponse.json(
      {
        success: true,
        document: {
          title: doc.title,
          document_type: doc.document_type,
          report_date: doc.report_date,
          original_filename: doc.original_filename,
          file_size_bytes: doc.file_size_bytes ?? null,
          mime_type: doc.mime_type,
          is_abnormal: doc.is_abnormal ?? false,
          notes: doc.notes ?? null,
        },
        clinic: {
          name: doc.clinic?.name ?? "Clinic",
          phone: doc.clinic?.phone ?? null,
          address: doc.clinic?.address ?? null,
          logo_url: doc.clinic?.logo_url ?? null,
        },
        patient_name: doc.patient_name,
        signed_url: signed.signedUrl,
        expires_at: doc.expires_at,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: unknown) {
    console.error("[app/api/reports/view/route] Error resolving token:", err instanceof Error ? err.name : "error");
    return NextResponse.json(
      { error: "An unexpected error occurred while loading this document." },
      { status: 500 }
    );
  }
}
