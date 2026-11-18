import "server-only";
import type { z } from "zod";
import type { ServiceContext } from "@/lib/auth/context";
import { mapDbError, type DbErrorLike, type DbErrorMessages } from "@/lib/db/errors";
import { appError, type Result } from "@/lib/errors/app-error";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import type { Database } from "@/types/database";

/**
 * Server side of an atomic server command (V2-07 R-2, "Command pattern" step 7; TARGET_ARCHITECTURE §7.1): calls one
 * command RPC on the caller's database client and maps the outcome.
 *
 *   `ctx.db` is the caller's JWT client, so RLS and `auth.uid()` apply and the RPC authorises the caller itself.
 *   `p_tenant_id` is ALWAYS `ctx.tenantId` (the session's active clinic), whatever `args` says: a command never takes
 *   its tenant from input. `args` must carry `p_client_request_id` (PWA-06a: every write command takes one).
 *   A database error becomes an `AppError` through `mapDbError` with the command's fixed messages (never the driver's
 *   text); an unexpected failure (`INTERNAL`) or an unparseable result is logged by tag only. The result is parsed
 *   with `resultSchema`; a replay carries `replayed: true` (declare it in the schema when the caller needs it).
 *
 * Permission checks before the call, input validation and the audit/outbox rows are the caller's / the RPC's job; this
 * helper only moves the call and the outcome (shape shared with `callRecordPayment`, features/billing/service.ts).
 */
export type CommandFunctionName = keyof Database["public"]["Functions"] & string;

interface RpcCaller {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
}

export interface CommandFailureLog {
  /** Log event for an unexpected failure, e.g. `billing.collect_payment.failed`. Defaults to `command.<fnName>.failed`. */
  event?: `${string}.${string}`;
}

export async function callCommand<S extends z.ZodTypeAny>(
  ctx: Pick<ServiceContext, "db" | "tenantId">,
  fnName: CommandFunctionName,
  args: Record<string, unknown>,
  resultSchema: S,
  fixedMessages: DbErrorMessages = {},
  failure: CommandFailureLog = {}
): Promise<Result<z.infer<S>>> {
  const event: `${string}.${string}` = failure.event ?? `command.${fnName}.failed`;
  const clientRequestId = args.p_client_request_id;
  if (typeof clientRequestId !== "string" || clientRequestId.length === 0) {
    // A programming error, never reachable from input: the service wrapper must pass the id it was given.
    log.error({ event, code: "client_request_id_missing", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", { message: fixedMessages.VALIDATION_FAILED, reason: "CLIENT_REQUEST_ID_REQUIRED" }),
    };
  }

  let data: unknown;
  let error: DbErrorLike | null;
  try {
    ({ data, error } = await (ctx.db as unknown as RpcCaller).rpc(fnName, { ...args, p_tenant_id: ctx.tenantId }));
  } catch (err: unknown) {
    // The call itself threw (transport failure): nothing to map from the driver, the command may or may not have run.
    log.error({ event, code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: fixedMessages.INTERNAL }) };
  }

  if (error) {
    const mapped = mapDbError(error, fixedMessages);
    if (mapped.code === "INTERNAL") {
      log.error({ event, code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }
    return { ok: false, error: mapped };
  }

  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    log.error({ event, code: "result_shape", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: fixedMessages.INTERNAL }) };
  }
  return { ok: true, value: parsed.data };
}
