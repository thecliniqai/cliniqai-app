/**
 * POST /api/diag/error (V2-03 03-09b, ruling R-18; threat T-03-15): throws a deterministic synthetic server error so
 * the error sink can be proven end to end (locally by `tests/e2e/observability/error-sink.spec.ts`, on staging by PO
 * action E9).
 *
 * Order: the `CRON_SECRET` bearer first (constant-time compare; missing or wrong → 401), then the
 * `DIAG_ERROR_ROUTE_ENABLED` flag (off → 404), then the throw. The env schema refuses the flag in production. The error
 * carries only synthetic values (a phone, an email, a Postgres `Key (…)=(…)` detail and a share-style query string)
 * that the scrubber must remove. Other methods answer 405 (Next's default for an unexported method).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env-server";
import { DiagnosticError } from "@/lib/observability/diag-error";

export const dynamic = "force-dynamic";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  // Equal-length digests: `timingSafeEqual` never throws and the secret's length does not leak.
  return timingSafeEqual(sha256(header.slice("Bearer ".length)), sha256(secret));
}

export async function POST(request: NextRequest): Promise<Response> {
  let secret: string | undefined;
  let enabled = false;
  try {
    const env = serverEnv();
    secret = env.CRON_SECRET;
    enabled = env.DIAG_ERROR_ROUTE_ENABLED;
  } catch {
    // An environment the schema refuses authenticates nothing (fail closed).
  }
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!enabled) return new NextResponse(null, { status: 404 });
  throw new DiagnosticError();
}
