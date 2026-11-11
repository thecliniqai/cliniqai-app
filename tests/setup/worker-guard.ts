/**
 * Runs in every Vitest worker before its test file is imported (V2-01a). Workers inherit the environment the
 * config loader prepared; this re-check makes the guard hold even if a worker is started some other way.
 */
import { assertLocalTestEnv } from "./test-env";

assertLocalTestEnv();
