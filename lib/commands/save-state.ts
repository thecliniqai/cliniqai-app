import type { SaveState, SaveStatusProps } from "@/components/clinical/save-status";
import type { AppError, Result } from "@/lib/errors/app-error";

/**
 * Maps the state of a command to the `SaveStatus` component (V2-08 08-01a, PWA-06b, 06-UI-SPEC SaveStatus).
 * Pure: `tests/commands/save-state.spec.ts`. The hook (`useCommand`) keeps the last result and calls these.
 *
 * - a call in flight (the automatic retry included) is `saving`;
 * - a success is `saved`;
 * - a failure with reason `OFFLINE` (nothing was sent) is `offline`;
 * - any other failure is `error` ("Couldn't save · Retry");
 * - before the first call, or after the form starts over, it is `idle`.
 */
export function saveStateOf(input: { pending: boolean; last: Result<unknown> | null }): SaveState {
  if (input.pending) return "saving";
  if (!input.last) return "idle";
  if (input.last.ok) return "saved";
  return isOfflineError(input.last.error) ? "offline" : "error";
}

/** True for the failure `useCommand` reports when the device was offline at submit (nothing was sent). */
export function isOfflineError(error: AppError): boolean {
  return error.code === "DEPENDENCY_FAILED" && error.reason === "OFFLINE";
}

/** The props for `<SaveStatus>` from a command hook: `<SaveStatus {...saveStatusProps(command)} />`. */
export function saveStatusProps(command: {
  saveState: SaveState;
  savedAt: string | null;
  retry: () => unknown;
}): SaveStatusProps {
  return {
    state: command.saveState,
    savedAt: command.savedAt,
    onRetry: command.saveState === "error" ? () => void command.retry() : undefined,
  };
}
