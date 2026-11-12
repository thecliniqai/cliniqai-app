import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext, apiV1NotFound } from "@/lib/api/auth";
import { apiV1Enabled } from "@/lib/api/enabled";
import { apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { requireServiceContext, type ServiceContext } from "@/lib/auth/context";
import { getSystemDb } from "@/lib/supabase/system";
import { DPDP_EXPORT_PERMISSION, exportPatientDpdpArchive } from "@/features/dpdp/export";
import { generateDpdpMedicalSummaryPdf } from "@/features/dpdp/pdf/generator";
import { recordAudit } from "@/lib/audit/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/patients/[id]/export
 * Generates DPDP Right to Access dual-format data export:
 * - format=json: Structured machine-readable JSON archive including billing records
 * - format=pdf: Publication-grade clinical Medical Summary PDF
 * Supports either API key Bearer auth (register path, ADR-0005; the key principal keeps patients:view, see
 * `dpdpExportPermission`) or an authenticated staff cookie session with exports:create (ruling 01-09). A staff session reads with its own user-JWT client (RLS applies); only the API key path uses the
 * service-role client, and in both cases the tenant and actor come from the verified credential.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  // Off with the `/api/v1` switch on both auth paths (AR2-H2: checked here as well as in the middleware).
  if (!apiV1Enabled()) return apiV1NotFound();
  const { id } = await params;
  const authHeader = req.headers.get("authorization");

  let ctx: ServiceContext;

  let rateHeaders: Record<string, string> = {};

  if (authHeader && authHeader.startsWith("Bearer ")) {
    // 1a. Bearer token authentication
    const admin = getSystemDb("api_v1");
    const auth = await authenticateApiKey(admin, req);
    if (!auth.success) {
      return auth.response;
    }

    const rateLimit = checkRateLimit(auth.session.apiKeyId);
    rateHeaders = getRateLimitHeaders(rateLimit);

    if (!rateLimit.allowed) {
      return apiError(
        "RATE_LIMIT_EXCEEDED",
        "Rate limit of 120 requests per minute exceeded.",
        429,
        undefined,
        rateHeaders
      );
    }

    ctx = apiKeyServiceContext(auth.session, admin);
  } else {
    // 1b. Cookie session authentication: same staff permission as the in-app export route (ruling 01-09)
    try {
      ctx = await requireServiceContext(DPDP_EXPORT_PERMISSION);
    } catch {
      return apiError(
        "UNAUTHORIZED",
        "Authentication required via Bearer API key or staff session with exports:create permission.",
        401
      );
    }
  }

  const format = req.nextUrl.searchParams.get("format") || "json";
  try {
    const bundle = await exportPatientDpdpArchive(ctx, id, {
      format: format === "pdf" ? "pdf" : "json",
      skipAudit: false,
    });

    if (format === "pdf") {
      const pdfBuffer = await generateDpdpMedicalSummaryPdf(bundle);

      // Record audit log for PDF compilation
      try {
        await recordAudit(ctx, {
          action: "dpdp.data_export",
          entityType: "patient",
          entityId: id,
          metadata: {
            format: "pdf",
            status: "completed",
          },
        });
      } catch (auditErr) {
        console.warn("[app/api/v1/patients/[id]/export] PDF audit warning:", auditErr);
      }

      const uint8 = new Uint8Array(pdfBuffer);
      return new Response(uint8, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="medical-summary-${id}.pdf"`,
          ...rateHeaders,
        },
      });
    }

    // Default: JSON export
    const jsonString = JSON.stringify(bundle, null, 2);
    return new Response(jsonString, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="patient-dpdp-export-${id}.json"`,
        ...rateHeaders,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found") || message.includes("unauthorized")) {
      return apiError("NOT_FOUND", "Patient not found or unauthorized.", 404, undefined, rateHeaders);
    }
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
