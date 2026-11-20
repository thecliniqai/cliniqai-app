import { appError, type AppError, type AppErrorCode, type Result } from "@/lib/errors/app-error";

/**
 * A service's `{ success: false, error, code?, reason? }` as the `AppError` a command action returns (V2-07 R-10): the
 * client's `useCommand` needs the code (`onAppErrorCode`) and the reason. Without a code the failure is INTERNAL.
 */
export function failureToAppError(failure: { error: string; code?: AppErrorCode; reason?: string }): AppError {
  return appError(failure.code ?? "INTERNAL", { message: failure.error, reason: failure.reason });
}

/** A legacy-shaped service result as a `Result` for a command action; `pick` selects the success value. */
export function toCommandResult<S extends { success: true }, T>(
  result: S | { success: false; error: string; code?: AppErrorCode; reason?: string },
  pick: (ok: S) => T
): Result<T> {
  return result.success ? { ok: true, value: pick(result) } : { ok: false, error: failureToAppError(result) };
}
