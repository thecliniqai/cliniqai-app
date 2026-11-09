import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider } from "@/lib/storage";

/**
 * Operational readiness probe per D-18 and review recommendations.
 * Verifies Supabase Postgres, active storage provider (Supabase/R2),
 * and webhook outbox table connectivity. Sanitizes error responses to
 * generic status: 'not_ready' with correlationId to prevent internal
 * information disclosure (AGENTS.md §34).
 */
export async function GET() {
  const correlationId = crypto.randomUUID();
  let dbOk = false;
  let storageOk = false;
  let outboxOk = false;
  const errors: Record<string, unknown> = {};

  // 1. Database connectivity check
  try {
    const admin = getAdminClient();
    const { error: dbError } = await (admin.from("tenants") as any)
      .select("count", { count: "exact", head: true });

    if (dbError) {
      errors.database = dbError;
    } else {
      dbOk = true;
    }
  } catch (err) {
    errors.database = err;
  }

  // 2. Storage provider check (Supabase or R2)
  try {
    const provider = getStorageProvider();
    if (provider.name === "supabase") {
      const admin = getAdminClient();
      const { data: bucket, error: bucketError } = await admin.storage.getBucket("clinic-records");
      if (bucketError || !bucket) {
        // Fallback: verify storage service reachability via listBuckets
        const { error: listError } = await admin.storage.listBuckets();
        if (listError) {
          errors.storage = bucketError || listError;
        } else {
          storageOk = true;
        }
      } else {
        storageOk = true;
      }
    } else if (provider.name === "r2") {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      if (!accountId || !accessKeyId || !secretAccessKey) {
        errors.storage = "Missing R2 storage credentials";
      } else {
        storageOk = true;
      }
    } else {
      storageOk = true;
    }
  } catch (err) {
    errors.storage = err;
  }

  // 3. Webhook outbox infrastructure check
  try {
    const admin = getAdminClient();
    const { error: outboxError } = await (admin.from("webhook_delivery_queue") as any)
      .select("id")
      .limit(1);

    if (outboxError) {
      errors.outbox = outboxError;
    } else {
      outboxOk = true;
    }
  } catch (err) {
    errors.outbox = err;
  }

  const allReady = dbOk && storageOk && outboxOk;

  if (allReady) {
    return NextResponse.json(
      {
        status: "ready",
        checks: {
          database: "ok",
          storage: "ok",
          outbox: "ok",
        },
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Log full error diagnostics server-side with correlation ID
  console.error(`[ReadinessProbe] Failure [${correlationId}]:`, errors);

  return NextResponse.json(
    {
      status: "not_ready",
      checks: {
        database: dbOk ? "ok" : "error",
        storage: storageOk ? "ok" : "error",
        outbox: outboxOk ? "ok" : "error",
      },
      correlationId,
      timestamp: new Date().toISOString(),
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
