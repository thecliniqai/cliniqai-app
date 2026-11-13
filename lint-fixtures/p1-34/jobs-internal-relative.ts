// @ts-nocheck -- imports a module that does not exist at this path (lib/jobs lands in V2-04); linted at a virtual path only.
import { runDueJobs } from "./internal/runner";

export const kick = runDueJobs;
