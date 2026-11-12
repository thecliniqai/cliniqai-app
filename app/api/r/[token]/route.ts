import { NextRequest, NextResponse } from "next/server";
import { DOCUMENT_LINK_KINDS, isPlausibleToken, resolveShareToken } from "@/features/sharing/public-links";
import { renderSharedReceiptPdf, signSharedObject } from "@/features/sharing/system";

// Public document link (P0-04, ADR-0005 D3). The token is resolved by `resolve_share_token`, bound to the token's
// tenant and to the kinds this route serves; every "no such link" answer is the same 404 (no oracle between a missing
// token, a token of another type and a resource outside the token's tenant). The response carries no ids.

const NOT_FOUND_MESSAGE =
  "This document link is invalid or does not exist. Please contact your clinic for a new link.";

function notFound() {
  return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download") === "true";

    if (!isPlausibleToken(token)) {
      return NextResponse.json({ error: "Invalid or missing token parameter." }, { status: 400 });
    }

    const resolved = await resolveShareToken(token, DOCUMENT_LINK_KINDS);

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
      return notFound();
    }

    const doc = resolved.document;
    const signed = await signSharedObject(token, DOCUMENT_LINK_KINDS);

    if (download) {
      if (signed) {
        return NextResponse.redirect(signed.signedUrl, { status: 302 });
      }
      // No stored object: an invoice receipt can be rendered on demand for the token's tenant.
      if (doc.resource_type === "invoice") {
        const buffer = await renderSharedReceiptPdf(token);
        if (buffer) {
          return new Response(new Uint8Array(buffer), {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `inline; filename="${doc.original_filename.replace(/["\\\r\n]/g, "_")}"`,
              "Cache-Control": "private, no-cache, no-store, must-revalidate",
            },
          });
        }
      }
      return notFound();
    }

    return NextResponse.json(
      {
        success: true,
        resource_type: doc.resource_type,
        document: {
          title: doc.title,
          document_type: doc.document_type,
          original_filename: doc.original_filename,
          mime_type: doc.mime_type,
          report_date: doc.report_date,
        },
        clinic: {
          name: doc.clinic?.name ?? "Clinic",
          phone: doc.clinic?.phone ?? null,
          address: doc.clinic?.address ?? null,
          logo_url: doc.clinic?.logo_url ?? null,
        },
        patient_name: doc.patient_name,
        signed_url: signed?.signedUrl ?? `/api/r/${token}?download=true`,
        expires_at: doc.expires_at,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: unknown) {
    console.error("[app/api/r/[token]/route] Error resolving document share token:", err instanceof Error ? err.name : "error");
    return NextResponse.json(
      { error: "An unexpected error occurred while loading this document." },
      { status: 500 }
    );
  }
}
