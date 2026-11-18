import { appError, type AppError } from "@/lib/errors/app-error";

/**
 * Maps a failed `resolveServiceContext` (V2-07 R-10) to the `AppError` a command action returns, so `useCommand` can hand
 * its code to `onAppErrorCode` (a locked clinic runs the status check, an expired session signs the device out). The
 * message is the resolver's fixed, safe text.
 */
export function contextFailureToAppError(failure: { error: string; reason?: string }): AppError {
  switch (failure.reason) {
    case "unauthenticated":
      return appError("UNAUTHENTICATED", { message: failure.error });
    case "locked":
      return appError("SUBSCRIPTION_LOCKED", { message: failure.error });
    case "unavailable":
      return appError("DEPENDENCY_FAILED", { message: failure.error });
    case "no_membership":
      return appError("NOT_FOUND", { message: failure.error });
    default:
      return appError("FORBIDDEN", { message: failure.error });
  }
}
