/**
 * Vitest globalSetup (V2-01a). Re-checks the local-only guard in the main process before any worker starts.
 * Run-scoped teardown is added in plan 01a-03.
 */
import { assertLocalTestEnv } from "./test-env";

export default function setup(): void {
  assertLocalTestEnv();
}
