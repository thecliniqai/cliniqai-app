import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { requirePermission } from "@/lib/permissions/guards";
import { getAdminClient } from "@/lib/supabase/admin";
import { exportPatientDpdpArchive } from "@/features/dpdp/export";
import { generateDpdpMedicalSummaryPdf } from "@/features/dpdp/pdf/generator";
import { recordAuditLegacy } from "@/lib/audit/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/patients/[id]/export
 * Generates DPDP Right to Access dual-format data export:
 * - format=json: Structured machine-readable JSON archive including billing records
 * - format=pdf: Publication-grade clinical Medical Summary PDF
 * Supports either API key Bearer auth or authenticated staff cookie session with patients:view.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const authHeader = req.headers.get("authorization");

  let session: {
    tenantId: string;
    userId: string;
    role?: string;
    actorType: "user" | "api_key";
    apiKeyId?: string;
  };

  let rateHeaders: Record<string, string> = {};

  if (authHeader && authHeader.startsWith("Bearer ")) {
    // 1a. Bearer token authentication
    const auth = await authenticateApiKey(req);
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

    session = {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      role: auth.session.role,
      actorType: "api_key",
      apiKeyId: auth.session.apiKeyId,
    };
  } else {
    // 1b. Cookie session authentication with patients:view guard
    try {
      const guarded = await requirePermission(undefined, "patients:view");
      session = {
        tenantId: guarded.tenantId,
        userId: guarded.userId,
        role: guarded.role,
        actorType: "user",
      };
    } catch {
      return apiError(
        "UNAUTHORIZED",
        "Authentication required via Bearer API key or staff session with patients:view permission.",
        401
      );
    }
  }

  const format = req.nextUrl.searchParams.get("format") || "json";
  const admin = getAdminClient();

  try {
    const bundle = await exportPatientDpdpArchive(
      id,
      session.tenantId,
      { format: format === "pdf" ? "pdf" : "json", skipAudit: false },
      admin,
      session
    );

    if (format === "pdf") {
      const pdfBuffer = await generateDpdpMedicalSummaryPdf(bundle);

      // Record audit log for PDF compilation
      try {
        await recordAuditLegacy(
          {
            action: "dpdp.data_export",
            entityType: "patient",
            entityId: id,
            actorType: session.actorType,
            apiKeyId: session.apiKeyId,
            metadata: {
              format: "pdf",
              status: "completed",
            },
          },
          admin,
          session
        );
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
