import { NextResponse } from "next/server";
import { deploymentInfo } from "@/lib/env-server";

/**
 * Liveness probe (D-18). Answers 200 without touching the database or any provider. V2-03 03-01: also reports where
 * and what is running: `region` (Vercel's VERCEL_REGION, the FT-01 `bom1` proof, R-30) and `release` (the deployed
 * commit SHA, which staging.yml waits for, R-26). Both are null when the platform does not set them (local, CI).
 */
export async function GET() {
  const { region, release } = deploymentInfo();
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      region,
      release,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
