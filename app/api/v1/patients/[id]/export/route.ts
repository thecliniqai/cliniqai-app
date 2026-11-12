import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { requireServiceContext, type ServiceContext } from "@/lib/auth/context";
import { getAdminClient } from "@/lib/supabase/admin";
import { exportPatientDpdpArchive } from "@/features/dpdp/export";
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
 * Supports either API key Bearer auth (register path, ADR-0005) or an authenticated staff cookie session with
 * patients:view. A staff session reads with its own user-JWT client (RLS applies); only the API key path uses the
 * service-role client, and in both cases the tenant and actor come from the verified credential.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const authHeader = req.headers.get("authorization");

  let ctx: ServiceContext;

  let rateHeaders: Record<string, string> = {};

  if (authHeader && authHeader.startsWith("Bearer ")) {
    // 1a. Bearer token authentication
    const admin = getAdminClient();
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
    // 1b. Cookie session authentication with patients:view guard
    try {
      ctx = await requireServiceContext("patients:view");
    } catch {
      return apiError(
        "UNAUTHORIZED",
        "Authentication required via Bearer API key or staff session with patients:view permission.",
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
