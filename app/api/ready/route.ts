import { NextResponse } from "next/server";
import { resolveAiProviderConfig } from "@/lib/ai/client";
import { REAL_EMAIL_PROVIDERS } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { createPublicClient } from "@/lib/supabase/server";
import { EXPECTED_MIGRATION } from "./expected-migration";

/**
 * Readiness probe (D-18; V2-03 03-01, P1-15, ADR-0005 "Readiness", C50 g; 03-13c M-PROBE).
 *
 * One call to `public.readiness_probe(p_expected_migration)` (SECURITY DEFINER, migration 000029) through the
 * cookie-less public client, so always as `anon`, the only role that may execute it. No service role, no bucket check,
 * no provider call. The body carries booleans only: whether the database answered, whether the migration this build
 * expects ({@link EXPECTED_MIGRATION}) is applied, four outbox health flags, and whether AI, messaging and email are
 * configured (read from the env schema). No count, no migration version, no tenant data. Ready means the database
 * answered AND the schema is current. A failure is logged with its error code only; the response never carries an error
 * text. `correlationId` is the request id the proxy assigned, so a 503 can be matched to its log line.
 */

type ProviderState = "configured" | "disabled";

interface ProbeResult {
  schemaCurrent: boolean | null;
  messagesBacklog: boolean;
  messagesFailed24h: boolean;
  webhooksBacklog: boolean;
  webhooksFailed24h: boolean;
}

const FLAG_KEYS = ["messages_backlog", "messages_failed_24h", "webhooks_backlog", "webhooks_failed_24h"] as const;

/** Accepts the RPC's JSON only in the expected shape (so nothing unexpected is ever echoed). */
function parseProbe(data: unknown): ProbeResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.db !== true) return null;
  for (const key of FLAG_KEYS) {
    if (typeof row[key] !== "boolean") return null;
  }
  const schema = row.schema_current;
  if (schema !== null && typeof schema !== "boolean") return null;
  return {
    schemaCurrent: schema,
    messagesBacklog: row.messages_backlog as boolean,
    messagesFailed24h: row.messages_failed_24h as boolean,
    webhooksBacklog: row.webhooks_backlog as boolean,
    webhooksFailed24h: row.webhooks_failed_24h as boolean,
  };
}

function providerStates(): { ai: ProviderState; messaging: ProviderState; email: ProviderState } {
  try {
    const env = serverEnv();
    // 04-03a: `sink` (R-9) sends nothing, like `dev` and `disabled`.
    const realMessaging = !["dev", "disabled", "sink"].includes(env.MESSAGING_PROVIDER);
    return {
      ai: resolveAiProviderConfig(env) ? "configured" : "disabled",
      messaging: realMessaging ? "configured" : "disabled",
      // 03-11b (R-16), 04-00b: only SES and Resend deliver real mail; Mailpit is a local catcher and `disabled` sends
      // nothing. The env schema has already required each one's credentials, so the provider name is enough.
      email: REAL_EMAIL_PROVIDERS.includes(env.EMAIL_PROVIDER) ? "configured" : "disabled",
    };
  } catch {
    return { ai: "disabled", messaging: "disabled", email: "disabled" };
  }
}

export async function GET() {
  const requestId = await getRequestId();
  const correlationId = requestId ?? crypto.randomUUID();

  let probe: ProbeResult | null = null;
  try {
    const db = createPublicClient();
    const { data, error } = await db.rpc("readiness_probe", { p_expected_migration: EXPECTED_MIGRATION });
    if (error) {
      log.error({ event: "ready.probe_failed", requestId, code: errorTag(error) });
    } else {
      probe = parseProbe(data);
      if (!probe) log.error({ event: "ready.probe_failed", requestId, reason: "unexpected_shape" });
    }
  } catch (err) {
    log.error({ event: "ready.probe_failed", requestId, code: errorTag(err) });
  }

  const schema = probe === null ? "unknown" : probe.schemaCurrent ? "current" : "behind";
  const ready = probe !== null && schema === "current";
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { database: probe ? "ok" : "error", schema },
      outbox: probe
        ? {
            messagesBacklog: probe.messagesBacklog,
            messagesFailed24h: probe.messagesFailed24h,
            webhooksBacklog: probe.webhooksBacklog,
            webhooksFailed24h: probe.webhooksFailed24h,
          }
        : null,
      providers: providerStates(),
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
