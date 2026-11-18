/**
 * Shared helpers for the job queue specs (V2-04 04-01). Every spec works on job kinds unique to its run
 * (`test.<word>_<random letters>`), so specs never see each other's rows, and deletes what it wrote afterwards.
 * Tenants are synthetic rows inserted as the local superuser (`tests/helpers/sql.ts`); the global teardown would also
 * remove them (created during the run), and `ops.jobs` rows go with them (ON DELETE CASCADE).
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { HandlerResult, JobHandler } from "@/lib/jobs/internal/types";
import { publicEnv } from "@/lib/env";
import { z } from "zod";
import { psql } from "../helpers/sql";

/** Lower-case letters only: valid in a job kind and safe to interpolate into SQL. */
export function letters(n = 10): string {
  return Array.from(randomBytes(n), (b) =>
    String.fromCharCode(97 + (b % 26))
  ).join("");
}

/** A job kind no other spec or run uses. */
export function uniqueKind(word: string): string {
  return `test.${word}_${letters()}`;
}

const SAFE = /^[a-z0-9_.:-]+$/;
function safe(value: string): string {
  if (!SAFE.test(value))
    throw new Error(
      "helpers: refusing to interpolate a non-word value into SQL"
    );
  return value;
}

/** Inserts a synthetic tenant and returns its id. */
export function insertTenant(label: string): string {
  if (!/^[a-z0-9 ]+$/.test(label))
    throw new Error("helpers: tenant labels are lower-case words");
  const [id] = psql(
    `insert into public.tenants (name) values ('Jobs spec ${label}') returning id`
  );
  return id;
}

export function deleteTenants(ids: string[]): void {
  if (ids.length === 0) return;
  psql(
    `delete from public.tenants where id in (${ids.map((i) => `'${safe(i)}'`).join(",")})`
  );
}

/**
 * Enqueues `count` jobs of `kind` through `ops.enqueue_job` (as the trigger/definer callers will), with dedupe keys
 * `<kind>:<prefix>:<n>` and run_at `now() - <ageSeconds> + n ms` (so older batches sort first). Returns the ids.
 */
export function enqueueMany(
  kind: string,
  tenantId: string | null,
  count: number,
  opts: { prefix?: string; ageSeconds?: number; maxAttempts?: number } = {}
): string[] {
  const tenant = tenantId ? `'${safe(tenantId)}'::uuid` : "null::uuid";
  const prefix = safe(opts.prefix ?? letters(6));
  return psql(
    `select ops.enqueue_job('${safe(kind)}', ${tenant}, jsonb_build_object('n', g), ` +
      `'${safe(kind)}:${prefix}:' || g, now() - make_interval(secs => ${opts.ageSeconds ?? 60}) + g * interval '1 millisecond', ` +
      `${opts.maxAttempts ?? 5}) from generate_series(1, ${count}) g`
  );
}

export interface JobRow {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

export function jobRows(kind: string): JobRow[] {
  return psql(
    `select id || '|' || status || '|' || attempts || '|' || coalesce(last_error, '') from ops.jobs ` +
      `where kind = '${safe(kind)}' order by run_at, id`
  ).map((line) => {
    const [id, status, attempts, lastError] = line.split("|");
    return {
      id,
      status,
      attempts: Number(attempts),
      lastError: lastError || null,
    };
  });
}

export function deleteJobs(kinds: string[]): void {
  if (kinds.length === 0) return;
  psql(
    `delete from ops.jobs where kind in (${kinds.map((k) => `'${safe(k)}'`).join(",")})`
  );
}

export function deleteRunnerRuns(workerPrefix: string): void {
  psql(
    `delete from ops.job_runner_runs where worker like '${safe(workerPrefix)}%'`
  );
}

/** A client for an API role: anon (publishable key) or a signed-in user's session. */
export function anonClient() {
  return createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

/** A handler that records the id of every job it runs and reports `done`. */
export function recordingHandler(
  seen: string[],
  maxDurationMs = 5000
): JobHandler<unknown> {
  return {
    schema: z.object({ n: z.number().int() }),
    maxDurationMs,
    async run(job): Promise<HandlerResult> {
      seen.push(job.id);
      // Yield so the parallel runners interleave their RPCs.
      await new Promise((r) => setImmediate(r));
      return { outcome: "done" };
    },
  };
}
