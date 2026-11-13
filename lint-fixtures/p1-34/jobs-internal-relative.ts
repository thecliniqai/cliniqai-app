// @ts-nocheck -- `./internal/runner` resolves only at the virtual path lib/jobs/enqueue.ts (the real module since 04-02).
import { runJobs } from "./internal/runner";

export const kick = runJobs;
