import { NextResponse } from "next/server";
import { generateOpenApiSpec } from "@/lib/api/openapi-spec";

/**
 * Public OpenAPI 3.0 JSON specification endpoint per D-07.
 * Cached for 1 hour; does not expose internal secrets or database connection strings.
 */
export async function GET() {
  const spec = generateOpenApiSpec();
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
