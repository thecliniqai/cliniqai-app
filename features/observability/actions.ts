"use server";

/**
 * Client render error capture (V2-06 06-04a, ruling R-3; V2-03 R-29 carry-over; threats T-06-09, T-06-10).
 *
 * `reportClientRenderError` is called by the signed-in route error boundaries (`components/shell/route-error.tsx`) for
 * an uncaught render error without a digest. Membership-only (`resolveServiceContext()` with no permission): every
 * member's screens can fail, and the report carries no tenant data. The caller sends two strings, the error's class
 * name and the route pattern; the stored row is built by `lib/observability/client-render-event.ts` (no message, no
 * frames, no query, no concrete path). Answers `{ ok }` only, never a message or anything stored.
 */
import { z } from "zod";
import { resolveServiceContext } from "@/lib/auth/context";
import type { AppEnv } from "@/lib/env";
import { deploymentInfo, serverEnv } from "@/lib/env-server";
import { log } from "@/lib/log";
import {
  admitClientKey,
  buildClientRenderEvent,
  MAX_CLIENT_NAME,
  MAX_CLIENT_ROUTE,
} from "@/lib/observability/client-render-event";
import { admitToSink, sendErrorEvent } from "@/lib/observability/sink";

// Unknown keys (a `message`, `tenant_id`, …) are stripped: only the two fields below reach the event builder.
const reportSchema = z.object({
  name: z.string().max(MAX_CLIENT_NAME),
  route: z.string().max(MAX_CLIENT_ROUTE),
});

export async function reportClientRenderError(report: { name: string; route: string }): Promise<{ ok: boolean }> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { ok: false };
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return { ok: false };

  let environment: AppEnv = "development";
  try {
    environment = serverEnv().APP_ENV;
  } catch {
    // An environment the schema refuses never booted in a deployment; keep the event, tier unknown → development.
  }
  const event = buildClientRenderEvent(parsed.data, { environment, release: deploymentInfo().release });
  log.warn({ event: "client.render_error", route: event.route_path ?? undefined, code: event.error_name });
  if (admitClientKey(event) && admitToSink(event)) await sendErrorEvent(event);
  return { ok: true };
}
