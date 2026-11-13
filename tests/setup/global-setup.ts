/**
 * Vitest globalSetup (V2-01a). Runs in the main process, before any worker starts and after all have exited.
 * - Re-checks the local-only guard.
 * - Marks the run start on the local stack's clock; the returned teardown deletes everything the run created
 *   (tests/setup/teardown.ts). It runs after the workers exit, so no in-flight background work races it.
 * - (V2-04 04-02) Sets every pg_cron job inactive for the run and active again in the teardown (tests/setup/cron-pause.ts).
 * Set TEST_KEEP_DATA=1 to keep the run's data for debugging (the local stack is wiped by `npx supabase db reset`).
 */
import path from "node:path";
import { assertLocalTestEnv } from "./test-env";
import { ensureLocalErrorIngestKey } from "./error-sink-key";
import { pauseCronJobs, resumeCronJobs } from "./cron-pause";
import { releaseRunLock, startRun, teardownRun } from "./teardown";

const ROOT = path.resolve(__dirname, "../..");

export default async function setup(): Promise<() => Promise<void>> {
  assertLocalTestEnv();
  // V2-03 03-09b: the local vault secret the error sink checks the synthetic ingest key against.
  ensureLocalErrorIngestKey(ROOT);
  const marker = await startRun(ROOT);
  // V2-04 04-02: no pg_cron reap or kick races a spec; specs call the SQL functions directly.
  try {
    pauseCronJobs(ROOT);
  } catch (error) {
    releaseRunLock(marker.lockFile);
    throw error;
  }

  return async () => {
    try {
      if (process.env.TEST_KEEP_DATA === "1") {
        console.warn(`[teardown] TEST_KEEP_DATA=1: keeping data created since ${marker.startedAt}`);
        return;
      }
      const report = await teardownRun(ROOT, marker);
      console.log(
        `[teardown] removed run data: ${report.tenants} tenant(s), ${report.users} auth user(s), ` +
          `${report.storageObjects} storage object(s); verified none remain`,
      );
    } finally {
      try {
        resumeCronJobs(ROOT);
      } finally {
        releaseRunLock(marker.lockFile);
      }
    }
  };
}
