/**
 * V2-08 08-01a (PWA-06b): how a command's state maps to `<SaveStatus>` (`lib/commands/save-state.ts`).
 * Pure functions; the timing rules behind the states are in `use-command.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { appError, type Result } from "@/lib/errors/app-error";
import { isOfflineError, saveStateOf, saveStatusProps } from "@/lib/commands/save-state";

const ok: Result<number> = { ok: true, value: 1 };
const fail = (code: Parameters<typeof appError>[0], reason?: string): Result<never> => ({
  ok: false,
  error: appError(code, reason ? { reason } : {}),
});

describe("saveStateOf", () => {
  it("is idle before the first call", () => {
    expect(saveStateOf({ pending: false, last: null })).toBe("idle");
  });

  it("is saving while a call is in flight, the automatic retry included, whatever the last result was", () => {
    expect(saveStateOf({ pending: true, last: null })).toBe("saving");
    expect(saveStateOf({ pending: true, last: fail("DEPENDENCY_FAILED", "TIMEOUT") })).toBe("saving");
    expect(saveStateOf({ pending: true, last: ok })).toBe("saving");
  });

  it("is saved after a success", () => {
    expect(saveStateOf({ pending: false, last: ok })).toBe("saved");
  });

  it("is offline only for the failure reported when nothing was sent (reason OFFLINE)", () => {
    expect(saveStateOf({ pending: false, last: fail("DEPENDENCY_FAILED", "OFFLINE") })).toBe("offline");
    expect(isOfflineError(appError("DEPENDENCY_FAILED", { reason: "OFFLINE" }))).toBe(true);
    expect(isOfflineError(appError("DEPENDENCY_FAILED", { reason: "TIMEOUT" }))).toBe(false);
    expect(isOfflineError(appError("INTERNAL", { reason: "OFFLINE" }))).toBe(false);
  });

  it.each(["DEPENDENCY_FAILED", "INTERNAL", "CONFLICT", "VALIDATION_FAILED", "FORBIDDEN"] as const)(
    "is error after a %s failure",
    (code) => {
      expect(saveStateOf({ pending: false, last: fail(code) })).toBe("error");
    },
  );
});

describe("saveStatusProps", () => {
  it("passes the state and the clinic time; Retry runs retry() and is offered only in the error state", () => {
    let retried = 0;
    const retry = () => void retried++;

    const error = saveStatusProps({ saveState: "error", savedAt: null, retry });
    expect(error.state).toBe("error");
    error.onRetry?.();
    expect(retried).toBe(1);

    const saved = saveStatusProps({ saveState: "saved", savedAt: "10:42", retry });
    expect(saved).toMatchObject({ state: "saved", savedAt: "10:42" });
    expect(saved.onRetry).toBeUndefined();
    expect(saveStatusProps({ saveState: "offline", savedAt: null, retry }).onRetry).toBeUndefined();
    expect(saveStatusProps({ saveState: "saving", savedAt: null, retry }).onRetry).toBeUndefined();
    expect(retried).toBe(1);
  });
});
