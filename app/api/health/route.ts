import { NextResponse } from "next/server";

/**
 * Rapid liveness probe per D-18.
 * Returns HTTP 200 for health checks without querying external dependencies.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
