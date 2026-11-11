/**
 * Vitest globalSetup (V2-01a). Runs in the main process, before any worker starts and after all have exited.
 * - Re-checks the local-only guard.
 * - Marks the run start on the local stack's clock; the returned teardown deletes everything the run created
 *   (tests/setup/teardown.ts). It runs after the workers exit, so no in-flight background work races it.
 * Set TEST_KEEP_DATA=1 to keep the run's data for debugging (the local stack is wiped by `npx supabase db reset`).
 */
import path from "node:path";
import { assertLocalTestEnv } from "./test-env";
import { releaseRunLock, startRun, teardownRun } from "./teardown";

const ROOT = path.resolve(__dirname, "../..");

export default async function setup(): Promise<() => Promise<void>> {
  assertLocalTestEnv();
  const marker = await startRun(ROOT);

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
      releaseRunLock(marker.lockFile);
    }
  };
}
