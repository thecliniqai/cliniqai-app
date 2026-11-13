// @ts-nocheck -- imports a module that does not exist at this path (lib/jobs lands in V2-04); linted at a virtual path only.
"use server";
import { runDueJobs } from "@/lib/jobs/internal/runner";

export async function kickJobs() {
  return runDueJobs();
}
