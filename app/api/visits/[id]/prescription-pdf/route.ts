import { NextResponse } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { resolvePrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import { loadPrescriptionPdfSource } from "@/features/prescriptions/pdf/payload";
import { rxFileName } from "@/features/prescriptions/pdf/content";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: visitId } = await params;

    // 1-2. Authenticate, check the same permission as the in-app prescription preview (getPrescriptionPdfSignedUrl;
    // prescriptions:view since V2-05 05-02b, the prescriptions RLS key: nurses, admins and the front desk do not read Rx)
    // and resolve the tenant membership server-side (session only, never caller input) — V2-01 F3
    const resolved = await resolveServiceContext("prescriptions:view");
    if (!resolved.ok) {
      if (resolved.reason === "unauthenticated") {
        return new NextResponse("Unauthorized", { status: 401 });
      }
      if (resolved.reason === "forbidden") {
        return new NextResponse("Forbidden", { status: 403 });
      }
      // 06-09d: Supabase Auth could not answer: 503, never 401 (no sign-out during an Auth incident).
      if (resolved.reason === "unavailable") {
        return new NextResponse(CONTEXT_FAILURE_MESSAGE, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      return new NextResponse(CONTEXT_FAILURE_MESSAGE, { status: 500 });
    }
    const ctx = resolved.ctx;

    // 3. The letterhead and the paper: a print variant is rendered on demand and never archived (V2-09a R-12, Q-7; V2-09c R-11); without them the header's own
    // letterhead mode and paper size apply (frozen at its creation).
    const { searchParams } = new URL(request.url);
    const requestedLetterhead = searchParams.get("letterhead");
    const requestedPaper = searchParams.get("paper");
    const isDownload = searchParams.get("download") === "true";

    // 4. Load the visit's prescription under strict tenant isolation (the caller's own client; RLS applies). One builder for every reader.
    const source = await loadPrescriptionPdfSource(ctx, visitId, {
      letterhead:
        requestedLetterhead === "preprinted_letterhead" || requestedLetterhead === "blank_paper" ? requestedLetterhead : undefined,
      paper: requestedPaper === "A4" || requestedPaper === "A5" ? requestedPaper : undefined,
    });
    if (!source) {
      return new NextResponse("Visit not found or access denied", { status: 404 });
    }

    // 5. A sealed prescription is served from the write-once archive after its SHA-256 is checked (archived first when it is missing); a draft, an open
    // amendment or a print variant is rendered on demand. A mismatch serves a fresh render, never the stored bytes (R-12).
    const served = await resolvePrescriptionPdf(ctx, source);

    // The file name carries the visit's date and the version, never the patient's name (it travels in downloads, share sheets and mail; PWA D-7).
    const filename = rxFileName(source.payload);
    const disposition = isDownload
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    return new Response(new Uint8Array(served.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    // Fixed body; only the error name is logged (IR-L2).
    log.error({ event: "prescriptions.pdf_route.failed", code: errorTag(err), requestId: await getRequestId() });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
