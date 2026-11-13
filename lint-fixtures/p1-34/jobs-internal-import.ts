// The real runner since V2-04 04-02 (typechecked here); linted at virtual paths only (README).
"use server";
import { runJobs, type RunJobsOptions } from "@/lib/jobs/internal/runner";

export async function kickJobs(options: RunJobsOptions) {
  return runJobs(options);
}
