import { NextResponse } from "next/server";
import { generateOpenApiSpec } from "@/lib/api/openapi-spec";
import { apiV1Enabled } from "@/lib/api/enabled";
import { apiV1NotFound } from "@/lib/api/auth";

/**
 * Public OpenAPI 3.0 JSON specification endpoint per D-07.
 * Cached for 1 hour; does not expose internal secrets or database connection strings.
 * Off with the `/api/v1` switch (AR2-H2: checked here as well as in the middleware).
 */
export async function GET() {
  if (!apiV1Enabled()) return apiV1NotFound();
  const spec = generateOpenApiSpec();
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
