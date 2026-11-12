import { NextResponse } from "next/server";
import { resolveAiProviderConfig } from "@/lib/ai/client";
import { serverEnv } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { createClient } from "@/lib/supabase/server";

/**
 * Readiness probe (D-18; V2-03 03-01, P1-15, ADR-0005 "Readiness", C50 g).
 *
 * One call to `public.readiness_probe()` (SECURITY DEFINER, migration 000025) through the cookie client: the anon role
 * when nobody is signed in. No service role, no bucket check, no provider call. The body carries booleans, counts, the
 * newest applied migration and whether AI and messaging are configured (read from the env schema), nothing else. A
 * failure is logged with its error code only; the response never carries an error text. `correlationId` is the
 * request id the proxy assigned, so a 503 can be matched to its log line.
 */

type ProviderState = "configured" | "disabled";

interface ProbeResult {
  db: boolean;
  messages_pending: number;
  messages_failed_24h: number;
  webhooks_pending: number;
  webhooks_failed_24h: number;
  latest_migration: string | null;
}

const COUNT_KEYS = ["messages_pending", "messages_failed_24h", "webhooks_pending", "webhooks_failed_24h"] as const;

/** Accepts the RPC's JSON only in the expected shape (so nothing unexpected is ever echoed). */
function parseProbe(data: unknown): ProbeResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.db !== true) return null;
  for (const key of COUNT_KEYS) {
    if (typeof row[key] !== "number" || !Number.isInteger(row[key]) || (row[key] as number) < 0) return null;
  }
  const latest = row.latest_migration;
  return {
    db: true,
    messages_pending: row.messages_pending as number,
    messages_failed_24h: row.messages_failed_24h as number,
    webhooks_pending: row.webhooks_pending as number,
    webhooks_failed_24h: row.webhooks_failed_24h as number,
    latest_migration: typeof latest === "string" && /^[0-9]{1,20}$/.test(latest) ? latest : null,
  };
}

function providerStates(): { ai: ProviderState; messaging: ProviderState } {
  try {
    const env = serverEnv();
    const realMessaging = env.MESSAGING_PROVIDER !== "dev" && env.MESSAGING_PROVIDER !== "disabled";
    return {
      ai: resolveAiProviderConfig(env) ? "configured" : "disabled",
      messaging: realMessaging ? "configured" : "disabled",
    };
  } catch {
    return { ai: "disabled", messaging: "disabled" };
  }
}

export async function GET() {
  const requestId = await getRequestId();
  const correlationId = requestId ?? crypto.randomUUID();

  let probe: ProbeResult | null = null;
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("readiness_probe");
    if (error) {
      log.error({ event: "ready.probe_failed", requestId, code: errorTag(error) });
    } else {
      probe = parseProbe(data);
      if (!probe) log.error({ event: "ready.probe_failed", requestId, reason: "unexpected_shape" });
    }
  } catch (err) {
    log.error({ event: "ready.probe_failed", requestId, code: errorTag(err) });
  }

  const ready = probe !== null;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { database: ready ? "ok" : "error" },
      outbox: probe
        ? {
            messagesPending: probe.messages_pending,
            messagesFailed24h: probe.messages_failed_24h,
            webhooksPending: probe.webhooks_pending,
            webhooksFailed24h: probe.webhooks_failed_24h,
          }
        : null,
      providers: providerStates(),
      latestMigration: probe?.latest_migration ?? null,
      correlationId,
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
