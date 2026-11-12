import { NextRequest, NextResponse } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { DPDP_EXPORT_PERMISSION, exportPatientDpdpArchive } from "@/features/dpdp/export";
import { generateDpdpMedicalSummaryPdf } from "@/features/dpdp/pdf/generator";
import { recordAudit } from "@/lib/audit/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/patients/[id]/export?format=json|pdf: the in-app DPDP Right to Access export for clinic staff
 * (components/patients/dpdp-export-actions.tsx). Ruling 01-09: this legal-rights feature must not depend on the
 * public `/api/v1` switch (default off), so it lives here and authenticates from the session cookie only.
 * - Session → `resolveServiceContext("exports:create")` (DPDP_EXPORT_PERMISSION, the permission
 *   `exportPatientDpdpArchive` asserts for staff; owner only today, ruling 01-09); the tenant comes from the session,
 *   reads run on the user's own JWT client (RLS applies). No service-role client.
 * - 401 unauthenticated, 403 without the permission, 404 for a patient outside the caller's tenant (or a non-UUID
 *   id). Error bodies are fixed strings; nothing from the database reaches the caller.
 * Same formats and headers as the `/api/v1` export (which stays on the API-key path, behind the switch).
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServiceContext(DPDP_EXPORT_PERMISSION);
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (resolved.reason === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 500 });
  }
  const ctx = resolved.ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "json";

  let bundle: Awaited<ReturnType<typeof exportPatientDpdpArchive>>;
  try {
    bundle = await exportPatientDpdpArchive(ctx, id, { format, skipAudit: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("Patient not found")) {
      return NextResponse.json({ error: "Patient not found." }, { status: 404 });
    }
    console.error("[app/api/patients/[id]/export] export failed:", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }

  if (format === "pdf") {
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateDpdpMedicalSummaryPdf(bundle);
    } catch (err) {
      console.error("[app/api/patients/[id]/export] PDF render failed:", err instanceof Error ? err.name : "error");
      return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
    }
    try {
      await recordAudit(ctx, {
        action: "dpdp.data_export",
        entityType: "patient",
        entityId: id,
        metadata: { format: "pdf", status: "completed" },
      });
    } catch (auditErr) {
      console.warn("[app/api/patients/[id]/export] PDF audit warning:", auditErr instanceof Error ? auditErr.name : "error");
    }
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="medical-summary-${id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="patient-dpdp-export-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
