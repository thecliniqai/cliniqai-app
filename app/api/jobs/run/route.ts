/**
 * POST /api/jobs/run (V2-04 04-02; P0-12, C22, RL-23; rulings R-17, R-18; threat T-04-01): one runner pass.
 *
 * pg_cron calls it every minute through pg_net (`ops.kick_job_runner()`, migrations 000033/000034) with a short-lived
 * token derived from the Vault-held secret; an operator may mint one by hand (docs/runbooks/jobs.md §5). Order:
 *   1. `Authorization: Bearer v1.<unix_ts>.<hmac_sha256(secret, "jobs-run|v1|" + unix_ts)>` with |now − ts| ≤ 120 s and
 *      the HMAC of `JOBS_RUNNER_SECRET` or `JOBS_RUNNER_SECRET_NEXT`, compared in constant time (`lib/jobs/auth.ts`,
 *      R-49); anything else is 401 `{ ok: false }` with no detail, before any body read or database access. No secret
 *      configured (or an environment the schema refuses) authenticates nothing.
 *   2. Body: at most 1 KB of JSON `{ source?: "pg_cron" | "manual" }` (empty = manual); anything else is 400.
 *   3. `runJobs` on the system client (`getSystemDb("jobs.run")`) with `RUN_PASS_CONFIG` (`lib/jobs/internal/run-config.ts`,
 *      04-07b): a 25 s budget, fair batches of 10 (at most 5 per tenant, round-robin), a 120 s lease and a 4 s hard
 *      bound per queue RPC, so a pass ends within 45 s even when every RPC stalls. Lease 120 s ≫ budget 25 s ≫ provider
 *      timeouts (10 s / 5 s); pg_net waits 30 s and the function may run 60 s (Vercel Hobby maximum).
 * The response is counts only: `{ ok, claimed, done, retried, dead, durationMs }`. A thrown error is 500 `{ ok: false }`
 * with one `jobs.run.failed` log line carrying the error tag and the request id. Other methods answer 405 with
 * `Allow: POST` and no side effect (no secret in query strings, no GET side effects). `proxy.ts` skips the session
 * refresh for this path (no Supabase Auth round trip every minute) but still assigns the request id.
 */
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deploymentInfo, serverEnv } from "@/lib/env-server";
import { isAuthorisedRunner } from "@/lib/jobs/auth";
import { getJobHandlers } from "@/lib/jobs/internal/registry";
import { RUN_PASS_CONFIG } from "@/lib/jobs/internal/run-config";
import { runJobs } from "@/lib/jobs/internal/runner";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { getSystemDb } from "@/lib/supabase/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1024;

const Body = z.object({ source: z.enum(["pg_cron", "manual"]).optional() }).strict();

const DENIED = { ok: false } as const;

function deny(status: number): NextResponse {
  return NextResponse.json(DENIED, { status, headers: { "cache-control": "no-store" } });
}

/** Reads at most `limit` bytes of the body; `null` when it is longer (the rest is never read). */
async function readBounded(request: NextRequest, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function runnerSecrets(): { current?: string; next?: string } {
  try {
    const env = serverEnv();
    return { current: env.JOBS_RUNNER_SECRET, next: env.JOBS_RUNNER_SECRET_NEXT };
  } catch {
    // An environment the schema refuses authenticates nothing (fail closed).
    return {};
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAuthorisedRunner(request.headers.get("authorization"), runnerSecrets())) return deny(401);

  const raw = await readBounded(request, MAX_BODY_BYTES);
  if (raw === null) return deny(413);
  let source: "pg_cron" | "manual" = "manual";
  if (raw.trim() !== "") {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return deny(400);
    }
    const parsed = Body.safeParse(json);
    if (!parsed.success) return deny(400);
    source = parsed.data.source ?? "manual";
  }

  try {
    const handlers = getJobHandlers();
    const result = await runJobs({
      db: getSystemDb("jobs.run"),
      ...RUN_PASS_CONFIG,
      worker: `${deploymentInfo().region ?? "local"}:${randomBytes(4).toString("hex")}`,
      source,
      kinds: Object.keys(handlers),
      handlers,
    });
    return NextResponse.json(
      {
        ok: result.ok,
        claimed: result.claimed,
        done: result.done,
        retried: result.retried,
        dead: result.dead,
        durationMs: result.durationMs,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    log.error({ event: "jobs.run.failed", code: errorTag(err), requestId: await getRequestId() });
    return deny(500);
  }
}

function methodNotAllowed(): Response {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}
export async function PUT(): Promise<Response> {
  return methodNotAllowed();
}
export async function PATCH(): Promise<Response> {
  return methodNotAllowed();
}
export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
