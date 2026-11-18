/**
 * /diag/client-error (V2-06 06-04a step 1, R-3; T-03-15 pattern): proves client render error capture end to end. A
 * button makes a child component throw `DiagClientRenderError` while rendering; the dashboard's `error.tsx` reports it
 * through `reportClientRenderError` (`tests/e2e/observability/client-error.spec.ts`).
 *
 * Not found unless `DIAG_ERROR_ROUTE_ENABLED` (the env schema refuses it in production, 03-09b R-18). Signed-in members
 * only (the dashboard layout). Static content; nothing about the clinic is read.
 */
import { notFound } from "next/navigation";
import { serverEnv } from "@/lib/env-server";
import { DiagClientErrorTrigger } from "./trigger";

export const dynamic = "force-dynamic";

export default function DiagClientErrorPage() {
  let enabled = false;
  try {
    enabled = serverEnv().DIAG_ERROR_ROUTE_ENABLED;
  } catch {
    // An environment the schema refuses enables nothing (fail closed).
  }
  if (!enabled) notFound();
  return (
    <section aria-labelledby="diag-client-error-title" className="flex max-w-xl flex-col items-start gap-4">
      <h1 id="diag-client-error-title" className="text-xl font-semibold text-fg">
        Client error diagnostic
      </h1>
      <p className="text-sm text-fg-secondary">
        Throws a synthetic error while rendering, so the error state and the error report can be checked.
      </p>
      <DiagClientErrorTrigger />
    </section>
  );
}
