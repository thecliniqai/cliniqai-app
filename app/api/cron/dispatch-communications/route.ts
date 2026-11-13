import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env-server";
import { dispatchPendingQueue } from "@/lib/messaging/dispatcher";
import { getSystemDb } from "@/lib/supabase/system";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

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
    const summary = await dispatchPendingQueue(getSystemDb("cron.dispatch_communications"), { limit: 50 });
    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        ...summary,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    // The error text can carry row values: the body is fixed and the log gets the error's code or class name only.
    log.error({ event: "jobs.cron_dispatch_communications.failed", code: errorTag(err), requestId: await getRequestId() });
    return NextResponse.json(
      { success: false, error: "Internal Cron Error" },
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
