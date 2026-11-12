import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env-server";
import { dispatchPendingWebhookQueue } from "@/lib/webhooks/dispatcher";
import { getSystemDb } from "@/lib/supabase/system";

async function handleCronDispatch(req: NextRequest) {
  const cronSecret = serverEnv().CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing CRON_SECRET" },
      { status: 401 }
    );
  }

  try {
    // Register entry point (ADR-0005, until V2-04): the cron route owns the service-role client it dispatches with.
    const summary = await dispatchPendingWebhookQueue(getSystemDb("cron.webhooks"), { limit: 50 });
    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        ...summary,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Cron Error";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleCronDispatch(req);
}

export async function POST(req: NextRequest) {
  return handleCronDispatch(req);
}
